export type Status = 'queued' | 'processing' | 'done' | 'error' | 'cancelled';

export interface Job {
  id: number;
  file: File;
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
