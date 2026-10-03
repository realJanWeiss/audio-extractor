import type { Job } from './types.ts';

export function download(job: Job): void {
  if (!job.output || !job.outputExtension) return;

  const url = URL.createObjectURL(job.output);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${job.file.name.replace(/\.[^.]+$/, '') || 'audio'}.${job.outputExtension}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
