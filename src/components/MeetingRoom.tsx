import React, { useState, useEffect, useRef } from 'react';
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
  Crown,
  Share2,
  Copy,
  Check,
  RotateCcw,
  VolumeX,
  Volume2,
  ExternalLink,
  SlidersHorizontal,
  X,
  Radio,
  UserX,
} from 'lucide-react';
import { SfuClient } from '../services/sfuClient';
import { Participant, RoomState } from '../types';
import { ParticipantTile } from './ParticipantTile';

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
  const [localStream, setLocalStream] = useState<MediaStream | null>(sfuClient.localStream);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [isMicMuted, setIsMicMuted] = useState<boolean>(sfuClient.isAudioMuted());
  const [isVideoMuted, setIsVideoMuted] = useState<boolean>(sfuClient.isVideoMuted());
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [showParticipantsDrawer, setShowParticipantsDrawer] = useState<boolean>(false);
  const [showHostPanel, setShowHostPanel] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const isCurrentUserController =
    roomState?.controllerId === sfuClient.participantId ||
    sfuClient.currentRole === 'controller';

  const participantsList: Participant[] = roomState
    ? (Object.values(roomState.participants) as Participant[])
    : [];

  const selfParticipant: Participant = roomState?.participants[sfuClient.participantId] || {
    id: sfuClient.participantId || 'self',
    name: sessionStorage.getItem('sfu_username') || 'You',
    role: (sfuClient.currentRole as any) || 'participant',
    isMuted: isMicMuted,
    isVideoMuted: isVideoMuted,
    joinedAt: Date.now(),
    producerIds: {},
  };

  const remoteParticipants = participantsList.filter(
    (p) => p.id !== sfuClient.participantId
  );

  // Initialize Local Media and WebRTC Listeners
  useEffect(() => {
    let isMounted = true;

    const setupMedia = async () => {
      try {
        let stream = sfuClient.localStream;
        if (!stream) {
          stream = await sfuClient.getLocalMediaStream();
        }
        if (isMounted && stream) {
          setLocalStream(stream);
          setIsMicMuted(sfuClient.isAudioMuted());
          setIsVideoMuted(sfuClient.isVideoMuted());
          sfuClient.updateTracksInPeers();
          setupAudioAnalyser(stream);
        }
      } catch (err: any) {
        console.warn('Camera / Mic acquisition warning:', err.message);
      }
    };

    setupMedia();

    // Subscribe to remote stream additions and removals
    const unsubscribe = sfuClient.onRemoteStreamChange((pid, stream) => {
      if (!isMounted) return;
      setRemoteStreams((prev) => {
        if (stream) {
          return { ...prev, [pid]: stream };
        } else {
          const next = { ...prev };
          delete next[pid];
          return next;
        }
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [sfuClient]);

  // Synchronize local hardware tracks with server-authoritative room state (e.g., Host mutes participant or un-mutes)
  const selfRoomData = roomState?.participants[sfuClient.participantId];
  useEffect(() => {
    if (!selfRoomData) return;

    if (typeof selfRoomData.isMuted === 'boolean') {
      if (selfRoomData.isMuted !== isMicMuted) {
        setIsMicMuted(selfRoomData.isMuted);
        sfuClient.setAudioEnabled(!selfRoomData.isMuted);
      }
    }

    if (typeof selfRoomData.isVideoMuted === 'boolean') {
      if (selfRoomData.isVideoMuted !== isVideoMuted) {
        setIsVideoMuted(selfRoomData.isVideoMuted);
        sfuClient.setVideoEnabled(!selfRoomData.isVideoMuted);
      }
    }
  }, [selfRoomData?.isMuted, selfRoomData?.isVideoMuted, sfuClient]);

  // Audio Analyser for Speaking Level Detection
  const setupAudioAnalyser = (stream: MediaStream) => {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        setAudioLevel(avg);
        animationFrameRef.current = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (e) {
      console.warn('Audio analyser setup failed:', e);
    }
  };

  // Toggle Microphone
  const handleToggleMic = () => {
    const newState = sfuClient.toggleAudio();
    setIsMicMuted(!newState);
    onRefreshRoom();
  };

  // Toggle Camera
  const handleToggleCam = () => {
    const newState = sfuClient.toggleVideo();
    setIsVideoMuted(!newState);
    onRefreshRoom();
  };

  // Controller Moderation Actions
  const handleModerateAction = async (
    action:
      | 'mute'
      | 'unmute'
      | 'kick'
      | 'make_controller'
      | 'lock_room'
      | 'unlock_room'
      | 'mute_all'
      | 'unmute_all'
      | 'reclaim_host',
    targetParticipantId?: string
  ) => {
    try {
      await sfuClient.executeControllerAction(action, targetParticipantId);
      const actionName = action.replace(/_/g, ' ');
      setActionNotice(`Successfully executed: ${actionName.toUpperCase()}`);
      setTimeout(() => setActionNotice(null), 3500);
      onRefreshRoom();
    } catch (err: any) {
      setActionNotice(`Action failed: ${err.message}`);
      setTimeout(() => setActionNotice(null), 4000);
    }
  };

  // Copy Room Invite Link
  const handleCopyInviteLink = () => {
    const testAttendeeName = `Colleague_${Math.floor(100 + Math.random() * 900)}`;
    const inviteUrl = `${window.location.origin}${window.location.pathname}?tab=room&room=${roomState?.id || 'main-sfu-room'}&name=${encodeURIComponent(testAttendeeName)}`;
    
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    }).catch(() => {
      prompt('Copy this meeting room link to test multi-user video:', inviteUrl);
    });
  };

  // Open Second Attendee in New Tab for immediate 2-user real video testing
  const handleOpenTestTab = () => {
    const testAttendeeName = `Colleague_${Math.floor(100 + Math.random() * 900)}`;
    const inviteUrl = `${window.location.origin}${window.location.pathname}?tab=room&room=${roomState?.id || 'main-sfu-room'}&name=${encodeURIComponent(testAttendeeName)}`;
    window.open(inviteUrl, '_blank');
  };

  // Calculate Grid Column Layout
  const totalCount = 1 + remoteParticipants.length;
  const gridClass =
    totalCount === 1
      ? 'grid-cols-1 max-w-3xl mx-auto'
      : totalCount === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : totalCount <= 4
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div id="meeting-room-container" className="flex flex-col gap-5 w-full">
      {/* Top Header: Room Title, Lock Status, and Quick Invite */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 lg:p-5 rounded-2xl border border-slate-800/80 bg-slate-900/80 backdrop-blur-md shadow-xl">
        <div className="flex items-center gap-3.5">
          <div
            className={`p-3 rounded-xl border ${
              isCurrentUserController
                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-amber-500/10 shadow-lg'
                : 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
            }`}
          >
            {isCurrentUserController ? (
              <Crown className="w-5 h-5" />
            ) : (
              <Users className="w-5 h-5" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-slate-100">
                {roomState?.name || 'SFU Video Conference'}
              </h2>
              <span
                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                  roomState?.isLocked
                    ? 'bg-red-950/80 border border-red-800 text-red-300'
                    : 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                }`}
              >
                {roomState?.isLocked ? (
                  <>
                    <Lock className="w-3 h-3" />
                    <span>Locked</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-3 h-3" />
                    <span>Open Room</span>
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5 font-mono">
              <span>
                Room: <strong className="text-slate-200">{roomState?.id || 'main-sfu-room'}</strong>
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 font-sans">
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                Host:{' '}
                <strong className="text-amber-300">
                  {isCurrentUserController
                    ? 'You (Controller)'
                    : roomState?.controllerId
                    ? `User_${roomState.controllerId.substring(0, 5)}`
                    : 'Unassigned'}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Action Pills & Multi-User Testing Trigger */}
        <div className="flex items-center gap-2">
          {/* Reclaim Host Button (if role was transferred away during testing) */}
          {!isCurrentUserController && (
            <button
              id="reclaim-host-btn"
              onClick={() => handleModerateAction('reclaim_host')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-950/60 hover:bg-amber-900/60 border border-amber-700/80 text-amber-300 transition"
              title="Reclaim Meeting Host authorization for this session"
            >
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              <span>Reclaim Host</span>
            </button>
          )}

          {/* Test in Second Tab / Window button */}
          <button
            id="test-second-tab-btn"
            onClick={handleOpenTestTab}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 transition"
            title="Open second participant window to test peer video rendering"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Join 2nd Tab (Test Video)</span>
            <span className="sm:hidden">2nd Tab</span>
          </button>

          {/* Copy Invite Link */}
          <button
            id="copy-invite-btn"
            onClick={handleCopyInviteLink}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
              copiedLink
                ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-200'
            }`}
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Link Copied!' : 'Copy Link'}</span>
          </button>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionNotice && (
        <div className="p-3.5 rounded-xl bg-indigo-950/50 border border-indigo-500/40 text-indigo-200 text-xs flex items-center justify-between shadow-lg animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-indigo-400 animate-pulse" />
            <span className="font-medium">{actionNotice}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Video Conference Stage Grid */}
      <div className="relative min-h-[460px] flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/60 p-4 lg:p-6 shadow-2xl">
        <div className={`grid ${gridClass} gap-4 w-full flex-1 items-center justify-center`}>
          {/* 1. Local Participant Video Card */}
          <ParticipantTile
            participant={{
              ...selfParticipant,
              isMuted: isMicMuted,
              isVideoMuted: isVideoMuted,
            }}
            isSelf={true}
            stream={localStream}
            isCurrentUserHost={isCurrentUserController}
            onModerateAction={handleModerateAction}
            audioLevel={isMicMuted ? 0 : audioLevel}
          />

          {/* 2. Remote Participants Video Cards */}
          {remoteParticipants.map((participant) => (
            <ParticipantTile
              key={participant.id}
              participant={participant}
              isSelf={false}
              stream={remoteStreams[participant.id] || null}
              isCurrentUserHost={isCurrentUserController}
              onModerateAction={handleModerateAction}
            />
          ))}
        </div>

        {/* Empty State Banner if Alone */}
        {remoteParticipants.length === 0 && (
          <div className="mt-4 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
            <Users className="w-4 h-4 text-indigo-400" />
            <span>
              You are currently the only person in this meeting room.{' '}
              <button
                onClick={handleOpenTestTab}
                className="text-indigo-400 hover:text-indigo-300 underline font-medium"
              >
                Click here to launch a 2nd tab
              </button>{' '}
              to see live dual-participant WebRTC video streams!
            </span>
          </div>
        )}

        {/* Smooth Floating Control Dock (Bottom Center) */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 z-30">
          <div className="flex items-center gap-2 p-2 rounded-2xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 shadow-2xl">
            {/* Microphone Toggle Button */}
            <button
              id="control-toggle-mic-btn"
              onClick={handleToggleMic}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 shadow-sm ${
                isMicMuted
                  ? 'bg-red-950/80 border border-red-800 text-red-200 hover:bg-red-900/80'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
              title={isMicMuted ? 'Turn on microphone' : 'Mute microphone'}
            >
              {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span>{isMicMuted ? 'Unmute' : 'Mute'}</span>
            </button>

            {/* Camera Toggle Button */}
            <button
              id="control-toggle-cam-btn"
              onClick={handleToggleCam}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 shadow-sm ${
                isVideoMuted
                  ? 'bg-red-950/80 border border-red-800 text-red-200 hover:bg-red-900/80'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
              title={isVideoMuted ? 'Turn on camera' : 'Turn off camera'}
            >
              {isVideoMuted ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
              <span>{isVideoMuted ? 'Start Video' : 'Stop Video'}</span>
            </button>

            {/* Host Moderation Tools Button (Visible to Host) */}
            {isCurrentUserController && (
              <button
                id="control-host-tools-btn"
                onClick={() => setShowHostPanel(!showHostPanel)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition ${
                  showHostPanel
                    ? 'bg-amber-950 border-amber-700 text-amber-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                }`}
                title="Open Meeting Host moderation options"
              >
                <Crown className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">Host Controls</span>
              </button>
            )}

            {/* Participants Roster Drawer Toggle */}
            <button
              id="control-participants-drawer-btn"
              onClick={() => setShowParticipantsDrawer(!showParticipantsDrawer)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition ${
                showParticipantsDrawer
                  ? 'bg-indigo-950 border-indigo-700 text-indigo-300'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              title="View participants list"
            >
              <Users className="w-4 h-4" />
              <span>Attendees ({participantsList.length || 1})</span>
            </button>
          </div>
        </div>

        {/* Host Moderation Quick Tray (When Toggled) */}
        {isCurrentUserController && showHostPanel && (
          <div className="mt-3 p-4 rounded-2xl border border-amber-500/30 bg-slate-900/95 backdrop-blur-xl shadow-2xl flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <Crown className="w-4 h-4 text-amber-400" />
              <span>Host Moderation Console:</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Mute All */}
              <button
                id="host-mute-all-btn"
                onClick={() => handleModerateAction('mute_all')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-amber-950/60 hover:bg-amber-900/60 border border-amber-800/80 text-amber-300 transition"
              >
                <VolumeX className="w-3.5 h-3.5" />
                <span>Mute All</span>
              </button>

              {/* Unmute All */}
              <button
                id="host-unmute-all-btn"
                onClick={() => handleModerateAction('unmute_all')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/80 text-emerald-300 transition"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Unmute All</span>
              </button>

              {/* Toggle Lock Room */}
              <button
                id="host-toggle-lock-btn"
                onClick={() => handleModerateAction(roomState?.isLocked ? 'unlock_room' : 'lock_room')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                  roomState?.isLocked
                    ? 'bg-red-950/80 border-red-800 text-red-200 hover:bg-red-900/80'
                    : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {roomState?.isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                <span>{roomState?.isLocked ? 'Unlock Room' : 'Lock Room'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Slide-Over Participants Roster Drawer */}
      {showParticipantsDrawer && (
        <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-2xl flex flex-col gap-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-bold text-slate-100">
                Connected Meeting Roster ({participantsList.length || 1})
              </h3>
            </div>
            <button
              onClick={() => setShowParticipantsDrawer(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col gap-2.5 max-h-72 overflow-y-auto pr-1">
            {/* Self entry */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-indigo-500/30 bg-indigo-950/15">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-300 font-bold text-xs flex items-center justify-center border border-indigo-500/40">
                  {selfParticipant.name.substring(0, 2).toUpperCase()}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-200">
                      {selfParticipant.name} (You)
                    </span>
                    {isCurrentUserController && (
                      <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                        <Crown className="w-3 h-3 text-amber-400" />
                        Host
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    ID: {selfParticipant.id.substring(0, 6)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className={`p-1.5 rounded-lg text-xs ${
                    isMicMuted ? 'text-red-400 bg-red-950/40' : 'text-emerald-400 bg-emerald-950/40'
                  }`}
                >
                  {isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </span>
                <span
                  className={`p-1.5 rounded-lg text-xs ${
                    isVideoMuted ? 'text-red-400 bg-red-950/40' : 'text-emerald-400 bg-emerald-950/40'
                  }`}
                >
                  {isVideoMuted ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                </span>
              </div>
            </div>

            {/* Remote Participants */}
            {remoteParticipants.map((p) => {
              const isHost = p.role === 'controller';
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/50 hover:border-slate-700 transition"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-xl font-bold text-xs flex items-center justify-center border ${
                        isHost
                          ? 'bg-amber-950/50 text-amber-300 border-amber-500/40'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      {p.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-200">{p.name}</span>
                        {isHost && (
                          <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                            <Crown className="w-3 h-3 text-amber-400" />
                            Host
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ID: {p.id.substring(0, 6)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Media status */}
                    <div className="flex items-center gap-1">
                      <span
                        className={`p-1.5 rounded-lg text-xs ${
                          p.isMuted ? 'text-red-400 bg-red-950/40' : 'text-emerald-400 bg-emerald-950/40'
                        }`}
                      >
                        {p.isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                      </span>
                      <span
                        className={`p-1.5 rounded-lg text-xs ${
                          p.isVideoMuted ? 'text-red-400 bg-red-950/40' : 'text-emerald-400 bg-emerald-950/40'
                        }`}
                      >
                        {p.isVideoMuted ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                      </span>
                    </div>

                    {/* Host Moderation Controls */}
                    {isCurrentUserController && (
                      <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
                        <button
                          onClick={() => handleModerateAction(p.isMuted ? 'unmute' : 'mute', p.id)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                          title={p.isMuted ? 'Unmute participant' : 'Mute participant'}
                        >
                          {p.isMuted ? (
                            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <VolumeX className="w-3.5 h-3.5 text-amber-400" />
                          )}
                        </button>
                        <button
                          onClick={() => handleModerateAction('kick', p.id)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950 text-red-400 transition"
                          title="Remove attendee from meeting room"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
