/**
 * Types and interfaces for the mediasoup-sfu-system
 */

export type ParticipantRole = 'controller' | 'speaker' | 'participant';

export interface Participant {
  id: string;
  name: string;
  role: ParticipantRole;
  isMuted: boolean;
  isVideoMuted: boolean;
  joinedAt: number;
  producerIds: {
    audio?: string;
    video?: string;
  };
}

export interface RoomState {
  id: string;
  name: string;
  createdAt: number;
  controllerId: string;
  isLocked: boolean;
  participants: Record<string, Participant>;
  turnState: 'idle' | 'client_speaking' | 'avatar_speaking';
  activeSpeakerId: string | null;
}

export type SignalingMessageType =
  | 'join_room'
  | 'room_joined'
  | 'participant_joined'
  | 'participant_left'
  | 'get_router_capabilities'
  | 'router_capabilities'
  | 'create_webrtc_transport'
  | 'webrtc_transport_created'
  | 'connect_webrtc_transport'
  | 'webrtc_transport_connected'
  | 'produce'
  | 'produced'
  | 'consume'
  | 'consumed'
  | 'consumer_resume'
  | 'consumer_resumed'
  | 'turn_start'
  | 'turn_over'
  | 'turn_state_changed'
  | 'avatar_speech_chunk'
  | 'avatar_speech_complete'
  | 'controller_action'
  | 'error';

export interface SignalingMessage<T = any> {
  type: SignalingMessageType;
  requestId?: string;
  roomId?: string;
  senderId?: string;
  payload?: T;
}

export interface ControllerActionPayload {
  action: 'mute' | 'unmute' | 'kick' | 'make_controller' | 'lock_room' | 'unlock_room';
  targetParticipantId?: string;
}

export interface SpeechTranscriptItem {
  id: string;
  speaker: 'client' | 'avatar';
  speakerName: string;
  text: string;
  timestamp: number;
  durationSeconds?: number;
}

export interface SavedRecording {
  id: string;
  roomId: string;
  title: string;
  videoFileName: string;
  transcriptFileName: string;
  durationSeconds: number;
  fileSizeBytes: number;
  createdAt: string;
  videoUrl: string;
  transcriptUrl: string;
  transcript: SpeechTranscriptItem[];
}
