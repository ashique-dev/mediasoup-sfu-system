import React, { useState, useEffect } from 'react';
import {
  FolderArchive,
  FileVideo,
  FileText,
  Download,
  Trash2,
  Play,
  Clock,
  HardDrive,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Info,
  X
} from 'lucide-react';
import { SavedRecording } from '../types';

export const RecordingsList: React.FC = () => {
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRecording, setSelectedRecording] = useState<SavedRecording | null>(null);
  const [videoPlaybackError, setVideoPlaybackError] = useState(false);

  const fetchRecordings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/recordings');
      if (res.ok) {
        const data = await res.json();
        setRecordings(data);
      }
    } catch (err) {
      console.error('Error loading recordings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recording from the project local directory?')) return;
    try {
      const res = await fetch(`/api/recordings/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setRecordings((prev) => prev.filter((r) => r.id !== id));
        if (selectedRecording?.id === id) setSelectedRecording(null);
      }
    } catch (err) {
      console.error('Error deleting recording:', err);
    }
  };

  return (
    <div id="recordings-container" className="flex flex-col gap-6">
      {/* Directory Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <FolderArchive className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">Local Directory Recordings Vault</h2>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
              <span className="font-mono bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                ./recordings/
              </span>
              <span>•</span>
              <span>{recordings.length} session recording(s) stored on local disk</span>
            </div>
          </div>
        </div>

        <button
          onClick={fetchRecordings}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Files</span>
        </button>
      </div>

      {/* Recordings Grid or Empty State */}
      {recordings.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-slate-800/80 bg-slate-900/40 flex flex-col items-center gap-3">
          <HardDrive className="w-10 h-10 text-slate-600" />
          <h3 className="text-sm font-semibold text-slate-300">No Local Recordings Found</h3>
          <p className="text-xs text-slate-500 max-w-md">
            Recordings and generated speech transcripts are saved to the project's local directory (<code>./recordings/</code>) when you press "Save to Local Directory" in the Half-Duplex Studio.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {recordings.map((rec) => (
            <div
              key={rec.id}
              className="flex flex-col justify-between p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl hover:border-slate-700 transition group"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/70 text-indigo-300 border border-indigo-800">
                    Room: {rec.roomId}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {new Date(rec.createdAt).toLocaleDateString()} {new Date(rec.createdAt).toLocaleTimeString()}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-slate-100 group-hover:text-indigo-400 transition">
                  {rec.title}
                </h3>

                <div className="flex items-center gap-3 text-xs text-slate-400 mt-2 font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    {rec.durationSeconds}s
                  </span>
                  <span>•</span>
                  <span>
                    {rec.fileSizeBytes && rec.fileSizeBytes > 0 ? (
                      <span className="text-emerald-400 font-semibold">
                        {(rec.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    ) : (
                      <span className="text-amber-400 font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        0 B (Empty)
                      </span>
                    )}
                  </span>
                </div>

                {/* Stored files badge */}
                <div className="flex flex-col gap-1.5 mt-4 pt-3 border-t border-slate-800 text-xs">
                  {rec.videoFileName && (
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <FileVideo className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                      <span className="truncate font-mono text-[11px]">{rec.videoFileName}</span>
                    </div>
                  )}
                  {rec.transcriptFileName && (
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <FileText className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                      <span className="truncate font-mono text-[11px]">{rec.transcriptFileName}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between gap-2 mt-5 pt-3 border-t border-slate-800">
                <button
                  onClick={() => {
                    setVideoPlaybackError(false);
                    setSelectedRecording(rec);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
                    rec.isEmpty || !rec.fileSizeBytes
                      ? 'bg-amber-950/40 border border-amber-500/40 text-amber-300 hover:bg-amber-900/40'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{rec.isEmpty || !rec.fileSizeBytes ? 'Inspect (0 B)' : 'Inspect & Play'}</span>
                </button>

                {rec.videoFileName && rec.fileSizeBytes > 0 && (
                  <a
                    href={`/api/recordings/download/${rec.videoFileName}`}
                    download
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                    title="Download video file"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                )}

                <button
                  onClick={() => handleDelete(rec.id)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-400 transition"
                  title="Delete recording from local disk"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Video & Transcript Inspect Modal */}
      {selectedRecording && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-100">{selectedRecording.title}</h3>
                <span className="text-xs text-slate-400 font-mono">
                  Stored at: ./recordings/{selectedRecording.videoFileName || selectedRecording.transcriptFileName}
                </span>
              </div>
              <button
                onClick={() => setSelectedRecording(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video Player or Empty File Diagnostic */}
            {selectedRecording.videoUrl && (
              selectedRecording.isEmpty || !selectedRecording.fileSizeBytes || selectedRecording.fileSizeBytes === 0 ? (
                <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-950/30 flex flex-col gap-3 text-amber-200">
                  <div className="flex items-center gap-2 font-semibold text-sm text-amber-300">
                    <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                    <span>Empty Recording File (0 bytes)</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    This video file was saved before any speech media or camera frames were captured by the browser recorder. Chromium and VLC cannot play 0-byte video streams and report <code className="text-amber-400 font-mono">HTTP 416 Range Not Satisfiable</code>.
                  </p>
                  <div className="p-3 rounded-lg bg-slate-950/80 border border-amber-500/20 text-xs text-slate-300 flex flex-col gap-1.5">
                    <span className="font-semibold text-slate-200">How to capture a playable recording:</span>
                    <ol className="list-decimal list-inside space-y-1 text-slate-400">
                      <li>Open the <strong className="text-slate-200">Half-Duplex Studio</strong> tab.</li>
                      <li>Click <strong className="text-sky-300">Start Speech Turn</strong> (camera and mic activate).</li>
                      <li>Speak or let the camera feed run — verify the green <strong className="text-emerald-300">MB buffer indicator</strong> increases.</li>
                      <li>Click <strong className="text-purple-300">Speech is Over, Now It's Your Turn</strong>.</li>
                      <li>Click <strong className="text-indigo-300">Save to Local Directory</strong>.</li>
                    </ol>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={() => handleDelete(selectedRecording.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950 border border-red-800/60 text-red-300 hover:bg-red-900 text-xs font-semibold transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete This Empty File</span>
                    </button>
                    <span className="text-[11px] text-slate-400 font-mono">File: {selectedRecording.videoFileName}</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="aspect-video w-full rounded-xl overflow-hidden bg-black border border-slate-800 flex items-center justify-center relative">
                    <video
                      key={selectedRecording.videoUrl}
                      src={selectedRecording.videoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-contain"
                      onError={() => setVideoPlaybackError(true)}
                    />
                  </div>
                  {videoPlaybackError && (
                    <div className="flex items-center justify-between p-3 rounded-lg border border-red-500/40 bg-red-950/30 text-xs text-red-300">
                      <span>Stream playback issue in iframe.</span>
                      <a
                        href={selectedRecording.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline font-semibold flex items-center gap-1 text-red-200"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open Stream in New Tab</span>
                      </a>
                    </div>
                  )}
                </div>
              )
            )}

            {/* Transcript Viewer */}
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Speech Transcript History
              </h4>
              <div className="flex flex-col gap-2 max-h-52 overflow-y-auto p-3 rounded-xl bg-slate-950 border border-slate-800">
                {selectedRecording.transcript && selectedRecording.transcript.length > 0 ? (
                  selectedRecording.transcript.map((item, idx) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-lg text-xs flex flex-col gap-1 border ${
                        item.speaker === 'client'
                          ? 'border-sky-500/20 bg-sky-950/20 text-slate-200'
                          : 'border-purple-500/20 bg-purple-950/20 text-slate-200'
                      }`}
                    >
                      <div className="flex justify-between font-semibold text-[11px]">
                        <span className={item.speaker === 'client' ? 'text-sky-400' : 'text-purple-400'}>
                          {item.speakerName}
                        </span>
                        <span className="text-slate-500">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p>{item.text}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 italic">No structured transcript saved for this item.</p>
                )}
              </div>
            </div>

            {/* Download & Close actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              {selectedRecording.videoFileName && (
                <a
                  href={`/api/recordings/download/${selectedRecording.videoFileName}`}
                  download
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Video ({selectedRecording.videoFileName})</span>
                </a>
              )}
              {selectedRecording.transcriptFileName && (
                <a
                  href={`/api/recordings/download/${selectedRecording.transcriptFileName}`}
                  download
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Transcript</span>
                </a>
              )}
              <button
                onClick={() => setSelectedRecording(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
