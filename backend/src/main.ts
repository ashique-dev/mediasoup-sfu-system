import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });

  const recordingsDir = process.env.RECORDINGS_DIR || path.join(process.cwd(), 'recordings');
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  // Robust HTTP 206 Partial Content video streaming & 0-byte protection
  app.use('/recordings/:filename', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(recordingsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (filename.endsWith('.json')) {
      return res.sendFile(filePath);
    }

    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;

      // Safe response for 0-byte files without throwing RangeNotSatisfiableError (HTTP 416)
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
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`,
          });
          return res.end();
        }

        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': filename.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
        });

        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': filename.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
          'Accept-Ranges': 'bytes',
        });

        fs.createReadStream(filePath).pipe(res);
      }
    } catch (err) {
      next(err);
    }
  });

  app.use('/recordings', express.static(recordingsDir));

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');

  console.log(`[mediasoup-sfu-system] NestJS Backend running on port ${port}`);
  console.log(`[mediasoup-sfu-system] SFU RTC Port Range: 40000 - 40100`);
}

bootstrap();
