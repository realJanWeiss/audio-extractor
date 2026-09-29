export type OutputFormat =
  | 'original'
  | 'mp3'
  | 'm4a'
  | 'wav'
  | 'flac'
  | 'ogg'
  | 'opus'
  | 'alac'
  | 'aiff'
  | 'ac3'
  | 'wma'
  | 'custom';
export type Status = 'queued' | 'processing' | 'done' | 'error' | 'cancelled';

export interface OutputSettings {
  format: OutputFormat;
  bitrateKbps?: number;
  sampleRate?: number;
  channels?: number;
  customCodec?: string;
  customMuxer?: string;
  customExtension?: string;
  extraArgs: string[];
}

export interface Job {
  id: number;
  file: File;
  settings: OutputSettings;
  status: Status;
  progress: number;
  duration?: number;
  thumbnail?: string;
  sourceAudio?: string;
  sourceCodec?: string;
  output?: Blob;
  outputExtension?: string;
  error?: string;
}

export const extension: Record<OutputFormat, string> = {
  original: 'mka',
  mp3: 'mp3',
  m4a: 'm4a',
  wav: 'wav',
  flac: 'flac',
  ogg: 'ogg',
  opus: 'opus',
  alac: 'm4a',
  aiff: 'aiff',
  ac3: 'ac3',
  wma: 'wma',
  custom: 'bin',
};
export const formatLabel: Record<OutputFormat, { label: string; mime: string }> = {
  original: { label: 'Original', mime: 'audio/x-matroska' },
  mp3: { label: 'MP3', mime: 'audio/mpeg' },
  m4a: { label: 'M4A / AAC', mime: 'audio/mp4' },
  wav: { label: 'WAV', mime: 'audio/wav' },
  flac: { label: 'FLAC', mime: 'audio/flac' },
  ogg: { label: 'Ogg Vorbis', mime: 'audio/ogg' },
  opus: { label: 'Opus', mime: 'audio/ogg' },
  alac: { label: 'ALAC', mime: 'audio/mp4' },
  aiff: { label: 'AIFF', mime: 'audio/aiff' },
  ac3: { label: 'AC-3', mime: 'audio/ac3' },
  wma: { label: 'WMA', mime: 'audio/x-ms-wma' },
  custom: { label: 'Custom FFmpeg format', mime: 'application/octet-stream' },
};
