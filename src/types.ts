type Status = 'queued' | 'processing' | 'done' | 'error' | 'cancelled';

export interface Job {
  id: number;
  file: File;
  status: Status;
  progress: number;
  duration?: number;
  thumbnail?: string;
  sourceAudio?: string;
  output?: Blob;
  outputExtension?: string;
  error?: string;
}
