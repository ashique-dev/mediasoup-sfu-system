import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  Body,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import { Response } from 'express';
import { RecordingService } from './recording.service';

const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(process.cwd(), 'recordings');

@Controller('api/recordings')
export class RecordingController {
  constructor(private readonly recordingService: RecordingService) {}

  @Post('save')
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: RECORDINGS_DIR,
        filename: (_req, file, cb) => {
          cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`);
        },
      }),
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  saveRecording(@UploadedFile() file: Express.Multer.File, @Body() body: any) {
    const recording = this.recordingService.saveRecording(file, body);
    return { success: true, recording };
  }

  @Get()
  listRecordings() {
    return this.recordingService.listRecordings();
  }

  @Delete(':id')
  deleteRecording(@Param('id') id: string) {
    const success = this.recordingService.deleteRecording(id);
    return { success };
  }

  @Get('download/:filename')
  downloadFile(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = path.join(RECORDINGS_DIR, filename);
    return res.download(filePath);
  }
}
