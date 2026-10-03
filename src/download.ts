import type { Job } from './types.ts';
import { extension } from './types.ts';

export function download(job: Job): void {
  if (!job.output) return;

  const url = URL.createObjectURL(job.output);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${job.file.name.replace(/\.[^.]+$/, '') || 'audio'}.${job.outputExtension ?? extension[job.settings.format]}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
