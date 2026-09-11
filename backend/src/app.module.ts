import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { SfuModule } from './modules/sfu/sfu.module';
import { SignalingModule } from './modules/signaling/signaling.module';
import { RoomModule } from './modules/room/room.module';
import { RecordingModule } from './modules/recording/recording.module';

@Module({
  imports: [SfuModule, SignalingModule, RoomModule, RecordingModule],
  controllers: [AppController],
})
export class AppModule {}
