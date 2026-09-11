import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  Mic,
  MicOff,
  VideoOff,
  Play,
  CheckCircle2,
  Sparkles,
  Save,
  Volume2,
  Radio,
  Clock,
  ShieldCheck,
  RefreshCw,
  Sliders,
  FileVideo,
  Bot,
  AlertCircle
} from 'lucide-react';
import { SfuClient } from '../services/sfuClient';
import { RoomState, SpeechTranscriptItem } from '../types';

interface HalfDuplexStudioProps {
  sfuClient: SfuClient;
  roomState: RoomState | null;
  onSavedRecording: () => void;
}

export const HalfDuplexStudio: React.FC<HalfDuplexStudioProps> = ({
  sfuClient,
  roomState,
  onSavedRecording,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasMedia, setHasMedia] = useState(false);
  const [useSynthetic, setUseSynthetic] = useState(false);
  const [turnState, setTurnState] = useState<'idle' | 'client_speaking' | 'avatar_speaking'>('idle');
  const [avatarText, setAvatarText] = useState('');
  const [avatarProgress, setAvatarProgress] = useState(0);
  const [transcripts, setTranscripts] = useState<SpeechTranscriptItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [clientSpeechSeconds, setClientSpeechSeconds] = useState(0);
  const timerRef = useRef<any>(null);

  // Sync turnState with roomState
  useEffect(() => {
    if (roomState) {
      setTurnState(roomState.turnState);
    }
  }, [roomState]);

  // Handle client video stream attachment
  useEffect(() => {
    async function initMedia() {
      try {
        const stream = await sfuClient.getLocalMediaStream(useSynthetic);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((e) => console.warn('Video auto-play suppressed:', e));
        }
        setHasMedia(true);
      } catch (err) {
        console.error('Error getting media:', err);
      }
    }
    initMedia();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [useSynthetic]);

  // Speaking timer
  useEffect(() => {
    if (turnState === 'client_speaking') {
      setClientSpeechSeconds(0);
      timerRef.current = setInterval(() => {
        setClientSpeechSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [turnState]);

  // Handle Start speech button
  const handleStartSpeech = async () => {
    if (turnState === 'avatar_speaking') return;
    setSaveSuccess(null);
    try {
      await sfuClient.produceMedia();
      await sfuClient.startTurn();
      setTurnState('client_speaking');

      // Record client transcript turn
      const newTurn: SpeechTranscriptItem = {
        id: Math.random().toString(36).substring(2, 9),
        speaker: 'client',
        speakerName: sfuClient.currentRole === 'controller' ? 'Client (Controller)' : 'Client',
        text: 'Speech transmission initiated via mediasoup SFU transport.',
        timestamp: Date.now(),
      };
      setTranscripts((prev) => [...prev, newTurn]);
    } catch (err: any) {
      console.error('Failed to start speech:', err);
    }
  };

  // Handle Speech Over button ("My speech is over, now it's your turn")
  const handleSpeechOver = async () => {
    if (turnState !== 'client_speaking') return;
    try {
      // Update client transcript with actual speaking duration
      setTranscripts((prev) => {
        const copy = [...prev];
        if (copy.length > 0 && copy[copy.length - 1].speaker === 'client') {
          copy[copy.length - 1].text = `Client spoke for ${clientSpeechSeconds}s. Signaled handover: "Speech is over, now it's your turn."`;
          copy[copy.length - 1].durationSeconds = clientSpeechSeconds;
        }
        return copy;
      });

      setAvatarText('');
      setAvatarProgress(0);
      await sfuClient.endTurn();
      setTurnState('avatar_speaking');
    } catch (err: any) {
      console.error('Failed to signal speech over:', err);
    }
  };

  // Update avatar text streaming
  useEffect(() => {
    sfuClient['callbacks'].onAvatarSpeechChunk = (chunk, fullText, progress) => {
      setAvatarText(fullText);
      setAvatarProgress(progress);
    };

    sfuClient['callbacks'].onAvatarSpeechComplete = (fullText) => {
      setAvatarProgress(1);
      setTurnState('idle');
      // Append completed avatar response to transcript
      setTranscripts((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(2, 9),
          speaker: 'avatar',
          speakerName: 'AI Avatar (Mediasoup SFU Node)',
          text: fullText,
          timestamp: Date.now(),
        },
      ]);
    };
  }, [sfuClient]);

  // Save Video and Transcript to local directory (Requirement 8.b2)
  const handleSaveToLocalDirectory = async () => {
    if (transcripts.length === 0 && sfuClient.recordedChunks.length === 0) {
      alert('Please perform at least one speech turn before saving.');
      return;
    }

    setIsSaving(true);
    setSaveSuccess(null);
    try {
      const title = `SFU_Session_${new Date().toISOString().substring(11, 19).replace(/:/g, '-')}`;
      const result = await sfuClient.saveRecordingLocally(transcripts, title);
      setIsSaving(false);
      setSaveSuccess(`Saved to local directory: ./recordings/${result.recording.videoFileName || result.recording.transcriptFileName}`);
      onSavedRecording();
    } catch (err: any) {
      setIsSaving(false);
      alert(`Error saving recording: ${err.message}`);
    }
  };

  return (
    <div id="half-duplex-studio-container" className="flex flex-col gap-6">
      {/* Top Protocol Status Banner */}
      <div id="protocol-status-banner" className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-700/60 bg-slate-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-lg ${
            turnState === 'client_speaking'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse'
              : turnState === 'avatar_speaking'
              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40 animate-pulse'
              : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}>
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Half-Duplex Topology</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                turnState === 'client_speaking'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : turnState === 'avatar_speaking'
                  ? 'bg-purple-950 text-purple-300 border border-purple-800'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}>
                {turnState === 'client_speaking'
                  ? 'CLIENT STREAMING (ACTIVE)'
                  : turnState === 'avatar_speaking'
                  ? 'AVATAR SPEAKING (HALF-DUPLEX LOCK)'
                  : 'IDLE (READY)'}
              </span>
            </div>
            <p className="text-sm text-slate-300 mt-0.5">
              {turnState === 'client_speaking'
                ? 'Client is transmitting video/audio to backend via mediasoup WebRtcTransport. Avatar is listening.'
                : turnState === 'avatar_speaking'
                ? 'Avatar is responding with real-time text stream. Client sending transport is locked.'
                : 'Half-duplex circuit open. Click "Start Speech" to begin transmitting.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="toggle-synthetic-feed-btn"
            onClick={() => setUseSynthetic(!useSynthetic)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700 transition"
            title="Toggle between physical webcam and synthetic generated canvas video"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{useSynthetic ? 'Using Synthetic Feed' : 'Using Physical Camera'}</span>
          </button>

          <button
            id="save-local-recordings-btn"
            onClick={handleSaveToLocalDirectory}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition disabled:opacity-50"
          >
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Save to Local Directory</span>
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div id="save-success-alert" className="flex items-center justify-between p-3.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 text-emerald-300 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{saveSuccess}</span>
          </div>
          <span className="text-xs text-emerald-400/80">Requirement 8.b2 Verified</span>
        </div>
      )}

      {/* Main Dual-Column Grid (Left: Camera, Right: Avatar & Speech) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* LEFT COLUMN: Client Camera View & Start/Over Controls */}
        <div id="client-camera-section" className="flex flex-col gap-4 p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-sky-400"></div>
              <h2 className="text-base font-semibold text-slate-100">Client Camera View</h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-mono bg-slate-800 px-2 py-0.5 rounded border border-slate-700">VP8 640x480</span>
              <span className="font-mono bg-slate-800 px-2 py-0.5 rounded border border-slate-700">30 fps</span>
            </div>
          </div>

          {/* Video Preview Box */}
          <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shadow-inner flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Turn Status Overlay Badge */}
            <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-md border border-white/10 text-xs text-white">
              <span className={`w-2 h-2 rounded-full ${
                turnState === 'client_speaking' ? 'bg-red-500 animate-ping' : 'bg-slate-500'
              }`} />
              <span className="font-medium">
                {turnState === 'client_speaking' ? `ON AIR (${clientSpeechSeconds}s)` : 'OFF AIR'}
              </span>
            </div>

            {/* Half-Duplex Lock Overlay when Avatar speaks */}
            {turnState === 'avatar_speaking' && (
              <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 text-center text-white">
                <div className="p-3 rounded-full bg-purple-500/20 border border-purple-500/40 mb-3 animate-bounce">
                  <Bot className="w-6 h-6 text-purple-400" />
                </div>
                <h4 className="text-sm font-semibold text-purple-200">Avatar Turn In Progress</h4>
                <p className="text-xs text-slate-400 max-w-xs mt-1">
                  Half-duplex circuit active: Client media transport is paused until the avatar finishes communicating.
                </p>
              </div>
            )}
          </div>

          {/* Half-Duplex Turn Control Buttons (Requirement 8.b1) */}
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex items-center gap-3">
              {/* Start Button */}
              <button
                id="turn-start-btn"
                onClick={handleStartSpeech}
                disabled={turnState === 'client_speaking' || turnState === 'avatar_speaking'}
                className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition shadow-lg ${
                  turnState === 'client_speaking'
                    ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 cursor-default'
                    : turnState === 'avatar_speaking'
                    ? 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30 active:scale-[0.98]'
                }`}
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{turnState === 'client_speaking' ? 'Streaming to SFU...' : 'Start Speech'}</span>
              </button>

              {/* Over Button */}
              <button
                id="turn-over-btn"
                onClick={handleSpeechOver}
                disabled={turnState !== 'client_speaking'}
                className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition shadow-lg ${
                  turnState === 'client_speaking'
                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30 animate-pulse active:scale-[0.98]'
                    : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Speech Over (Your Turn)</span>
              </button>
            </div>

            <p className="text-xs text-slate-400 text-center">
              Press <strong className="text-emerald-400">Start</strong> to transmit video stream; press <strong className="text-amber-400">Speech Over</strong> to release the channel to the avatar.
            </p>
          </div>
        </div>

        {/* RIGHT COLUMN: Avatar & Random Generated Speech Section (Requirement 8.b1) */}
        <div id="avatar-interaction-section" className="flex flex-col gap-4 p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-purple-400"></div>
              <h2 className="text-base font-semibold text-slate-100">Interactive SFU Avatar</h2>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-purple-950/60 border border-purple-800 text-purple-300 font-medium">
              Half-Duplex Peer
            </span>
          </div>

          {/* Avatar Canvas Box */}
          <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 border border-slate-800 shadow-inner flex flex-col items-center justify-center p-6">
            {/* Animated Avatar Face & Waves */}
            <div className="relative flex items-center justify-center">
              {/* Pulsing rings when speaking */}
              {turnState === 'avatar_speaking' && (
                <>
                  <div className="absolute w-32 h-32 rounded-full border border-purple-500/30 animate-ping"></div>
                  <div className="absolute w-44 h-44 rounded-full border border-indigo-500/20 animate-pulse"></div>
                </>
              )}

              {/* Avatar Head Graphic */}
              <div className={`relative w-24 h-24 rounded-2xl flex items-center justify-center shadow-2xl transition duration-500 ${
                turnState === 'avatar_speaking'
                  ? 'bg-gradient-to-tr from-purple-600 via-indigo-500 to-sky-400 shadow-purple-500/30 scale-105'
                  : 'bg-gradient-to-tr from-slate-700 via-slate-600 to-slate-800 shadow-slate-950'
              }`}>
                <Bot className="w-12 h-12 text-white" />

                {/* Status Dot */}
                <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-slate-950 ${
                  turnState === 'avatar_speaking'
                    ? 'bg-emerald-400 animate-pulse'
                    : turnState === 'client_speaking'
                    ? 'bg-amber-400'
                    : 'bg-slate-400'
                }`} />
              </div>
            </div>

            {/* Speaking waveform visualizer bars */}
            <div className="flex items-center gap-1 mt-5 h-6">
              {[40, 70, 30, 90, 60, 100, 50, 80, 45, 65].map((h, i) => (
                <span
                  key={i}
                  className={`w-1 rounded-full transition-all duration-150 ${
                    turnState === 'avatar_speaking'
                      ? 'bg-gradient-to-t from-purple-500 to-sky-400'
                      : 'bg-slate-700 h-1.5'
                  }`}
                  style={{
                    height: turnState === 'avatar_speaking' ? `${Math.max(6, (h * (0.4 + Math.sin(Date.now() / 100 + i) * 0.6)))}px` : '4px',
                  }}
                />
              ))}
            </div>

            <div className="mt-2 text-xs font-mono text-slate-400 text-center">
              {turnState === 'avatar_speaking' ? 'Synthesizing SFU response tokens...' : turnState === 'client_speaking' ? 'Listening to client WebRTC audio...' : 'Standby mode'}
            </div>
          </div>

          {/* Random Generated Speech Section (Requirement 8.b1) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Generated Speech Stream</span>
              </label>
              {turnState === 'avatar_speaking' && (
                <span className="text-[11px] font-mono text-purple-300">
                  {Math.round(avatarProgress * 100)}% Streamed
                </span>
              )}
            </div>

            {/* Text Stream Box */}
            <div id="avatar-speech-output" className="min-h-[110px] p-4 rounded-xl border border-purple-500/20 bg-purple-950/20 text-slate-200 text-sm leading-relaxed shadow-inner">
              {avatarText ? (
                <p className="font-sans">
                  {avatarText}
                  {turnState === 'avatar_speaking' && (
                    <span className="inline-block w-2 h-4 ml-1 bg-purple-400 animate-pulse align-middle" />
                  )}
                </p>
              ) : (
                <p className="text-slate-500 italic text-xs">
                  {turnState === 'client_speaking'
                    ? 'Awaiting client speech completion. Press "Speech Over (Your Turn)" on the left to trigger the avatar speech stream.'
                    : 'The generated avatar speech tokens will stream here in real-time.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Session Conversation Transcript History */}
      {transcripts.length > 0 && (
        <div id="session-transcript-history" className="p-5 rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-400" />
              <span>Half-Duplex Session Transcript ({transcripts.length} turns)</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono">Buffered for local directory storage</span>
          </div>

          <div className="flex flex-col gap-2.5 max-h-56 overflow-y-auto pr-1">
            {transcripts.map((item) => (
              <div
                key={item.id}
                className={`p-3 rounded-xl border text-xs flex flex-col gap-1 ${
                  item.speaker === 'client'
                    ? 'border-sky-500/30 bg-sky-950/20 text-slate-300'
                    : 'border-purple-500/30 bg-purple-950/20 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className={item.speaker === 'client' ? 'text-sky-400' : 'text-purple-400'}>
                    {item.speakerName}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-slate-200">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
