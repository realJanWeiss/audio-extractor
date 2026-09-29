import type { MediaJob } from './media-job.ts';
import type { Job } from './types.ts';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export const ui = {
  main: required<HTMLElement>('main'),
  files: required<HTMLInputElement>('#files'),
  dropZone: required<HTMLElement>('#drop-zone'),
  controls: required<HTMLElement>('#controls'),
  format: required<HTMLSelectElement>('#format'),
  advanced: required<HTMLDetailsElement>('#advanced'),
  bitrate: required<HTMLSelectElement>('#bitrate'),
  sampleRate: required<HTMLSelectElement>('#sample-rate'),
  channels: required<HTMLSelectElement>('#channels'),
  customFields: required<HTMLElement>('#custom-fields'),
  customCodec: required<HTMLInputElement>('#custom-codec'),
  customMuxer: required<HTMLInputElement>('#custom-muxer'),
  customExtension: required<HTMLInputElement>('#custom-extension'),
  extraArgs: required<HTMLTextAreaElement>('#extra-args'),
  showCapabilities: required<HTMLButtonElement>('#show-capabilities'),
  capabilities: required<HTMLElement>('#capabilities'),
  runButton: required<HTMLButtonElement>('#run'),
  runLabel: required<HTMLElement>('#run-label'),
  downloadAll: required<HTMLButtonElement>('#download-all'),
  activity: required<HTMLElement>('#activity'),
  engineProgress: required<HTMLProgressElement>('#engine-progress'),
  currentStatus: required<HTMLElement>('#current-status'),
  batchStatus: required<HTMLElement>('#batch-status'),
  batchProgress: required<HTMLProgressElement>('#batch-progress'),
  notice: required<HTMLElement>('#notice'),
  jobs: required<HTMLElement>('#jobs'),
};

export function announce(message: string, error = false): void {
  ui.notice.textContent = message;
  ui.notice.hidden = message.length === 0;
  ui.notice.classList.toggle('error', error);
}

function renderJob(job: Job): void {
  let tile = ui.jobs.querySelector<MediaJob>(`media-job[data-id="${job.id}"]`);
  if (!tile) {
    tile = document.createElement('media-job') as MediaJob;
    tile.dataset.id = String(job.id);
    ui.jobs.append(tile);
  }
  tile.update(job);
}

export function removeJobTile(id: number): void {
  ui.jobs.querySelector(`media-job[data-id="${id}"]`)?.remove();
}

export function refreshView(
  jobs: Job[],
  state: { running: boolean; engineLoading: boolean; engineAvailable: boolean },
  changedJob?: Job,
): void {
  if (changedJob) renderJob(changedJob);

  const total = jobs.length;
  const done = jobs.filter((job) => job.status === 'done').length;
  const settled = jobs.filter((job) => job.status === 'done' || job.status === 'error').length;
  const pending = jobs.filter((job) => job.status === 'queued').length;
  const active = jobs.find((job) => job.status === 'processing');

  ui.controls.hidden = total === 0;
  ui.jobs.hidden = total === 0;
  ui.main.classList.toggle('has-files', total > 0);

  ui.activity.hidden = !state.running && settled === 0;
  ui.engineProgress.hidden = !state.engineLoading;
  if (state.engineLoading) ui.engineProgress.removeAttribute('value');
  ui.batchProgress.hidden = state.engineLoading || (!state.running && settled === 0);
  ui.batchProgress.max = Math.max(total, 1);
  ui.batchProgress.value = settled + (active?.progress ?? 0);

  ui.batchStatus.hidden = state.engineLoading;
  ui.batchStatus.textContent = total ? `${done} of ${total} complete` : '';
  ui.currentStatus.textContent = active
    ? `${active.file.name} · ${Math.round(active.progress * 100)}%`
    : state.engineLoading
      ? 'Loading engine…'
      : '';

  ui.runButton.disabled = pending === 0 || state.running || !state.engineAvailable;
  ui.runLabel.textContent = state.engineLoading
    ? 'Loading engine…'
    : state.running
      ? 'Extracting…'
      : 'Extract audio';
  ui.downloadAll.hidden = done < 2;
}
