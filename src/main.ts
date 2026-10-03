import './style.css';
import './media-job.ts';

import { ExtractionQueue } from './extraction-queue.ts';
import { readSettings, updateSettingsControls } from './output-settings.ts';
import { inspectVideo } from './video-preview.ts';
import { download } from './download.ts';
import { ui, announce, refreshView, removeJobTile } from './ui.ts';
import type { Job } from './types.ts';

const engineAvailable = crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
const queue = new ExtractionQueue({
  engineAvailable,
  loadProcessor: () => import('./processor.ts'),
  onChange: refresh,
  onAdd: (job) =>
    inspectVideo(
      job,
      () => refresh(job),
      () => queue.jobs.includes(job),
    ),
  onRemove: removeJobTile,
  onError: (message, kind) => {
    announce(message, true);
    if (kind === 'settings') ui.advanced.open = true;
  },
});

function refresh(job?: Job): void {
  refreshView(queue.jobs, queue.state, job);
}

function addFiles(files: FileList | File[]): void {
  const { invalid, duplicate } = queue.addFiles(Array.from(files), readSettings(ui));
  const messages = [];
  if (duplicate)
    messages.push(`${duplicate} duplicate ${duplicate === 1 ? 'file was' : 'files were'} skipped.`);
  if (invalid)
    messages.push(
      `${invalid} ${invalid === 1 ? 'file was' : 'files were'} skipped because ${invalid === 1 ? 'it does' : 'they do'} not look like videos.`,
    );
  announce(messages.join(' '), invalid > 0);
  ui.files.value = '';
}

ui.files.addEventListener('change', () => {
  if (ui.files.files) addFiles(ui.files.files);
});

function settingsChanged(): void {
  queue.updateSettings(readSettings(ui));
}

ui.format.addEventListener('change', () => {
  updateSettingsControls(ui);
  settingsChanged();
});
for (const control of [ui.bitrate, ui.sampleRate, ui.channels]) {
  control.addEventListener('change', settingsChanged);
}
for (const control of [ui.customCodec, ui.customMuxer, ui.customExtension, ui.extraArgs]) {
  control.addEventListener('input', settingsChanged);
}

ui.showCapabilities.addEventListener('click', () => {
  if (!engineAvailable) return;
  ui.showCapabilities.disabled = true;
  ui.showCapabilities.textContent = 'Loading FFmpeg capabilities…';
  void (async () => {
    try {
      ui.capabilities.textContent = await queue.listCapabilities();
    } catch (error) {
      ui.capabilities.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      ui.capabilities.hidden = false;
      ui.showCapabilities.disabled = false;
      ui.showCapabilities.textContent = 'Refresh available encoders and muxers';
    }
  })();
});

ui.dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  ui.dropZone.classList.add('drag-over');
});
ui.dropZone.addEventListener('dragleave', () => ui.dropZone.classList.remove('drag-over'));
ui.dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  ui.dropZone.classList.remove('drag-over');
  if (event.dataTransfer?.files) addFiles(event.dataTransfer.files);
});

ui.runButton.addEventListener('click', () => {
  announce('');
  void queue.start();
});

ui.downloadAll.addEventListener('click', () => {
  for (const job of queue.jobs) {
    if (job.status === 'done') download(job);
  }
  announce(
    'If your browser blocks multiple downloads, allow them for this site or use the individual buttons.',
  );
});

ui.jobs.addEventListener('job-download', (event) => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'number') return;
  const id = event.detail;
  const job = queue.jobs.find((item) => item.id === id);
  if (job) download(job);
});

ui.jobs.addEventListener('job-remove', (event) => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'number') return;
  const id = event.detail;
  queue.remove(id);
});

refresh();
updateSettingsControls(ui);
if (!engineAvailable) {
  announce(
    'This page is not cross-origin isolated. The multithreaded engine requires COOP/COEP response headers; use pnpm dev or the configured Cloudflare Pages deployment.',
    true,
  );
}
