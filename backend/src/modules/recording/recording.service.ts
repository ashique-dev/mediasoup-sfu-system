import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RecordingService {
  private readonly storageDir = process.env.RECORDINGS_DIR || path.join(process.cwd(), 'recordings');

  constructor() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  saveRecording(file: Express.Multer.File, body: any) {
    const id = uuidv4();
    const { roomId, transcriptJson, title, duration } = body;

    let transcript = [];
    if (transcriptJson) {
      try {
        transcript = JSON.parse(transcriptJson);
      } catch (e) {
        console.error(e);
      }
    }

    const transcriptFileName = `${id}-transcript.json`;
    fs.writeFileSync(
      path.join(this.storageDir, transcriptFileName),
      JSON.stringify(transcript, null, 2),
      'utf-8',
    );

    const metadata = {
      id,
      roomId: roomId || 'default-room',
      title: title || `Session_${new Date().toISOString()}`,
      videoFileName: file ? file.filename : '',
      transcriptFileName,
      durationSeconds: Number(duration) || 0,
      fileSizeBytes: file ? file.size : 0,
      createdAt: new Date().toISOString(),
      videoUrl: file ? `/recordings/${file.filename}` : '',
      transcriptUrl: `/recordings/${transcriptFileName}`,
      transcript,
    };

    fs.writeFileSync(
      path.join(this.storageDir, `${id}-meta.json`),
      JSON.stringify(metadata, null, 2),
      'utf-8',
    );

    return metadata;
  }

  listRecordings() {
    if (!fs.existsSync(this.storageDir)) return [];
    const files = fs.readdirSync(this.storageDir);
    return files
      .filter((f) => f.endsWith('-meta.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.storageDir, f), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  deleteRecording(id: string) {
    const metaPath = path.join(this.storageDir, `${id}-meta.json`);
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (meta.videoFileName) {
        const vp = path.join(this.storageDir, meta.videoFileName);
        if (fs.existsSync(vp)) fs.unlinkSync(vp);
      }
      if (meta.transcriptFileName) {
        const tp = path.join(this.storageDir, meta.transcriptFileName);
        if (fs.existsSync(tp)) fs.unlinkSync(tp);
      }
      fs.unlinkSync(metaPath);
      return true;
    }
    return false;
  }
}
