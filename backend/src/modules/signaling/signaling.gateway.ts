import {
  WebSocketGateway,
  SubscribeMessage,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SfuService } from '../sfu/sfu.service';
import { RoomService } from '../room/room.service';

const AVATAR_RESPONSES = [
  "I have received your video transmission via the SFU. Your audio fidelity is nominal with VP8 packetization.",
  "Understood! Your previous speaking turn was captured successfully. The RTP packet stream shows zero packet loss.",
  "Acknowledged. I have recorded your speech in the half-duplex buffer. You may take your turn again now.",
  "Transmission received loud and clear. SFU peer connection endpoints are synchronized.",
];

@WebSocketGateway({
  cors: { origin: '*' },
  path: '/ws',
})
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly sfuService: SfuService,
    private readonly roomService: RoomService,
  ) {}

  handleConnection(client: Socket) {
    console.log(`[NestJS SFU] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[NestJS SFU] Client disconnected: ${client.id}`);
    const roomId = (client as any).roomId;
    if (roomId) {
      this.roomService.leave(roomId, client.id);
      this.server.to(roomId).emit('participant_left', { participantId: client.id });
    }
  }

  @SubscribeMessage('get_router_capabilities')
  async handleGetCapabilities(@MessageBody() data: { roomId: string }) {
    const caps = await this.sfuService.getRouterRtpCapabilities(data.roomId || 'default');
    return { rtpCapabilities: caps };
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; name: string; role: string },
  ) {
    (client as any).roomId = payload.roomId;
    client.join(payload.roomId);

    const { room, participant } = this.roomService.join(
      payload.roomId,
      client.id,
      payload.name,
      payload.role,
    );

    client.broadcast.to(payload.roomId).emit('participant_joined', { participant });

    return {
      participantId: client.id,
      role: participant.role,
      room: {
        id: room.id,
        name: room.name,
        controllerId: room.controllerId,
        isLocked: room.isLocked,
        turnState: room.turnState,
      },
    };
  }

  @SubscribeMessage('create_webrtc_transport')
  async handleCreateTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ) {
    return await this.sfuService.createWebRtcTransport(payload.roomId);
  }

  @SubscribeMessage('connect_webrtc_transport')
  async handleConnectTransport(
    @MessageBody() payload: { transportId: string; dtlsParameters: any },
  ) {
    await this.sfuService.connectTransport(payload.transportId, payload.dtlsParameters);
    return { connected: true };
  }

  @SubscribeMessage('produce')
  async handleProduce(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { transportId: string; kind: 'audio' | 'video'; rtpParameters: any },
  ) {
    const producerId = await this.sfuService.produce(
      payload.transportId,
      payload.kind,
      payload.rtpParameters,
      { participantId: client.id },
    );
    return { id: producerId };
  }

  // Half-duplex: Client declares speech is over
  @SubscribeMessage('turn_over')
  handleTurnOver(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ) {
    const roomId = payload.roomId || (client as any).roomId;
    this.roomService.setTurnState(roomId, 'avatar_speaking', 'avatar');

    this.server.to(roomId).emit('turn_state_changed', {
      turnState: 'avatar_speaking',
      activeSpeakerId: 'avatar',
      message: "Client speech completed. Avatar's turn has commenced.",
    });

    // Simulate streaming text speech below avatar
    const response = AVATAR_RESPONSES[Math.floor(Math.random() * AVATAR_RESPONSES.length)];
    const words = response.split(' ');
    let currentIdx = 0;
    let accumulated = '';

    const interval = setInterval(() => {
      if (currentIdx < words.length) {
        accumulated += words[currentIdx] + ' ';
        currentIdx++;
        this.server.to(roomId).emit('avatar_speech_chunk', {
          fullText: accumulated,
          progress: currentIdx / words.length,
        });
      } else {
        clearInterval(interval);
        setTimeout(() => {
          this.roomService.setTurnState(roomId, 'idle', null);
          this.server.to(roomId).emit('avatar_speech_complete', {
            completedText: accumulated,
          });
          this.server.to(roomId).emit('turn_state_changed', {
            turnState: 'idle',
            message: 'Avatar speech finished. Client may now start transmitting again.',
          });
        }, 500);
      }
    }, 150);

    return { success: true };
  }
}
