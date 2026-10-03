import type { MediaJob } from './media-job.ts';
import type { Job } from './types.ts';

function required<T extends Element>(selector: string, elementType: new () => T): T {
  const element = document.querySelector(selector);
  if (!(element instanceof elementType))
    throw new Error(`Missing or invalid required element: ${selector}`);
  return element;
}

export const ui = {
  main: required('main', HTMLElement),
  files: required('#files', HTMLInputElement),
  dropZone: required('#drop-zone', HTMLElement),
  controls: required('#controls', HTMLElement),
  format: required('#format', HTMLSelectElement),
  advanced: required('#advanced', HTMLDetailsElement),
  bitrate: required('#bitrate', HTMLSelectElement),
  sampleRate: required('#sample-rate', HTMLSelectElement),
  channels: required('#channels', HTMLSelectElement),
  customFields: required('#custom-fields', HTMLElement),
  customCodec: required('#custom-codec', HTMLInputElement),
  customMuxer: required('#custom-muxer', HTMLInputElement),
  customExtension: required('#custom-extension', HTMLInputElement),
  extraArgs: required('#extra-args', HTMLTextAreaElement),
  showCapabilities: required('#show-capabilities', HTMLButtonElement),
  capabilities: required('#capabilities', HTMLElement),
  runButton: required('#run', HTMLButtonElement),
  runLabel: required('#run-label', HTMLElement),
  downloadAll: required('#download-all', HTMLButtonElement),
  activity: required('#activity', HTMLElement),
  engineProgress: required('#engine-progress', HTMLProgressElement),
  currentStatus: required('#current-status', HTMLElement),
  batchStatus: required('#batch-status', HTMLElement),
  batchProgress: required('#batch-progress', HTMLProgressElement),
  notice: required('#notice', HTMLElement),
  jobs: required('#jobs', HTMLElement),
};

export function announce(message: string, error = false): void {
  ui.notice.textContent = message;
  ui.notice.hidden = message.length === 0;
  ui.notice.classList.toggle('error', error);
}

function renderJob(job: Job): void {
  let tile = ui.jobs.querySelector<MediaJob>(`media-job[data-id="${job.id}"]`);
  if (!tile) {
    tile = document.createElement('media-job');
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
