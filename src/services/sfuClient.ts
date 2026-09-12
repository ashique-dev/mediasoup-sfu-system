import * as mediasoupClient from 'mediasoup-client';
import { Participant, ParticipantRole, RoomState, SpeechTranscriptItem } from '../types';

export interface SfuClientCallbacks {
  onRoomJoined?: (data: { participantId: string; role: ParticipantRole; room: RoomState }) => void;
  onRoomStateUpdated?: (room: RoomState) => void;
  onParticipantJoined?: (participant: Participant) => void;
  onParticipantLeft?: (participantId: string) => void;
  onTurnStateChanged?: (turnState: 'idle' | 'client_speaking' | 'avatar_speaking', message: string) => void;
  onAvatarSpeechChunk?: (chunk: string, fullText: string, progress: number) => void;
  onAvatarSpeechComplete?: (fullText: string) => void;
  onError?: (message: string) => void;
  onConnectionStatusChange?: (status: 'disconnected' | 'connecting' | 'connected') => void;
}

export class SfuClient {
  private ws: WebSocket | null = null;
  private device: mediasoupClient.Device | null = null;
  private sendTransport: any = null;
  private videoProducer: any = null;
  private audioProducer: any = null;
  private pendingRequests = new Map<string, (payload: any) => void>();
  private callbacks: SfuClientCallbacks = {};

  public participantId: string = '';
  public currentRoomId: string = '';
  public currentRole: ParticipantRole = 'participant';
  public localStream: MediaStream | null = null;
  public mediaRecorder: MediaRecorder | null = null;
  public recordedChunks: Blob[] = [];
  public audioContext: AudioContext | null = null;
  public onRecordingChunk?: (totalBytes: number, totalChunks: number) => void;

  constructor(callbacks: SfuClientCallbacks) {
    this.callbacks = callbacks;
  }

  public connectSignaling(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.callbacks.onConnectionStatusChange?.('connecting');

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.callbacks.onConnectionStatusChange?.('connected');
        resolve();
      };

      this.ws.onerror = (err) => {
        this.callbacks.onConnectionStatusChange?.('disconnected');
        this.callbacks.onError?.('WebSocket connection error.');
        reject(err);
      };

      this.ws.onclose = () => {
        this.callbacks.onConnectionStatusChange?.('disconnected');
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleSignalingMessage(message);
        } catch (err) {
          console.error('Error parsing signaling message:', err);
        }
      };
    });
  }

  private handleSignalingMessage(message: any) {
    const { type, requestId, payload } = message;

    // Resolve any awaiting promises
    if (requestId && this.pendingRequests.has(requestId)) {
      const resolver = this.pendingRequests.get(requestId)!;
      this.pendingRequests.delete(requestId);
      resolver(payload);
    }

    switch (type) {
      case 'room_joined':
        this.participantId = payload.participantId;
        this.currentRole = payload.role;
        this.currentRoomId = payload.room.id;
        this.callbacks.onRoomJoined?.(payload);
        break;

      case 'room_state_updated':
        this.callbacks.onRoomStateUpdated?.(payload.room);
        break;

      case 'participant_joined':
        this.callbacks.onParticipantJoined?.(payload.participant);
        break;

      case 'participant_left':
        this.callbacks.onParticipantLeft?.(payload.participantId);
        break;

      case 'turn_state_changed':
        this.callbacks.onTurnStateChanged?.(payload.turnState, payload.message);
        break;

      case 'avatar_speech_chunk':
        this.callbacks.onAvatarSpeechChunk?.(payload.chunk, payload.fullText, payload.progress);
        break;

      case 'avatar_speech_complete':
        this.callbacks.onAvatarSpeechComplete?.(payload.completedText);
        break;

      case 'error':
        this.callbacks.onError?.(payload.message || 'An error occurred.');
        break;
    }
  }

  public sendRequest<T = any>(type: string, payload: any = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('Signaling WebSocket is not connected'));
      }
      const requestId = Math.random().toString(36).substring(2, 9);
      this.pendingRequests.set(requestId, resolve);

      const message = {
        type,
        requestId,
        roomId: this.currentRoomId,
        senderId: this.participantId,
        payload,
      };

      this.ws.send(JSON.stringify(message));

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request ${type} timed out`));
        }
      }, 10000);
    });
  }

  // Mediasoup Device initialization
  public async initMediasoupDevice(): Promise<void> {
    if (!this.device) {
      this.device = new mediasoupClient.Device();
    }

    if (!this.device.loaded) {
      const response = await this.sendRequest('get_router_capabilities');
      if (response && response.rtpCapabilities) {
        await this.device.load({ routerRtpCapabilities: response.rtpCapabilities });
      }
    }
  }

  public async joinRoom(roomId: string, name: string, role: ParticipantRole = 'controller'): Promise<void> {
    this.currentRoomId = roomId;
    await this.initMediasoupDevice();
    await this.sendRequest('join_room', { name, role });
  }

  // Setup client media streaming (Camera or synthetic video fallback)
  public async getLocalMediaStream(useSyntheticFallback = false): Promise<MediaStream> {
    if (useSyntheticFallback) {
      this.localStream = this.createSyntheticVideoStream('Client');
      return this.localStream;
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: true,
      });
      return this.localStream;
    } catch (err1) {
      console.warn('getUserMedia audio+video failed, trying video only:', err1);
      try {
        const vidStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
          audio: false,
        });
        // Add synthetic silent audio track so container has an audio track
        const audioTrack = this.createSyntheticAudioTrack();
        if (audioTrack) {
          vidStream.addTrack(audioTrack);
        }
        this.localStream = vidStream;
        return this.localStream;
      } catch (err2) {
        console.warn('Physical camera unavailable or access denied. Initializing synthetic test media track...', err2);
        this.localStream = this.createSyntheticVideoStream('Client (Simulated)');
        return this.localStream;
      }
    }
  }

  // Creates a silent audio track via Web Audio API to ensure recordings have an audio channel
  private createSyntheticAudioTrack(): MediaStreamTrack | null {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!this.audioContext) {
        this.audioContext = new AudioContextClass();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
      const osc = this.audioContext.createOscillator();
      const dst = this.audioContext.createMediaStreamDestination();
      osc.frequency.setValueAtTime(440, this.audioContext.currentTime);
      const gain = this.audioContext.createGain();
      gain.gain.value = 0.0001; // silent baseline
      osc.connect(gain);
      gain.connect(dst);
      osc.start();
      return dst.stream.getAudioTracks()[0] || null;
    } catch {
      return null;
    }
  }

  // Generates real canvas media stream for reliable testing without physical webcam
  private createSyntheticVideoStream(label: string): MediaStream {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;

    let frame = 0;
    const draw = () => {
      frame++;
      // Background gradient
      const grad = ctx.createLinearGradient(0, 0, 640, 480);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(1, '#1e293b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 480);

      // Grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < 640; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 480);
        ctx.stroke();
      }
      for (let y = 0; y < 480; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(640, y);
        ctx.stroke();
      }

      // Animated glowing orb
      const cx = 320 + Math.sin(frame * 0.05) * 80;
      const cy = 200 + Math.cos(frame * 0.05) * 40;
      const radGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 120);
      radGrad.addColorStop(0, '#38bdf8');
      radGrad.addColorStop(0.5, '#6366f1');
      radGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = radGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 120, 0, Math.PI * 2);
      ctx.fill();

      // Video label
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`● ${label} SFU Feed`, 320, 350);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(`Active Frame: #${frame} | ${new Date().toISOString().substring(11, 19)}`, 320, 385);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(`VP8 30fps | WebRTC MediaStream Active`, 320, 415);
    };

    draw();

    // In Chrome/Chromium, requestAnimationFrame stops when canvas is not attached to DOM or tab is unfocused.
    // Using setInterval guarantees continuous 30fps rendering for canvas.captureStream!
    const intervalTimer = setInterval(draw, 1000 / 30);

    const canvasStream = canvas.captureStream(30);

    // Stop timer when canvas stream tracks end
    canvasStream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => clearInterval(intervalTimer));
    });

    // Add audio track
    const audioTrack = this.createSyntheticAudioTrack();
    if (audioTrack) {
      canvasStream.addTrack(audioTrack);
    }

    return canvasStream;
  }

  // Create Mediasoup WebRTC Send Transport and Produce Video & Audio tracks
  public async produceMedia(): Promise<void> {
    if (!this.localStream) {
      await this.getLocalMediaStream();
    }

    // Request transport parameters from server
    const transportOptions = await this.sendRequest('create_webrtc_transport', { direction: 'send' });

    // In a browser with mediasoup-client, createSendTransport
    if (this.device && this.device.loaded) {
      try {
        this.sendTransport = this.device.createSendTransport(transportOptions);

        this.sendTransport.on('connect', async ({ dtlsParameters }: any, callback: () => void, errback: (e: any) => void) => {
          try {
            await this.sendRequest('connect_webrtc_transport', {
              transportId: this.sendTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (error) {
            errback(error);
          }
        });

        this.sendTransport.on('produce', async ({ kind, rtpParameters, appData }: any, callback: (data: { id: string }) => void, errback: (e: any) => void) => {
          try {
            const data = await this.sendRequest('produce', {
              transportId: this.sendTransport.id,
              kind,
              rtpParameters,
              appData,
            });
            callback({ id: data.id });
          } catch (error) {
            errback(error);
          }
        });

        // Produce video
        const videoTrack = this.localStream!.getVideoTracks()[0];
        if (videoTrack) {
          this.videoProducer = await this.sendTransport.produce({ track: videoTrack });
        }

        // Produce audio
        const audioTrack = this.localStream!.getAudioTracks()[0];
        if (audioTrack) {
          this.audioProducer = await this.sendTransport.produce({ track: audioTrack });
        }
      } catch (err) {
        console.warn('Direct mediasoup sendTransport produce error, relying on server signaling confirmation:', err);
        // Fallback signaling produce message
        await this.sendRequest('produce', {
          transportId: transportOptions.id,
          kind: 'video',
          rtpParameters: {},
        });
      }
    }
  }

  // Optimal codec selection for WebM/MP4 recording based on available tracks
  public getOptimalMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    const hasAudio = !!(this.localStream && this.localStream.getAudioTracks().length > 0);
    const formatsWithAudio = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4'
    ];
    const formatsVideoOnly = [
      'video/webm;codecs=vp8',
      'video/webm;codecs=vp9',
      'video/webm',
      'video/mp4'
    ];

    const candidateFormats = hasAudio ? formatsWithAudio : formatsVideoOnly;
    for (const fmt of candidateFormats) {
      try {
        if (MediaRecorder.isTypeSupported(fmt)) return fmt;
      } catch {}
    }
    return '';
  }

  public getTotalRecordedBytes(): number {
    return this.recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0);
  }

  // Half-Duplex Feature 8.b1: Start speech turn
  public async startTurn(): Promise<void> {
    // 1. Ensure local media stream is available first
    if (!this.localStream) {
      await this.getLocalMediaStream();
    }

    // 2. Resume AudioContext if suspended
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        console.warn('Could not resume audioContext:', e);
      }
    }

    // 3. Start local recording buffer immediately so no speech is lost (Feature 8.b2)
    if (this.localStream && typeof MediaRecorder !== 'undefined') {
      try {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          try {
            this.mediaRecorder.stop();
          } catch {}
        }

        this.recordedChunks = [];
        const mimeType = this.getOptimalMimeType();
        const options: MediaRecorderOptions = mimeType ? { mimeType } : {};

        this.mediaRecorder = new MediaRecorder(this.localStream, options);
        this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
          if (event.data && event.data.size > 0) {
            this.recordedChunks.push(event.data);
            const totalBytes = this.getTotalRecordedBytes();
            if (this.onRecordingChunk) {
              this.onRecordingChunk(totalBytes, this.recordedChunks.length);
            }
          }
        };
        this.mediaRecorder.onerror = (event: any) => {
          console.error('[SFU MediaRecorder] Error occurred:', event);
        };
        // Emit chunks every 250ms for real-time responsiveness
        this.mediaRecorder.start(250);
        console.log('[SFU Client] MediaRecorder recording active (mimeType: ' + (options.mimeType || 'default') + ')');
      } catch (e) {
        console.warn('Could not initialize MediaRecorder:', e);
      }
    }

    // 4. Send signaling turn_start non-blockingly so recorder is not delayed
    this.sendRequest('turn_start').catch((err) => {
      console.warn('Signaling turn_start notice:', err.message);
    });
  }

  // Half-Duplex Feature 8.b1: Declare speech is over, hand over to avatar
  public async endTurn(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      await new Promise<void>((resolve) => {
        const recorder = this.mediaRecorder!;
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };

        recorder.onstop = done;
        try {
          recorder.stop();
        } catch (e) {
          done();
        }
        // Safety timeout in case onstop doesn't fire
        setTimeout(done, 500);
      });
    }
    // Notify server signaling turn_over
    this.sendRequest('turn_over').catch((err) => {
      console.warn('Signaling turn_over notice:', err.message);
    });
  }

  // Meeting Controller Authorization Actions (Feature 8.a)
  public async executeControllerAction(action: 'mute' | 'unmute' | 'kick' | 'make_controller' | 'lock_room' | 'unlock_room', targetParticipantId?: string) {
    return await this.sendRequest('controller_action', { action, targetParticipantId });
  }

  // Save Video and Transcript to Local Project Directory (Feature 8.b2)
  public async saveRecordingLocally(transcript: SpeechTranscriptItem[], title?: string): Promise<any> {
    // If recorder is still running, finalize it first
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      await this.endTurn();
    }

    if (this.recordedChunks.length === 0) {
      throw new Error('No recorded media chunks captured. Please start a speech turn and record audio/video first.');
    }

    const recordedMimeType = this.mediaRecorder?.mimeType || 'video/webm';
    const videoBlob = new Blob(this.recordedChunks, { type: recordedMimeType });

    if (videoBlob.size === 0) {
      throw new Error('Captured video file is 0 bytes. Ensure camera or audio tracks are actively sending frames.');
    }

    const formData = new FormData();
    formData.append('video', videoBlob, `sfu-speech-${Date.now()}.webm`);
    formData.append('roomId', this.currentRoomId || 'default-room');
    formData.append('title', title || `Session Speech ${new Date().toLocaleTimeString()}`);
    formData.append('transcriptJson', JSON.stringify(transcript));
    formData.append('duration', String(Math.max(1, Math.round(this.recordedChunks.length * 0.5))));

    const response = await fetch('/api/recordings/save', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      let errDetail = response.statusText;
      try {
        const errText = await response.text();
        if (response.status === 413) {
          errDetail = 'Payload Too Large: File exceeds upload limit. Ensure proxy configuration allows up to 500MB.';
        } else if (errText.trim().startsWith('{')) {
          const json = JSON.parse(errText);
          errDetail = json.message || json.error || errDetail;
        } else if (!errText.trim().startsWith('<')) {
          errDetail = errText;
        }
      } catch {}
      throw new Error(`Failed to save recording: ${errDetail}`);
    }

    return await response.json();
  }

  public disconnect() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.callbacks.onConnectionStatusChange?.('disconnected');
  }
}
