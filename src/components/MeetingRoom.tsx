import React, { useState } from 'react';
import {
  Users,
  Shield,
  ShieldAlert,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Lock,
  Unlock,
  UserX,
  Crown,
  UserPlus,
  Activity,
  Cpu,
  VolumeX,
  Volume2,
  Settings
} from 'lucide-react';
import { SfuClient } from '../services/sfuClient';
import { Participant, RoomState } from '../types';

interface MeetingRoomProps {
  sfuClient: SfuClient;
  roomState: RoomState | null;
  onRefreshRoom: () => void;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  sfuClient,
  roomState,
  onRefreshRoom,
}) => {
  const [newSimulatedName, setNewSimulatedName] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const isCurrentUserController =
    roomState?.controllerId === sfuClient.participantId ||
    sfuClient.currentRole === 'controller';

  const participantsList: Participant[] = roomState
    ? (Object.values(roomState.participants) as Participant[])
    : [];

  const handleAction = async (
    action: 'mute' | 'unmute' | 'kick' | 'make_controller' | 'lock_room' | 'unlock_room',
    targetParticipantId?: string
  ) => {
    if (!isCurrentUserController) {
      alert('Unauthorized: Only the designated Meeting Controller can execute this command.');
      return;
    }

    try {
      await sfuClient.executeControllerAction(action, targetParticipantId);
      setActionNotice(`Executed controller action: ${action.replace('_', ' ')}`);
      setTimeout(() => setActionNotice(null), 3500);
      onRefreshRoom();
    } catch (err: any) {
      alert(`Controller action failed: ${err.message}`);
    }
  };

  // Helper to add simulated test participants into in-memory room for testing multi-user meetings
  const handleAddSimulatedParticipant = async () => {
    const defaultNames = ['Dr. Sarah Chen', 'Alex Rivera (SFU Dev)', 'Marcus Vance', 'Elena Rostova'];
    const name = newSimulatedName.trim() || defaultNames[Math.floor(Math.random() * defaultNames.length)];

    try {
      // Send join_room request for a simulated participant over WebSocket
      await sfuClient.sendRequest('join_room', {
        name,
        role: 'participant',
      });
      setNewSimulatedName('');
      onRefreshRoom();
    } catch (err: any) {
      console.error('Failed to add participant:', err);
    }
  };

  return (
    <div id="meeting-room-container" className="flex flex-col gap-6">
      {/* Header with Room Info & Controller Authorization Status */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className={`p-3 rounded-xl ${
            isCurrentUserController
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-amber-500/10 shadow-lg'
              : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
          }`}>
            {isCurrentUserController ? <Crown className="w-6 h-6" /> : <Users className="w-6 h-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-slate-100">
                {roomState?.name || 'SFU Video Conference Room'}
              </h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                roomState?.isLocked
                  ? 'bg-red-950/70 border border-red-800 text-red-300'
                  : 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
              }`}>
                {roomState?.isLocked ? 'Locked Room' : 'Open Room'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
              <span>Room ID: <strong className="text-slate-300 font-mono">{roomState?.id || 'default'}</strong></span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                Controller:{' '}
                <strong className="text-amber-300">
                  {isCurrentUserController
                    ? 'You (Authorized Controller)'
                    : roomState?.controllerId ? `User_${roomState.controllerId.substring(0, 5)}` : 'Unassigned'}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Controller Quick Actions Bar */}
        <div className="flex items-center gap-2">
          {isCurrentUserController ? (
            <>
              <button
                id="toggle-room-lock-btn"
                onClick={() => handleAction(roomState?.isLocked ? 'unlock_room' : 'lock_room')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition ${
                  roomState?.isLocked
                    ? 'bg-red-900/40 border-red-700 text-red-200 hover:bg-red-800/50'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {roomState?.isLocked ? <Lock className="w-4 h-4 text-red-400" /> : <Unlock className="w-4 h-4 text-slate-400" />}
                <span>{roomState?.isLocked ? 'Unlock Room' : 'Lock Room'}</span>
              </button>

              <button
                id="controller-mute-all-btn"
                onClick={() => {
                  participantsList.forEach((p) => {
                    if (p.id !== sfuClient.participantId && !p.isMuted) {
                      handleAction('mute', p.id);
                    }
                  });
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-600/20 border border-amber-600/40 text-amber-300 hover:bg-amber-600/30 transition"
              >
                <VolumeX className="w-4 h-4" />
                <span>Mute All Participants</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-400">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>Participant mode (Controller controls restricted)</span>
            </div>
          )}
        </div>
      </div>

      {actionNotice && (
        <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-500/40 text-indigo-300 text-xs flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400 animate-spin" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Participants Roster & Moderation Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-4 p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-sky-400" />
              <h3 className="text-base font-semibold text-slate-100">
                Connected Meeting Participants ({participantsList.length})
              </h3>
            </div>
            <span className="text-xs text-slate-400">In-Memory SFU State</span>
          </div>

          <div className="flex flex-col gap-2.5">
            {participantsList.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No participants connected yet. Join the room above.
              </div>
            ) : (
              participantsList.map((participant) => {
                const isSelf = participant.id === sfuClient.participantId;
                const isController = participant.role === 'controller';

                return (
                  <div
                    key={participant.id}
                    className={`flex items-center justify-between p-3.5 rounded-xl border transition ${
                      isController
                        ? 'border-amber-500/30 bg-amber-950/15'
                        : isSelf
                        ? 'border-sky-500/30 bg-sky-950/15'
                        : 'border-slate-800 bg-slate-950/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar initial */}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${
                        isController
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : isSelf
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}>
                        {participant.name.substring(0, 2).toUpperCase()}
                      </div>

                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-200">
                            {participant.name}
                          </span>
                          {isSelf && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                              You
                            </span>
                          )}
                          {isController && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/80 border border-amber-700 text-amber-300">
                              <Crown className="w-3 h-3 text-amber-400" />
                              Controller
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 font-mono">
                          <span>ID: {participant.id.substring(0, 6)}</span>
                          <span>•</span>
                          <span>Joined {new Date(participant.joinedAt).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Participant Media Status & Controller Actions */}
                    <div className="flex items-center gap-2">
                      {/* Media indicators */}
                      <div className="flex items-center gap-1 mr-2">
                        <span className={`p-1.5 rounded-lg border ${
                          participant.isMuted
                            ? 'bg-red-950/40 border-red-800 text-red-400'
                            : 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
                        }`}>
                          {participant.isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                        </span>
                        <span className={`p-1.5 rounded-lg border ${
                          participant.isVideoMuted
                            ? 'bg-red-950/40 border-red-800 text-red-400'
                            : 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
                        }`}>
                          {participant.isVideoMuted ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                        </span>
                      </div>

                      {/* Controller Moderation Action Buttons (Requirement 8.a) */}
                      {isCurrentUserController && !isSelf && (
                        <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
                          {/* Mute/Unmute */}
                          <button
                            onClick={() => handleAction(participant.isMuted ? 'unmute' : 'mute', participant.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                            title={participant.isMuted ? 'Unmute participant' : 'Mute participant'}
                          >
                            {participant.isMuted ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5 text-amber-400" />}
                          </button>

                          {/* Delegate Controller Role */}
                          <button
                            onClick={() => handleAction('make_controller', participant.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs transition"
                            title="Promote to Meeting Controller"
                          >
                            <Crown className="w-3.5 h-3.5" />
                          </button>

                          {/* Kick */}
                          <button
                            onClick={() => handleAction('kick', participant.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-900/40 text-red-400 text-xs transition"
                            title="Remove participant from room"
                          >
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Sidebar: Add Simulated Participants & SFU Telemetry */}
        <div className="flex flex-col gap-4">
          {/* Add Simulated Participant Box */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl flex flex-col gap-3">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
              <UserPlus className="w-4 h-4 text-emerald-400" />
              <span>Multi-User Simulation</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Add simulated attendees to test multi-participant stage controls, controller role delegations, and in-memory room management.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                value={newSimulatedName}
                onChange={(e) => setNewSimulatedName(e.target.value)}
                placeholder="Attendee name..."
                className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                id="add-simulated-participant-btn"
                onClick={handleAddSimulatedParticipant}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-1"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>

          {/* Mediasoup SFU Telemetry Box */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl flex flex-col gap-3">
            <div className="flex items-center justify-between text-slate-200 font-semibold text-sm">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-purple-400" />
                <span>Mediasoup SFU Router</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                ACTIVE
              </span>
            </div>

            <div className="flex flex-col gap-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Audio Codec:</span>
                <span className="font-mono text-slate-200">audio/opus (48kHz stereo)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Video Codec:</span>
                <span className="font-mono text-slate-200">video/VP8 (PT 96, NACK, PLI)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Fallback Codec:</span>
                <span className="font-mono text-slate-200">video/H264 (PT 97)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Signaling Protocol:</span>
                <span className="font-mono text-slate-200">WebSocket JSON-RPC</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">State Persistence:</span>
                <span className="font-mono text-slate-200">In-Memory (Ephemeral)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
