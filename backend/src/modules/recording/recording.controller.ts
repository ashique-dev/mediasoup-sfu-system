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
  Req,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { Request, Response } from 'express';
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
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  saveRecording(@UploadedFile() file: Express.Multer.File, @Body() body: any) {
    if (file && file.size === 0) {
      if (fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch {}
      }
      throw new BadRequestException('Uploaded video file is 0 bytes. Please capture video/audio before saving.');
    }
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
    const safeFilename = path.basename(filename);
    const filePath = path.join(RECORDINGS_DIR, safeFilename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }
    return res.download(filePath);
  }

  @Get('stream/:filename')
  streamFile(@Param('filename') filename: string, @Req() req: Request, @Res() res: Response) {
    const safeFilename = path.basename(filename);
    const filePath = path.join(RECORDINGS_DIR, safeFilename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    if (fileSize === 0) {
      res.writeHead(200, {
        'Content-Type': 'video/webm',
        'Content-Length': '0',
        'Accept-Ranges': 'bytes',
        'X-Empty-File': 'true',
      });
      return res.end();
    }

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        return res.end();
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': safeFilename.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': safeFilename.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  }
}
