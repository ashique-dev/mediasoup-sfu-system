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
    try {
      fs.chmodSync(this.storageDir, 0o777);
    } catch (e) {
      console.warn('Could not set permissions on storageDir:', e);
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

    if (file && file.path && fs.existsSync(file.path)) {
      try {
        fs.chmodSync(file.path, 0o666);
      } catch (err) {
        console.warn('Could not chmod video file:', err);
      }
    }

    const transcriptFileName = `${id}-transcript.json`;
    const transcriptPath = path.join(this.storageDir, transcriptFileName);
    fs.writeFileSync(
      transcriptPath,
      JSON.stringify(transcript, null, 2),
      'utf-8',
    );
    try {
      fs.chmodSync(transcriptPath, 0o666);
    } catch {}

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

    const metaPath = path.join(this.storageDir, `${id}-meta.json`);
    fs.writeFileSync(
      metaPath,
      JSON.stringify(metadata, null, 2),
      'utf-8',
    );
    try {
      fs.chmodSync(metaPath, 0o666);
    } catch {}

    return metadata;
  }

  listRecordings() {
    if (!fs.existsSync(this.storageDir)) return [];
    const files = fs.readdirSync(this.storageDir);
    return files
      .filter((f) => f.endsWith('-meta.json'))
      .map((f) => {
        try {
          const item = JSON.parse(fs.readFileSync(path.join(this.storageDir, f), 'utf-8'));
          if (item && item.videoFileName) {
            const vp = path.join(this.storageDir, item.videoFileName);
            if (fs.existsSync(vp)) {
              const stat = fs.statSync(vp);
              item.fileSizeBytes = stat.size;
            } else {
              item.fileSizeBytes = 0;
            }
          }
          item.isEmpty = !item.fileSizeBytes || item.fileSizeBytes === 0;
          return item;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
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
