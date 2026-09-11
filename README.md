# mediasoup-sfu-system

A prototype of a WebRTC Selective Forwarding Unit (SFU) system powered by **mediasoup** and **mediasoup-client**, designed for real-time video conferencing, half-duplex avatar speech interaction, and local recording persistence.

## 🚀 Key Features

1. **Selective Forwarding Unit (SFU)**: Built on mediasoup v3 router architecture with support for audio/opus, video/VP8, and video/H264 packet routing.
2. **WebSocket Signaling**: Handles SDP negotiation, WebRTC transport parameter exchange (`iceParameters`, `iceCandidates`, `dtlsParameters`), and produce/consume events.
3. **Meeting Controller Authorization**: In-memory room state management allowing the designated Controller to mute/unmute participants, kick attendees, lock the room, and delegate host privileges.
4. **Half-Duplex Client & Avatar Communication**:
   - Client camera view on the left with dedicated **"Start Speech"** and **"Speech Over"** handover buttons.
   - Interactive Avatar on the right with real-time text streaming below the avatar simulating an AI conversation partner.
   - Half-duplex enforcement: when avatar speaks, client transport is locked; when avatar finishes, client is re-enabled to transmit again.
5. **Local Directory Persistence**: Captured video streams and generated speech transcripts are written directly into `./recordings/` on the local disk.
6. **Complete Docker Compose Stack**: Separate NestJS backend with native C++ mediasoup worker compilation and ReactJS frontend served via Nginx.

---

## 🛠️ Project Structure

```
mediasoup-sfu-system/
├── docker-compose.yml              # Complete multi-container stack definition
├── backend/                        # Separate NestJS Back-End Service
│   ├── Dockerfile                  # Debian Bookworm container with build-essential & python3
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       ├── config/mediasoup.config.ts
│       └── modules/
│           ├── sfu/                # Mediasoup Worker, Router, & Transports
│           ├── signaling/          # WebSocket Gateway
│           ├── room/               # In-Memory State & Controller Guards
│           └── recording/          # Local Video & Transcript Storage
├── frontend/                       # Front-End Container Specification
│   └── Dockerfile                  # Multi-stage build with Nginx proxy
├── recordings/                     # Project Local Directory for Saved Videos & Transcripts
├── server.ts                       # Integrated Full-Stack Runner (Express + Vite + SFU WS)
└── src/                            # ReactJS Front-End Application
    ├── main.tsx
    ├── App.tsx
    ├── types.ts
    ├── services/sfuClient.ts       # mediasoup-client WebRTC device & transport wrapper
    └── components/
        ├── HalfDuplexStudio.tsx    # Left camera, Right avatar, Start/Over controls
        ├── MeetingRoom.tsx         # Multi-participant roster & controller authorization
        ├── RecordingsList.tsx      # Video player, transcript viewer, and file downloader
        └── ArchitectureDocs.tsx    # Stack documentation & code inspector
```

---

## 🐳 Running with Docker Compose

To launch both the NestJS backend (with mediasoup worker compilation) and the React frontend:

```bash
# 1. Build and start the containers
docker-compose up --build -d

# 2. Access the application
# Frontend: http://localhost:3000
# Backend Signaling & API: http://localhost:3001
# WebRTC SFU UDP/TCP Ports: 40000 - 40100
```

---

## 💻 Development Mode

To run in development mode with hot-reloading:

```bash
# Install dependencies
npm install

# Start the full-stack server
npm run dev
```
