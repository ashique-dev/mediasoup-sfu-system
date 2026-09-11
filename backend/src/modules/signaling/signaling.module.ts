import { Module } from '@nestjs/common';
import { SignalingGateway } from './signaling.gateway';
import { SfuModule } from '../sfu/sfu.module';
import { RoomModule } from '../room/room.module';

@Module({
  imports: [SfuModule, RoomModule],
  providers: [SignalingGateway],
})
export class SignalingModule {}
