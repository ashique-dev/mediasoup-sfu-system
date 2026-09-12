import { Injectable } from '@nestjs/common';

export interface Participant {
  id: string;
  name: string;
  role: 'controller' | 'speaker' | 'participant';
  isMuted: boolean;
  isVideoMuted: boolean;
  joinedAt: number;
}

export interface Room {
  id: string;
  name: string;
  controllerId: string;
  isLocked: boolean;
  participants: Record<string, Participant>;
  turnState: 'idle' | 'client_speaking' | 'avatar_speaking';
  activeSpeakerId: string | null;
}

@Injectable()
export class RoomService {
  private rooms = new Map<string, Room>();

  getOrCreateRoom(roomId: string, name?: string): Room {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        name: name || `Room ${roomId}`,
        controllerId: '',
        isLocked: false,
        participants: {},
        turnState: 'idle',
        activeSpeakerId: null,
      });
    }
    return this.rooms.get(roomId)!;
  }

  join(roomId: string, participantId: string, name: string, requestedRole: string = 'participant'): { room: Room; participant: Participant } {
    const room = this.getOrCreateRoom(roomId);

    let role: 'controller' | 'speaker' | 'participant' = requestedRole as any;
    if (!room.controllerId || requestedRole === 'controller') {
      role = 'controller';
      room.controllerId = participantId;
    }

    const participant: Participant = {
      id: participantId,
      name: name || `User_${participantId.substring(0, 4)}`,
      role,
      isMuted: false,
      isVideoMuted: false,
      joinedAt: Date.now(),
    };

    room.participants[participantId] = participant;
    return { room, participant };
  }

  leave(roomId: string, participantId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    delete room.participants[participantId];

    // Reassign controller if current controller left
    if (room.controllerId === participantId) {
      const remainingIds = Object.keys(room.participants);
      if (remainingIds.length > 0) {
        const firstRemaining = remainingIds[0];
        room.controllerId = firstRemaining;
        if (room.participants[firstRemaining]) {
          room.participants[firstRemaining].role = 'controller';
        }
      } else {
        room.controllerId = '';
      }
    }
  }

  setTurnState(roomId: string, turnState: 'idle' | 'client_speaking' | 'avatar_speaking', speakerId: string | null = null) {
    const room = this.getOrCreateRoom(roomId);
    room.turnState = turnState;
    room.activeSpeakerId = speakerId;
  }

  executeControllerAction(roomId: string, requesterId: string, action: string, targetId?: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (action !== 'reclaim_host' && room.controllerId !== requesterId) {
      return false; // Unauthorized
    }

    switch (action) {
      case 'mute':
        if (targetId && room.participants[targetId]) {
          room.participants[targetId].isMuted = true;
        }
        break;
      case 'unmute':
        if (targetId && room.participants[targetId]) {
          room.participants[targetId].isMuted = false;
        }
        break;
      case 'mute_all':
        Object.values(room.participants).forEach(p => {
          if (p.id !== requesterId) p.isMuted = true;
        });
        break;
      case 'unmute_all':
        Object.values(room.participants).forEach(p => {
          p.isMuted = false;
        });
        break;
      case 'reclaim_host':
        room.controllerId = requesterId;
        Object.values(room.participants).forEach(p => {
          p.role = (p.id === requesterId) ? 'controller' : 'participant';
        });
        break;
      case 'lock_room':
        room.isLocked = true;
        break;
      case 'unlock_room':
        room.isLocked = false;
        break;
      case 'make_controller':
        if (targetId && room.participants[targetId]) {
          room.participants[requesterId].role = 'participant';
          room.participants[targetId].role = 'controller';
          room.controllerId = targetId;
        }
        break;
      case 'kick':
        if (targetId && room.participants[targetId]) {
          delete room.participants[targetId];
        }
        break;
    }
    return true;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }
}
