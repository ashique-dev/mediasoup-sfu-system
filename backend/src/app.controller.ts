import { Controller, Get } from '@nestjs/common';
import { RoomService } from './modules/room/room.service';
import { SfuService } from './modules/sfu/sfu.service';
import { mediasoupConfig } from './config/mediasoup.config';

@Controller('api')
export class AppController {
  constructor(
    private readonly roomService: RoomService,
    private readonly sfuService: SfuService,
  ) {}

  @Get('health')
  getHealth() {
    const rooms = this.roomService.getAllRooms();
    return {
      status: 'ok',
      project: 'mediasoup-sfu-system',
      uptime: process.uptime(),
      activeRooms: rooms.length,
    };
  }

  @Get('rooms')
  getRooms() {
    const rooms = this.roomService.getAllRooms();
    return rooms.map((r) => ({
      id: r.id,
      name: r.name,
      participantCount: Object.keys(r.participants || {}).length,
      controllerId: r.controllerId,
      isLocked: r.isLocked,
      turnState: r.turnState,
      participants: r.participants,
    }));
  }

  @Get('sfu/info')
  async getSfuInfo() {
    const routerCaps = await this.sfuService.getRouterRtpCapabilities('default');
    return {
      sfu: 'mediasoup-v3',
      rtpCapabilities: routerCaps,
      supportedCodecs: mediasoupConfig.router.mediaCodecs.map((c) => c.mimeType),
    };
  }
}
