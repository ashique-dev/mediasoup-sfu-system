import React, { useState } from 'react';
import {
  Server,
  Layers,
  Container,
  Code2,
  FileCode,
  CheckCircle2,
  Copy,
  Terminal,
  Cpu,
  Network
} from 'lucide-react';

export const ArchitectureDocs: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'docker' | 'nestjs' | 'mediasoup' | 'topology'>('docker');
  const [copied, setCopied] = useState(false);

  const copyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const dockerComposeYaml = `version: '3.8'

services:
  # Separate NestJS Back-End Service (Mediasoup SFU Node)
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: mediasoup-sfu-backend
    restart: unless-stopped
    ports:
      - "3001:3001"           # HTTP & WebSocket Signaling Port
      - "40000-40100:40000-40100/udp" # WebRTC SFU Media RTP Ports (UDP)
      - "40000-40100:40000-40100/tcp" # WebRTC SFU Media RTP Ports (TCP Fallback)
    environment:
      - NODE_ENV=production
      - PORT=3001
      - MEDIASOUP_LISTEN_IP=0.0.0.0
      - MEDIASOUP_ANNOUNCED_IP=127.0.0.1
      - MEDIASOUP_MIN_PORT=40000
      - MEDIASOUP_MAX_PORT=40100
    volumes:
      - ./recordings:/app/recordings # Local directory mount for saved video & text
    networks:
      - sfu-network

  # Separate ReactJS Front-End Service
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: mediasoup-sfu-frontend
    restart: unless-stopped
    ports:
      - "3000:80"             # Web Nginx Proxy Port
    depends_on:
      - backend
    environment:
      - VITE_SIGNALING_URL=ws://localhost:3001/ws
    networks:
      - sfu-network

networks:
  sfu-network:
    driver: bridge`;

  const nestJsSignalingGateway = `@WebSocketGateway({
  path: '/ws',
  cors: { origin: '*' }
})
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly sfuService: SfuService,
    private readonly roomService: RoomService,
  ) {}

  @SubscribeMessage('get_router_capabilities')
  handleGetCapabilities(): WsResponse<any> {
    const rtpCapabilities = this.sfuService.getRouterCapabilities();
    return { event: 'router_capabilities', data: { rtpCapabilities } };
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(client: Socket, payload: { roomId: string; name: string; role: string }) {
    const room = this.roomService.join(payload.roomId, client.id, payload.name, payload.role);
    return { event: 'room_joined', data: { participantId: client.id, role: payload.role, room } };
  }

  @SubscribeMessage('create_webrtc_transport')
  async handleCreateTransport(client: Socket, payload: { roomId: string; direction: string }) {
    const transportParams = await this.sfuService.createWebRtcTransport(payload.roomId, client.id, payload.direction);
    return { event: 'webrtc_transport_created', data: transportParams };
  }

  @SubscribeMessage('produce')
  async handleProduce(client: Socket, payload: any) {
    const producerId = await this.sfuService.produce(payload.transportId, payload.kind, payload.rtpParameters);
    return { event: 'produced', data: { id: producerId } };
  }

  // Half-duplex turn handling (Client signals "Speech Over")
  @SubscribeMessage('turn_over')
  async handleTurnOver(client: Socket, payload: { roomId: string }) {
    this.roomService.setTurnState(payload.roomId, 'avatar_speaking');
    this.server.to(payload.roomId).emit('turn_state_changed', { turnState: 'avatar_speaking' });
    
    // Simulate streaming text speech below avatar
    this.streamAvatarSpeech(payload.roomId);
  }
}`;

  return (
    <div id="architecture-docs-container" className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              mediasoup-sfu-system Architecture & Docker Stack
            </h2>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
              <span>NestJS Backend</span>
              <span>•</span>
              <span>ReactJS Frontend</span>
              <span>•</span>
              <span>Mediasoup SFU</span>
              <span>•</span>
              <span>Docker Compose</span>
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex p-1 rounded-xl bg-slate-950 border border-slate-800">
          <button
            onClick={() => setActiveTab('docker')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'docker'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Container className="w-3.5 h-3.5" />
            <span>docker-compose.yml</span>
          </button>

          <button
            onClick={() => setActiveTab('nestjs')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'nestjs'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>NestJS Signaling</span>
          </button>

          <button
            onClick={() => setActiveTab('topology')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'topology'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Half-Duplex Flow</span>
          </button>
        </div>
      </div>

      {/* Code / Content Area */}
      <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl flex flex-col gap-4">
        {activeTab === 'docker' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                <FileCode className="w-4 h-4 text-purple-400" />
                <span>docker-compose.yml</span>
              </div>
              <button
                onClick={() => copyCode(dockerComposeYaml)}
                className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
              <code>{dockerComposeYaml}</code>
            </pre>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 text-xs">
                <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-sky-400" />
                  <span>How to Launch with Docker</span>
                </h4>
                <p className="text-slate-400 mb-2">Run the complete stack with mediasoup worker ports configured:</p>
                <div className="p-2 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-emerald-400">
                  docker-compose up --build -d
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 text-xs">
                <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-purple-400" />
                  <span>Mediasoup Worker Compiling</span>
                </h4>
                <p className="text-slate-400">
                  The backend Dockerfile uses <code>node:20-bookworm</code> with <code>build-essential</code> and <code>python3-pip</code> so the native mediasoup-worker C++ binary compiles with zero errors!
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'nestjs' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                <FileCode className="w-4 h-4 text-sky-400" />
                <span>backend/src/modules/signaling/signaling.gateway.ts</span>
              </div>
              <button
                onClick={() => copyCode(nestJsSignalingGateway)}
                className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
              <code>{nestJsSignalingGateway}</code>
            </pre>
          </div>
        )}

        {activeTab === 'topology' && (
          <div className="flex flex-col gap-5 text-slate-300 text-xs leading-relaxed">
            <h3 className="text-sm font-bold text-slate-100">Half-Duplex Client & SFU Interaction Flow</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 flex flex-col gap-2">
                <span className="font-bold text-emerald-400 text-sm">Step 1: Client Speaks</span>
                <p className="text-slate-400 text-xs">
                  Client clicks <strong>Start</strong>. WebRTC SendTransport activates. Video & Audio tracks are produced to the SFU Router. Recording buffer captures chunk streams.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-950/20 flex flex-col gap-2">
                <span className="font-bold text-amber-400 text-sm">Step 2: Speech Over Handover</span>
                <p className="text-slate-400 text-xs">
                  Client clicks <strong>Speech Over</strong>. WebSocket sends <code>turn_over</code>. Half-duplex circuit locks client transport and designates avatar turn.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-950/20 flex flex-col gap-2">
                <span className="font-bold text-purple-400 text-sm">Step 3: Avatar Speaks & Releases</span>
                <p className="text-slate-400 text-xs">
                  Backend streams speech tokens below avatar in real-time. Upon completion, channel returns to idle and re-enables client to transmit again.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 flex flex-col gap-2">
              <span className="font-bold text-slate-200">Local Directory Persistence Strategy (Requirement 8.b2)</span>
              <p className="text-slate-400">
                Media chunks are merged into a continuous video file and uploaded with conversation transcript JSON to <code>/api/recordings/save</code>. The file is written directly to the host's <code>./recordings/</code> directory.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
