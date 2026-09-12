import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  VideoOff,
  Crown,
  Volume2,
  VolumeX,
  UserX,
  Shield,
} from 'lucide-react';
import { Participant } from '../types';

interface ParticipantTileProps {
  participant: Participant;
  isSelf: boolean;
  stream: MediaStream | null;
  isCurrentUserHost: boolean;
  onModerateAction: (
    action: 'mute' | 'unmute' | 'kick' | 'make_controller',
    targetParticipantId: string
  ) => void;
  audioLevel?: number;
}

export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  participant,
  isSelf,
  stream,
  isCurrentUserHost,
  onModerateAction,
  audioLevel = 0,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);

  const effectiveAudioLevel = isSelf ? audioLevel : remoteAudioLevel;
  const isSpeaking = !participant.isMuted && effectiveAudioLevel > 15;
  const hasVideoTrack = !!(stream && stream.getVideoTracks().length > 0 && stream.getVideoTracks().some(t => t.enabled));
  const isVideoActive = !participant.isVideoMuted && hasVideoTrack;
  const isHost = participant.role === 'controller';

  // Video attachment and playback handling
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      video.muted = isSelf; // Self stream is muted to prevent local audio echo; remote stream is unmuted
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setAutoplayBlocked(false);
          })
          .catch((err) => {
            // Browser policy blocked unmuted autoplay for remote video
            if (!isSelf) {
              setAutoplayBlocked(true);
            }
          });
      }
    } else {
      video.srcObject = null;
    }
  }, [stream, isSelf, isVideoActive]);

  // Audio analysis for remote participants to detect speaking in real-time
  useEffect(() => {
    if (isSelf || !stream || participant.isMuted) {
      setRemoteAudioLevel(0);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    let active = true;
    let audioCtx: AudioContext | null = null;
    let animId: number | null = null;

    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!active) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const avg = sum / bufferLength;
        setRemoteAudioLevel(avg);
        animId = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (e) {
      // AudioContext policy catch
    }

    return () => {
      active = false;
      if (animId) cancelAnimationFrame(animId);
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    };
  }, [stream, isSelf, participant.isMuted]);

  const handleTileClick = () => {
    if (videoRef.current) {
      videoRef.current.play().then(() => setAutoplayBlocked(false)).catch(() => {});
    }
  };

  return (
    <div
      id={`tile-${participant.id}`}
      onClick={handleTileClick}
      className={`group relative flex flex-col items-center justify-center rounded-2xl overflow-hidden bg-slate-900 border transition-all duration-300 shadow-xl aspect-video min-h-[220px] ${
        isSpeaking
          ? 'border-emerald-500/80 ring-2 ring-emerald-500/40 shadow-emerald-500/10'
          : isHost
          ? 'border-amber-500/40 hover:border-amber-500/70'
          : isSelf
          ? 'border-indigo-500/40 hover:border-indigo-500/70'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Actual Live WebRTC Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isVideoActive ? 'opacity-100' : 'opacity-0 absolute'
        }`}
      />

      {/* Autoplay blocked banner for remote video */}
      {autoplayBlocked && !isSelf && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-xs cursor-pointer">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg transition">
            <Volume2 className="w-4 h-4 animate-pulse" />
            <span>Click to Unmute Stream</span>
          </div>
        </div>
      )}

      {/* Fallback Display when Camera is turned off or connecting */}
      {!isVideoActive && (
        <div className="flex flex-col items-center justify-center gap-3 p-6 text-center select-none animate-in fade-in duration-200">
          <div
            className={`relative flex items-center justify-center w-20 h-20 rounded-2xl font-bold text-2xl shadow-inner border transition-transform duration-200 ${
              isSpeaking ? 'scale-105' : ''
            } ${
              isHost
                ? 'bg-amber-950/50 text-amber-300 border-amber-500/40'
                : isSelf
                ? 'bg-indigo-950/50 text-indigo-300 border-indigo-500/40'
                : 'bg-slate-800/80 text-slate-300 border-slate-700'
            }`}
          >
            {participant.name ? participant.name.substring(0, 2).toUpperCase() : 'U'}
            {isSpeaking && (
              <span className="absolute -inset-1 rounded-2xl border-2 border-emerald-400 animate-ping opacity-30" />
            )}
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-semibold text-slate-200">
              {participant.name}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800/90 text-slate-400 border border-slate-700">
              <VideoOff className="w-2.5 h-2.5 text-slate-500" />
              Camera Off
            </span>
          </div>
        </div>
      )}

      {/* Top Overlay: Name, Role & ID */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10 pointer-events-none">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950/80 backdrop-blur-md border border-slate-800/90 text-xs font-medium text-slate-200 shadow-sm pointer-events-auto">
          <span>{participant.name}</span>
          {isSelf && (
            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
              You
            </span>
          )}
          {isHost && (
            <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
              <Crown className="w-3 h-3 text-amber-400" />
              Host
            </span>
          )}
        </div>

        {/* Audio Mic Status Pill */}
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded-xl text-xs backdrop-blur-md border shadow-sm pointer-events-auto transition-colors ${
            participant.isMuted
              ? 'bg-red-950/80 border-red-800/80 text-red-300'
              : isSpeaking
              ? 'bg-emerald-950/90 border-emerald-600 text-emerald-300'
              : 'bg-slate-950/80 border-slate-800/90 text-slate-300'
          }`}
          title={participant.isMuted ? 'Microphone Muted' : 'Microphone Active'}
        >
          {participant.isMuted ? (
            <MicOff className="w-3.5 h-3.5 text-red-400" />
          ) : (
            <>
              <Mic className="w-3.5 h-3.5 text-emerald-400" />
              {isSpeaking && (
                <div className="flex items-end gap-0.5 h-3">
                  <span className="w-0.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" />
                  <span className="w-0.5 h-3 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                  <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.3s]" />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Host Moderation Hover Quick-Bar (Visible for Host over Remote Participants) */}
      {isCurrentUserHost && !isSelf && (
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-center gap-1.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950/90 backdrop-blur-md border border-slate-800 shadow-xl">
            {/* Mute / Unmute */}
            <button
              onClick={() => onModerateAction(participant.isMuted ? 'unmute' : 'mute', participant.id)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              title={participant.isMuted ? 'Unmute participant mic' : 'Mute participant mic'}
            >
              {participant.isMuted ? (
                <>
                  <Volume2 className="w-3 h-3 text-emerald-400" />
                  <span>Unmute</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3 h-3 text-amber-400" />
                  <span>Mute</span>
                </>
              )}
            </button>

            {/* Transfer Host */}
            {!isHost && (
              <button
                onClick={() => onModerateAction('make_controller', participant.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-950/60 hover:bg-amber-900/60 border border-amber-800/80 text-amber-300 transition"
                title="Delegate Meeting Host role to this attendee"
              >
                <Crown className="w-3 h-3 text-amber-400" />
                <span>Make Host</span>
              </button>
            )}

            {/* Kick / Remove */}
            <button
              onClick={() => onModerateAction('kick', participant.id)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-red-950/60 hover:bg-red-900/60 border border-red-800/80 text-red-300 transition"
              title="Remove attendee from meeting room"
            >
              <UserX className="w-3 h-3 text-red-400" />
              <span>Kick</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
