import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { SfuService } from '../sfu/sfu.service';
import { RoomService } from '../room/room.service';

const AVATAR_RESPONSES = [
  "I have received your video transmission via the SFU. Your audio fidelity is nominal with VP8 packetization.",
  "Understood! Your previous speaking turn was captured successfully. The RTP packet stream shows zero packet loss.",
  "Acknowledged. I have recorded your speech in the half-duplex buffer. You may take your turn again now.",
  "Transmission received loud and clear. SFU peer connection endpoints are synchronized.",
  "Telemetry confirms steady bitrate on WebRtcTransport. The floor is returned to you.",
];

interface ConnectedClient {
  ws: WebSocket;
  participantId?: string;
  roomId?: string;
}

@Injectable()
export class SignalingGateway implements OnModuleInit, OnModuleDestroy {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ConnectedClient>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly sfuService: SfuService,
    private readonly roomService: RoomService,
  ) {}

  onModuleInit() {
    const server = this.adapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({ server, path: '/ws' });

    console.log('[NestJS SFU] WebSocket Signaling Gateway mounted on /ws');

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = uuidv4();
      this.clients.set(clientId, { ws });

      console.log(`[NestJS SFU] Client connected: ${clientId} (Total: ${this.clients.size})`);

      ws.on('message', async (data: Buffer | string) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(clientId, ws, message);
        } catch (err) {
          console.error(`[NestJS SFU] Error processing message from ${clientId}:`, err);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(clientId);
      });

      ws.on('error', (err) => {
        console.error(`[NestJS SFU] WebSocket error on client ${clientId}:`, err);
      });
    });
  }

  onModuleDestroy() {
    if (this.wss) {
      this.wss.close();
    }
  }

  private reply(
    ws: WebSocket,
    responseType: string,
    payload: any,
    requestId?: string,
    roomId?: string,
    clientId?: string,
  ) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: responseType,
          requestId,
          roomId,
          senderId: clientId,
          payload,
        }),
      );
    }
  }

  private broadcastToRoom(roomId: string, message: any, excludeClientId?: string) {
    const dataStr = JSON.stringify(message);
    for (const [id, client] of this.clients.entries()) {
      if (client.roomId === roomId && id !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(dataStr);
      }
    }
  }

  private async handleMessage(clientId: string, ws: WebSocket, message: any) {
    const { type, roomId, payload, requestId } = message;

    const respond = (resType: string, resPayload: any) => {
      this.reply(ws, resType, resPayload, requestId, roomId, clientId);
    };

    switch (type) {
      case 'get_router_capabilities': {
        const caps = await this.sfuService.getRouterRtpCapabilities(roomId || 'default');
        respond('router_capabilities', { rtpCapabilities: caps });
        break;
      }

      case 'join_room': {
        const targetRoomId = roomId || 'default';
        const roomName = payload?.roomName;
        const requestedRole = payload?.role || 'participant';
        const participantName = payload?.name || `User_${clientId.substring(0, 4)}`;

        const existingRoom = this.roomService.getRoom(targetRoomId);
        if (existingRoom && existingRoom.isLocked && requestedRole !== 'controller') {
          respond('error', { message: 'Room is currently locked by the meeting controller.' });
          return;
        }

        const { room, participant } = this.roomService.join(
          targetRoomId,
          clientId,
          participantName,
          requestedRole,
        );

        const clientData = this.clients.get(clientId);
        if (clientData) {
          clientData.roomId = room.id;
          clientData.participantId = clientId;
        }

        respond('room_joined', {
          participantId: clientId,
          role: participant.role,
          room: {
            id: room.id,
            name: room.name,
            controllerId: room.controllerId,
            isLocked: room.isLocked,
            participants: room.participants,
            turnState: room.turnState,
            activeSpeakerId: room.activeSpeakerId,
          },
        });

        this.broadcastToRoom(
          room.id,
          {
            type: 'participant_joined',
            roomId: room.id,
            payload: { participant },
          },
          clientId,
        );
        break;
      }

      case 'create_webrtc_transport': {
        const transportOptions = await this.sfuService.createWebRtcTransport(roomId || 'default');
        respond('webrtc_transport_created', transportOptions);
        break;
      }

      case 'connect_webrtc_transport': {
        await this.sfuService.connectTransport(payload.transportId, payload.dtlsParameters);
        respond('webrtc_transport_connected', { connected: true });
        break;
      }

      case 'produce': {
        const producerId = await this.sfuService.produce(
          payload.transportId,
          payload.kind,
          payload.rtpParameters,
          { participantId: clientId },
        );
        respond('produced', { id: producerId });

        this.broadcastToRoom(
          roomId,
          {
            type: 'new_producer',
            roomId,
            payload: { producerId, participantId: clientId, kind: payload.kind },
          },
          clientId,
        );
        break;
      }

      case 'consume': {
        try {
          const consumerOptions = await this.sfuService.consume(
            roomId || 'default',
            payload.transportId,
            payload.producerId,
            payload.rtpCapabilities,
          );
          respond('consumed', consumerOptions);
        } catch (err: any) {
          respond('error', { message: err.message || 'Failed to consume' });
        }
        break;
      }

      case 'turn_start': {
        const targetRoomId = roomId || 'default';
        const room = this.roomService.getOrCreateRoom(targetRoomId);

        if (room.turnState === 'avatar_speaking') {
          respond('error', { message: 'Half-duplex lock: Avatar is currently speaking. Please wait.' });
          return;
        }

        this.roomService.setTurnState(targetRoomId, 'client_speaking', clientId);

        respond('turn_started', {
          status: 'ok',
          turnState: 'client_speaking',
          activeSpeakerId: clientId,
        });

        this.broadcastToRoom(targetRoomId, {
          type: 'turn_state_changed',
          roomId: targetRoomId,
          payload: {
            turnState: 'client_speaking',
            activeSpeakerId: clientId,
            message: 'Client has initiated speech transmission.',
          },
        });
        break;
      }

      case 'turn_over': {
        const targetRoomId = roomId || 'default';
        this.roomService.setTurnState(targetRoomId, 'avatar_speaking', 'avatar');

        respond('turn_over_ack', {
          status: 'ok',
          turnState: 'avatar_speaking',
        });

        this.broadcastToRoom(targetRoomId, {
          type: 'turn_state_changed',
          roomId: targetRoomId,
          payload: {
            turnState: 'avatar_speaking',
            activeSpeakerId: 'avatar',
            message: "Client speech completed. Avatar's turn has commenced.",
          },
        });

        // Simulate streaming text speech below avatar
        const selectedSpeech = AVATAR_RESPONSES[Math.floor(Math.random() * AVATAR_RESPONSES.length)];
        const words = selectedSpeech.split(' ');
        let currentIdx = 0;
        let accumulatedText = '';

        const speechInterval = setInterval(() => {
          if (currentIdx < words.length) {
            const chunk = words[currentIdx] + ' ';
            accumulatedText += chunk;
            currentIdx++;

            this.broadcastToRoom(targetRoomId, {
              type: 'avatar_speech_chunk',
              roomId: targetRoomId,
              payload: {
                chunk,
                fullText: accumulatedText,
                progress: currentIdx / words.length,
              },
            });
          } else {
            clearInterval(speechInterval);
            setTimeout(() => {
              this.roomService.setTurnState(targetRoomId, 'idle', null);

              this.broadcastToRoom(targetRoomId, {
                type: 'avatar_speech_complete',
                roomId: targetRoomId,
                payload: {
                  completedText: accumulatedText,
                  nextSpeakerAllowed: 'client',
                },
              });

              this.broadcastToRoom(targetRoomId, {
                type: 'turn_state_changed',
                roomId: targetRoomId,
                payload: {
                  turnState: 'idle',
                  activeSpeakerId: null,
                  message: 'Avatar speech finished. Client may now start transmitting again.',
                },
              });
            }, 500);
          }
        }, 150);
        break;
      }

      case 'peer_signal': {
        const { targetId, signal } = payload;
        if (targetId && this.clients.has(targetId)) {
          const targetClient = this.clients.get(targetId);
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(
              JSON.stringify({
                type: 'peer_signal',
                roomId,
                senderId: clientId,
                payload: { senderId: clientId, signal },
              }),
            );
          }
        }
        break;
      }

      case 'update_media_state': {
        const targetRoomId = roomId || 'default';
        const room = this.roomService.getRoom(targetRoomId);
        if (room && room.participants[clientId]) {
          if (typeof payload.isMuted === 'boolean') {
            room.participants[clientId].isMuted = payload.isMuted;
          }
          if (typeof payload.isVideoMuted === 'boolean') {
            room.participants[clientId].isVideoMuted = payload.isVideoMuted;
          }
          this.broadcastToRoom(targetRoomId, {
            type: 'room_state_updated',
            roomId: targetRoomId,
            payload: { room },
          });
        }
        break;
      }

      case 'controller_action': {
        const targetRoomId = roomId || 'default';
        const room = this.roomService.getRoom(targetRoomId);

        const { action, targetParticipantId } = payload;
        if (action !== 'reclaim_host' && (!room || room.controllerId !== clientId)) {
          respond('error', { message: 'Authorization Failed: Only Meeting Controllers can perform this action.' });
          return;
        }

        this.roomService.executeControllerAction(targetRoomId, clientId, action, targetParticipantId);

        if (action === 'kick' && targetParticipantId) {
          const kickedClient = this.clients.get(targetParticipantId);
          if (kickedClient && kickedClient.ws.readyState === WebSocket.OPEN) {
            kickedClient.ws.send(
              JSON.stringify({
                type: 'error',
                payload: { message: 'You have been removed from the meeting by the Controller.' },
              }),
            );
            kickedClient.ws.close();
          }
        }

        const updatedRoom = this.roomService.getRoom(targetRoomId);
        if (updatedRoom) {
          this.broadcastToRoom(targetRoomId, {
            type: 'room_state_updated',
            roomId: targetRoomId,
            payload: { room: updatedRoom },
          });
        }
        break;
      }

      default:
        console.warn(`[NestJS SFU] Unknown signaling message type: ${type}`);
    }
  }

  private handleDisconnect(clientId: string) {
    const clientData = this.clients.get(clientId);
    this.clients.delete(clientId);

    if (clientData?.roomId) {
      const roomId = clientData.roomId;
      this.roomService.leave(roomId, clientId);

      this.broadcastToRoom(roomId, {
        type: 'participant_left',
        roomId,
        payload: { participantId: clientId },
      });

      const updatedRoom = this.roomService.getRoom(roomId);
      if (updatedRoom) {
        this.broadcastToRoom(roomId, {
          type: 'room_state_updated',
          roomId,
          payload: { room: updatedRoom },
        });
      }
    }

    console.log(`[NestJS SFU] Client disconnected: ${clientId} (Remaining: ${this.clients.size})`);
  }
}
