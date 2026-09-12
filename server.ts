import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = 3000;
const server = http.createServer(app);

// Local directory for recordings as specified in requirement 8.b2
const RECORDINGS_DIR = path.join(process.cwd(), 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// Multer storage for saving recordings into local project directory
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, RECORDINGS_DIR);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${cleanName}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve recordings with robust HTTP 206 Partial Content video streaming & 0-byte protection
app.use('/recordings/:filename', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(RECORDINGS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (filename.endsWith('.json')) {
    return res.sendFile(filePath);
  }

  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    if (fileSize === 0) {
      res.writeHead(200, {
        'Content-Type': 'video/webm',
        'Content-Length': '0',
        'Accept-Ranges': 'bytes',
        'X-Empty-File': 'true',
      });
      return res.end();
    }

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        return res.end();
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': filename.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': filename.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    next(err);
  }
});

app.use('/recordings', express.static(RECORDINGS_DIR));

// Standard mediasoup router RTP capabilities
const routerRtpCapabilities = {
  codecs: [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
      parameters: { minptime: 10, useinbandfec: 1 },
      preferredPayloadType: 111,
      rtcpFeedback: [{ type: 'transport-cc' }],
    },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: { 'x-google-start-bitrate': 1000 },
      preferredPayloadType: 96,
      rtcpFeedback: [
        { type: 'nack' },
        { type: 'nack', parameter: 'pli' },
        { type: 'ccm', parameter: 'fir' },
        { type: 'goog-remb' },
        { type: 'transport-cc' },
      ],
    },
    {
      kind: 'video',
      mimeType: 'video/H264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '42e01f',
        'level-asymmetry-allowed': 1,
      },
      preferredPayloadType: 97,
      rtcpFeedback: [
        { type: 'nack' },
        { type: 'nack', parameter: 'pli' },
        { type: 'ccm', parameter: 'fir' },
        { type: 'goog-remb' },
        { type: 'transport-cc' },
      ],
    },
  ],
  headerExtensions: [
    {
      kind: 'audio',
      uri: 'urn:ietf:params:rtp-hdrext:sdes:mid',
      preferredId: 1,
      preferredEncrypt: false,
    },
    {
      kind: 'video',
      uri: 'urn:ietf:params:rtp-hdrext:sdes:mid',
      preferredId: 1,
      preferredEncrypt: false,
    },
    {
      kind: 'video',
      uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
      preferredId: 3,
      preferredEncrypt: false,
    },
    {
      kind: 'video',
      uri: 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
      preferredId: 5,
      preferredEncrypt: false,
    },
  ],
};

// In-Memory Room & SFU State Management (Requirement 2: no persistent DB)
interface Participant {
  id: string;
  name: string;
  role: 'controller' | 'speaker' | 'participant';
  isMuted: boolean;
  isVideoMuted: boolean;
  joinedAt: number;
  producerIds: { audio?: string; video?: string };
}

interface Room {
  id: string;
  name: string;
  createdAt: number;
  controllerId: string;
  isLocked: boolean;
  participants: Record<string, Participant>;
  turnState: 'idle' | 'client_speaking' | 'avatar_speaking';
  activeSpeakerId: string | null;
  transports: Map<string, any>;
  producers: Map<string, any>;
  consumers: Map<string, any>;
}

const rooms = new Map<string, Room>();
const clients = new Map<string, { ws: WebSocket; roomId?: string; participantId?: string }>();

// Helper to get or create room
function getOrCreateRoom(roomId: string, name?: string): Room {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      name: name || `Room ${roomId.substring(0, 6)}`,
      createdAt: Date.now(),
      controllerId: '',
      isLocked: false,
      participants: {},
      turnState: 'idle',
      activeSpeakerId: null,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    });
  }
  return rooms.get(roomId)!;
}

// Broadcast to room participants
function broadcastToRoom(roomId: string, message: any, excludeClientId?: string) {
  const payload = JSON.stringify(message);
  for (const [clientId, client] of clients.entries()) {
    if (client.roomId === roomId && clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

// Pool of rich responses for the Avatar speech simulator
const AVATAR_SPEECH_RESPONSES = [
  "I have received your video transmission via the SFU. Your audio fidelity is nominal with VP8 packetization. Proceeding with synchronized transport analysis.",
  "Understood! Your previous speaking turn was captured successfully. The RTP packet stream shows zero packet loss and 24ms round-trip latency.",
  "Acknowledged. I have recorded your speech in the half-duplex buffer. The mediasoup router maintained stable bitrates throughout your streaming interval.",
  "Transmission received loud and clear. SFU peer connection endpoints are synchronized. You may take your turn again as soon as I conclude this update.",
  "Speech processed! In a half-duplex SFU topology, preventing bidirectional collisions optimizes bandwidth allocation. I am ready to hand back control.",
  "Excellent presentation. Your WebRTC sending transport maintained full frame-rate stability. The meeting controller logs have verified your audio output."
];

// --- REST API Endpoints ---
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    project: 'mediasoup-sfu-system',
    uptime: process.uptime(),
    activeRooms: rooms.size,
    connectedClients: clients.size,
  });
});

app.get('/api/rooms', (_req, res) => {
  const roomList = Array.from(rooms.values()).map(r => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    participantCount: Object.keys(r.participants).length,
    controllerId: r.controllerId,
    isLocked: r.isLocked,
    turnState: r.turnState,
    participants: r.participants,
  }));
  res.json(roomList);
});

app.get('/api/sfu/info', (_req, res) => {
  res.json({
    sfu: 'mediasoup-v3-compatible',
    rtpCapabilities: routerRtpCapabilities,
    supportedCodecs: ['audio/opus', 'video/VP8', 'video/H264'],
    activeTransports: Array.from(rooms.values()).reduce((acc, r) => acc + r.transports.size, 0),
    activeProducers: Array.from(rooms.values()).reduce((acc, r) => acc + r.producers.size, 0),
  });
});

// Save video and transcript locally (Requirement 8.b2)
app.post('/api/recordings/save', upload.single('video'), (req, res) => {
  try {
    const videoFile = req.file;
    const { roomId, transcriptJson, title, duration } = req.body;

    if (videoFile && videoFile.size === 0) {
      if (fs.existsSync(videoFile.path)) {
        try { fs.unlinkSync(videoFile.path); } catch {}
      }
      return res.status(400).json({ error: 'Uploaded video file is empty (0 bytes). Please capture speech before saving.' });
    }

    const id = uuidv4();
    const timestamp = new Date().toISOString();
    const safeTitle = title || `Recording_${new Date().toLocaleDateString().replace(/\//g, '-')}`;

    let parsedTranscript = [];
    if (transcriptJson) {
      try {
        parsedTranscript = JSON.parse(transcriptJson);
      } catch (err) {
        console.error('Failed to parse transcript json:', err);
      }
    }

    // Ensure uploaded video file has open permissions for external media players (VLC)
    if (videoFile && videoFile.path && fs.existsSync(videoFile.path)) {
      try {
        fs.chmodSync(videoFile.path, 0o666);
      } catch {}
    }

    // Save transcript file alongside video in local directory
    const transcriptFileName = `${id}-transcript.json`;
    const transcriptFilePath = path.join(RECORDINGS_DIR, transcriptFileName);
    fs.writeFileSync(transcriptFilePath, JSON.stringify(parsedTranscript, null, 2), 'utf-8');
    try {
      fs.chmodSync(transcriptFilePath, 0o666);
    } catch {}

    // Create metadata index entry
    const metaFileName = `${id}-meta.json`;
    const metaFilePath = path.join(RECORDINGS_DIR, metaFileName);
    const metadata = {
      id,
      roomId: roomId || 'default-room',
      title: safeTitle,
      videoFileName: videoFile ? videoFile.filename : '',
      transcriptFileName,
      durationSeconds: Number(duration) || 0,
      fileSizeBytes: videoFile ? videoFile.size : 0,
      createdAt: timestamp,
      videoUrl: videoFile ? `/recordings/${videoFile.filename}` : '',
      transcriptUrl: `/recordings/${transcriptFileName}`,
      transcript: parsedTranscript,
    };

    fs.writeFileSync(metaFilePath, JSON.stringify(metadata, null, 2), 'utf-8');
    try {
      fs.chmodSync(metaFilePath, 0o666);
    } catch {}

    res.status(201).json({
      success: true,
      message: 'Video and speech transcript saved to project local directory successfully',
      recording: metadata,
    });
  } catch (error: any) {
    console.error('Error saving recording:', error);
    res.status(500).json({ error: error.message || 'Failed to save recording' });
  }
});

// List all saved local recordings
app.get('/api/recordings', (_req, res) => {
  try {
    if (!fs.existsSync(RECORDINGS_DIR)) {
      return res.json([]);
    }
    const files = fs.readdirSync(RECORDINGS_DIR);
    const metaFiles = files.filter(f => f.endsWith('-meta.json'));
    const recordings = metaFiles
      .map(metaFile => {
        try {
          const content = fs.readFileSync(path.join(RECORDINGS_DIR, metaFile), 'utf-8');
          const item = JSON.parse(content);
          if (item && item.videoFileName) {
            const vp = path.join(RECORDINGS_DIR, item.videoFileName);
            if (fs.existsSync(vp)) {
              item.fileSizeBytes = fs.statSync(vp).size;
            } else {
              item.fileSizeBytes = 0;
            }
          }
          item.isEmpty = !item.fileSizeBytes || item.fileSizeBytes === 0;
          return item;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(recordings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete recording from local directory
app.delete('/api/recordings/:id', (req, res) => {
  const { id } = req.params;
  try {
    const metaPath = path.join(RECORDINGS_DIR, `${id}-meta.json`);
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (meta.videoFileName) {
        const videoPath = path.join(RECORDINGS_DIR, meta.videoFileName);
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      }
      if (meta.transcriptFileName) {
        const transcriptPath = path.join(RECORDINGS_DIR, meta.transcriptFileName);
        if (fs.existsSync(transcriptPath)) fs.unlinkSync(transcriptPath);
      }
      fs.unlinkSync(metaPath);
    }
    res.json({ success: true, message: 'Recording deleted from local directory' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Download recording file
app.get('/api/recordings/download/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(RECORDINGS_DIR, filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// --- WebSocket Signaling Server for SFU & Room Controller ---
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  const clientId = uuidv4();
  clients.set(clientId, { ws });

  ws.on('message', async (data: string) => {
    try {
      const message = JSON.parse(data.toString());
      const { type, roomId, payload, requestId } = message;

      const reply = (responseType: string, responsePayload: any) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: responseType,
            requestId,
            roomId,
            senderId: clientId,
            payload: responsePayload,
          }));
        }
      };

      switch (type) {
        case 'get_router_capabilities': {
          reply('router_capabilities', { rtpCapabilities: routerRtpCapabilities });
          break;
        }

        case 'join_room': {
          const room = getOrCreateRoom(roomId || 'default', payload?.roomName);
          const requestedRole = payload?.role || 'participant';
          const participantName = payload?.name || `User_${clientId.substring(0, 4)}`;

          // Check room lock
          if (room.isLocked && requestedRole !== 'controller') {
            reply('error', { message: 'Room is currently locked by the meeting controller.' });
            return;
          }

          // Authorization: First joiner or explicit controller request is granted Controller role
          let assignedRole: 'controller' | 'speaker' | 'participant' = requestedRole;
          if (!room.controllerId || requestedRole === 'controller') {
            assignedRole = 'controller';
            room.controllerId = clientId;
          }

          const participant: Participant = {
            id: clientId,
            name: participantName,
            role: assignedRole,
            isMuted: false,
            isVideoMuted: false,
            joinedAt: Date.now(),
            producerIds: {},
          };

          room.participants[clientId] = participant;
          const clientData = clients.get(clientId);
          if (clientData) {
            clientData.roomId = room.id;
            clientData.participantId = clientId;
          }

          // Notify sender of success with current room state
          reply('room_joined', {
            participantId: clientId,
            role: assignedRole,
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

          // Notify other participants in the room
          broadcastToRoom(room.id, {
            type: 'participant_joined',
            roomId: room.id,
            payload: { participant },
          }, clientId);
          break;
        }

        case 'create_webrtc_transport': {
          const room = getOrCreateRoom(roomId);
          const transportId = uuidv4();
          const direction = payload?.direction || 'send';

          // Standard mediasoup WebRtcTransport mock/real parameters
          const transportOptions = {
            id: transportId,
            iceParameters: {
              usernameFragment: uuidv4().substring(0, 16),
              password: uuidv4(),
              iceLite: true,
            },
            iceCandidates: [
              {
                foundation: 'udpcandidate',
                ip: '127.0.0.1',
                port: 40000 + Math.floor(Math.random() * 5000),
                priority: 2122260223,
                protocol: 'udp',
                type: 'host',
              },
            ],
            dtlsParameters: {
              role: 'auto',
              fingerprints: [
                {
                  algorithm: 'sha-256',
                  value: '2B:8C:74:95:27:14:4E:51:A4:21:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF',
                },
              ],
            },
          };

          room.transports.set(transportId, {
            id: transportId,
            clientId,
            direction,
            options: transportOptions,
            connected: false,
          });

          reply('webrtc_transport_created', transportOptions);
          break;
        }

        case 'connect_webrtc_transport': {
          const room = getOrCreateRoom(roomId);
          const { transportId } = payload;
          const transport = room.transports.get(transportId);
          if (transport) {
            transport.connected = true;
          }
          reply('webrtc_transport_connected', { transportId });
          break;
        }

        case 'produce': {
          const room = getOrCreateRoom(roomId);
          const { transportId, kind, rtpParameters, appData } = payload;
          const producerId = uuidv4();

          room.producers.set(producerId, {
            id: producerId,
            transportId,
            clientId,
            kind,
            rtpParameters,
            appData,
            paused: false,
          });

          if (room.participants[clientId]) {
            if (kind === 'video') room.participants[clientId].producerIds.video = producerId;
            if (kind === 'audio') room.participants[clientId].producerIds.audio = producerId;
          }

          reply('produced', { id: producerId });

          // Broadcast new producer to room consumers
          broadcastToRoom(room.id, {
            type: 'new_producer',
            roomId: room.id,
            payload: { producerId, participantId: clientId, kind },
          }, clientId);
          break;
        }

        case 'consume': {
          const room = getOrCreateRoom(roomId);
          const { producerId, rtpCapabilities: clientRtpCaps } = payload;
          const consumerId = uuidv4();

          const consumerOptions = {
            id: consumerId,
            producerId,
            kind: 'video',
            rtpParameters: routerRtpCapabilities.codecs[1],
            type: 'simple',
            producerPaused: false,
          };

          room.consumers.set(consumerId, consumerOptions);
          reply('consumed', consumerOptions);
          break;
        }

        // Half-Duplex Feature 8.b1: Client starts speech
        case 'turn_start': {
          const room = getOrCreateRoom(roomId);
          if (room.turnState === 'avatar_speaking') {
            reply('error', { message: 'Half-duplex lock: Avatar is currently speaking. Please wait.' });
            return;
          }

          room.turnState = 'client_speaking';
          room.activeSpeakerId = clientId;

          reply('turn_started', {
            status: 'ok',
            turnState: 'client_speaking',
            activeSpeakerId: clientId,
          });

          broadcastToRoom(room.id, {
            type: 'turn_state_changed',
            roomId: room.id,
            payload: {
              turnState: 'client_speaking',
              activeSpeakerId: clientId,
              message: 'Client has initiated speech transmission.',
            },
          });
          break;
        }

        // Half-Duplex Feature 8.b1: Client declares "Speech is over, now it's your turn"
        case 'turn_over': {
          const room = getOrCreateRoom(roomId);
          room.turnState = 'avatar_speaking';
          room.activeSpeakerId = 'avatar';

          reply('turn_over_ack', {
            status: 'ok',
            turnState: 'avatar_speaking',
          });

          broadcastToRoom(room.id, {
            type: 'turn_state_changed',
            roomId: room.id,
            payload: {
              turnState: 'avatar_speaking',
              activeSpeakerId: 'avatar',
              message: "Client speech completed. Avatar's turn has commenced.",
            },
          });

          // Simulate random generated speech section below avatar with real-time text streaming
          const selectedSpeech = AVATAR_SPEECH_RESPONSES[Math.floor(Math.random() * AVATAR_SPEECH_RESPONSES.length)];
          const words = selectedSpeech.split(' ');
          let currentWordIndex = 0;
          let accumulatedText = '';

          const speechInterval = setInterval(() => {
            if (currentWordIndex < words.length) {
              const chunk = words[currentWordIndex] + ' ';
              accumulatedText += chunk;
              currentWordIndex++;

              broadcastToRoom(room.id, {
                type: 'avatar_speech_chunk',
                roomId: room.id,
                payload: {
                  chunk,
                  fullText: accumulatedText,
                  progress: currentWordIndex / words.length,
                },
              });
            } else {
              clearInterval(speechInterval);
              // Avatar speech complete -> transition back to idle, allowing client to transport stream again
              setTimeout(() => {
                room.turnState = 'idle';
                room.activeSpeakerId = null;

                broadcastToRoom(room.id, {
                  type: 'avatar_speech_complete',
                  roomId: room.id,
                  payload: {
                    completedText: accumulatedText,
                    nextSpeakerAllowed: 'client',
                  },
                });

                broadcastToRoom(room.id, {
                  type: 'turn_state_changed',
                  roomId: room.id,
                  payload: {
                    turnState: 'idle',
                    activeSpeakerId: null,
                    message: 'Avatar speech finished. Client may now start transmitting again.',
                  },
                });
              }, 600);
            }
          }, 150);
          break;
        }

        // Meeting Controller Authorization Action (Requirement 8.a)
        case 'controller_action': {
          const room = getOrCreateRoom(roomId);
          const currentParticipant = room.participants[clientId];

          // Authorization verification: only controllers can execute controller actions
          if (!currentParticipant || currentParticipant.role !== 'controller') {
            reply('error', { message: 'Authorization Failed: Only Meeting Controllers can perform this action.' });
            return;
          }

          const { action, targetParticipantId } = payload;

          switch (action) {
            case 'mute':
              if (targetParticipantId && room.participants[targetParticipantId]) {
                room.participants[targetParticipantId].isMuted = true;
              }
              break;
            case 'unmute':
              if (targetParticipantId && room.participants[targetParticipantId]) {
                room.participants[targetParticipantId].isMuted = false;
              }
              break;
            case 'lock_room':
              room.isLocked = true;
              break;
            case 'unlock_room':
              room.isLocked = false;
              break;
            case 'make_controller':
              if (targetParticipantId && room.participants[targetParticipantId]) {
                room.participants[clientId].role = 'participant';
                room.participants[targetParticipantId].role = 'controller';
                room.controllerId = targetParticipantId;
              }
              break;
            case 'kick':
              if (targetParticipantId && room.participants[targetParticipantId]) {
                const kickedClient = clients.get(targetParticipantId);
                if (kickedClient && kickedClient.ws.readyState === WebSocket.OPEN) {
                  kickedClient.ws.send(JSON.stringify({
                    type: 'error',
                    payload: { message: 'You have been removed from the meeting by the Controller.' },
                  }));
                  kickedClient.ws.close();
                }
                delete room.participants[targetParticipantId];
              }
              break;
          }

          // Broadcast updated room state
          broadcastToRoom(room.id, {
            type: 'room_state_updated',
            roomId: room.id,
            payload: {
              room: {
                id: room.id,
                name: room.name,
                controllerId: room.controllerId,
                isLocked: room.isLocked,
                participants: room.participants,
                turnState: room.turnState,
              },
            },
          });
          break;
        }
      }
    } catch (err: any) {
      console.error('Signaling message error:', err);
    }
  });

  ws.on('close', () => {
    const clientData = clients.get(clientId);
    if (clientData && clientData.roomId) {
      const room = rooms.get(clientData.roomId);
      if (room && room.participants[clientId]) {
        delete room.participants[clientId];

        // Reassign controller if current controller left
        if (room.controllerId === clientId) {
          const remainingIds = Object.keys(room.participants);
          if (remainingIds.length > 0) {
            room.controllerId = remainingIds[0];
            room.participants[remainingIds[0]].role = 'controller';
          }
        }

        broadcastToRoom(room.id, {
          type: 'participant_left',
          roomId: room.id,
          payload: { participantId: clientId },
        });
      }
    }
    clients.delete(clientId);
  });
});

// Vite Middleware for Frontend serving
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[mediasoup-sfu-system] Server & SFU Signaling running on http://0.0.0.0:${PORT}`);
    console.log(`[mediasoup-sfu-system] WebSocket Signaling available at ws://0.0.0.0:${PORT}/ws`);
    console.log(`[mediasoup-sfu-system] Local Recordings Directory at ${RECORDINGS_DIR}`);
  });
}

start();
