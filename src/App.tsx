import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  Radio,
  Users,
  FolderArchive,
  Layers,
  Crown,
  Shield,
  Wifi,
  WifiOff,
  Sparkles,
  Info
} from 'lucide-react';
import { SfuClient } from './services/sfuClient';
import { ParticipantRole, RoomState } from './types';
import { HalfDuplexStudio } from './components/HalfDuplexStudio';
import { MeetingRoom } from './components/MeetingRoom';
import { RecordingsList } from './components/RecordingsList';
import { ArchitectureDocs } from './components/ArchitectureDocs';

export default function App() {
  const [activeTab, setActiveTab] = useState<'studio' | 'room' | 'recordings' | 'architecture'>(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'room' || tab === 'studio' || tab === 'recordings' || tab === 'architecture') {
      return tab;
    }
    return 'studio';
  });
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('connecting');
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [userRole, setUserRole] = useState<ParticipantRole>('controller');
  const [recordingsCount, setRecordingsCount] = useState<number>(0);

  // SFU Client Instance Ref
  const sfuClientRef = useRef<SfuClient | null>(null);

  useEffect(() => {
    const client = new SfuClient({
      onConnectionStatusChange: (status) => setConnectionStatus(status),
      onRoomJoined: (data) => {
        setRoomState(data.room);
        setUserRole(data.role);
      },
      onRoomStateUpdated: (room) => {
        setRoomState(room);
      },
      onTurnStateChanged: (turnState) => {
        setRoomState((prev) => (prev ? { ...prev, turnState } : null));
      },
      onParticipantJoined: (participant) => {
        setRoomState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            participants: { ...prev.participants, [participant.id]: participant },
          };
        });
      },
      onParticipantLeft: (participantId) => {
        setRoomState((prev) => {
          if (!prev) return null;
          const nextParticipants = { ...prev.participants };
          delete nextParticipants[participantId];
          return { ...prev, participants: nextParticipants };
        });
      },
      onError: (msg) => console.warn('[SFU Warning]:', msg),
    });

    sfuClientRef.current = client;

    // Determine initial room, user name, and role from URL or storage
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room') || 'main-sfu-room';
    let storedName = sessionStorage.getItem('sfu_username');
    if (!storedName) {
      storedName = urlParams.get('name') || (window.location.search.includes('name=') ? urlParams.get('name')! : 'Dev Engineer');
      sessionStorage.setItem('sfu_username', storedName);
    }
    const roleParam = (urlParams.get('role') as any) || 'controller';

    // Connect signaling and join default meeting room automatically with auto-reconnect fallback
    const connectAndJoin = async () => {
      try {
        await client.connectSignaling();
        await client.joinRoom(roomParam, storedName!, roleParam);
      } catch (err: any) {
        console.warn('Initial signaling connection attempt deferred to auto-reconnect:', err?.message || err);
      }
    };
    connectAndJoin();

    // Refresh recordings count
    fetchRecordingsCount();

    return () => {
      client.disconnect();
    };
  }, []);

  const fetchRecordingsCount = async () => {
    try {
      const res = await fetch('/api/recordings');
      if (res.ok) {
        const data = await res.json();
        setRecordingsCount(data.length);
      }
    } catch {
      // Ignore initial count error
    }
  };

  const handleRefreshRoom = async () => {
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const rooms = await res.json();
        if (rooms.length > 0) {
          setRoomState((prev) => ({
            ...rooms[0],
            turnState: prev?.turnState || rooms[0].turnState,
          }));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Application Header */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-md px-4 lg:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-indigo-600 to-sky-500 shadow-md shadow-indigo-500/20 text-white">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white">mediasoup-sfu-system</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800">
                SFU v3 PoC
              </span>
            </div>
            <p className="text-xs text-slate-400">
              WebRTC Selective Forwarding Unit with Half-Duplex Turn Architecture
            </p>
          </div>
        </div>

        {/* Status Indicators & Navigation Tabs */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-3 pr-2 border-r border-slate-800 text-xs">
            {/* Connection status */}
            <div className="flex items-center gap-1.5">
              {connectionStatus === 'connected' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-400 font-mono">Signaling Online</span>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                  <span className="text-amber-400 font-mono">Connecting...</span>
                </>
              ) : (
                <button
                  onClick={() => sfuClientRef.current?.connectSignaling(true)}
                  className="flex items-center gap-1.5 hover:opacity-80 transition cursor-pointer"
                  title="Click to reconnect signaling"
                >
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-red-400 font-mono underline underline-offset-2">Offline (Reconnect)</span>
                </button>
              )}
            </div>

            {/* Role badge */}
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-amber-300 font-medium text-xs">
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              <span>Meeting Controller</span>
            </div>
          </div>

          {/* Navigation Tab Bar */}
          <nav className="flex p-1 rounded-xl bg-slate-900 border border-slate-800">
            <button
              id="nav-studio-tab"
              onClick={() => setActiveTab('studio')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'studio'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              <span>Half-Duplex Studio</span>
            </button>

            <button
              id="nav-room-tab"
              onClick={() => setActiveTab('room')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'room'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Meeting Room ({roomState ? Object.keys(roomState.participants).length : 1})</span>
            </button>

            <button
              id="nav-recordings-tab"
              onClick={() => {
                setActiveTab('recordings');
                fetchRecordingsCount();
              }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'recordings'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderArchive className="w-3.5 h-3.5" />
              <span>Local Recordings ({recordingsCount})</span>
            </button>

            <button
              id="nav-architecture-tab"
              onClick={() => setActiveTab('architecture')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'architecture'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Docker & NestJS</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Workspace View */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        {sfuClientRef.current && (
          <>
            {activeTab === 'studio' && (
              <HalfDuplexStudio
                sfuClient={sfuClientRef.current}
                roomState={roomState}
                onSavedRecording={fetchRecordingsCount}
              />
            )}

            {activeTab === 'room' && (
              <MeetingRoom
                sfuClient={sfuClientRef.current}
                roomState={roomState}
                onRefreshRoom={handleRefreshRoom}
              />
            )}

            {activeTab === 'recordings' && (
              <RecordingsList onRecordingsChanged={fetchRecordingsCount} />
            )}

            {activeTab === 'architecture' && (
              <ArchitectureDocs />
            )}
          </>
        )}
      </main>

      {/* Footer info */}
      <footer className="border-t border-slate-900/80 bg-slate-950 py-4 px-6 text-center text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4 max-w-7xl mx-auto w-full">
        <span>
          <strong>mediasoup-sfu-system</strong> — Mediasoup v3 SFU & WebSocket Signaling Proof-of-Concept
        </span>
        <div className="flex items-center gap-4 text-[11px] font-mono">
          <span>Signaling: ws://0.0.0.0:3000/ws</span>
          <span>•</span>
          <span>Storage: ./recordings/</span>
        </div>
      </footer>
    </div>
  );
}
