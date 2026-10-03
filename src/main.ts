import './style.css';
import './media-job.ts';

import { ExtractionQueue } from './extraction-queue.ts';
import { inspectVideo } from './video-preview.ts';
import { download } from './download.ts';
import { ui, announce, refreshView, removeJobTile } from './ui.ts';
import type { Job } from './types.ts';

const queue = new ExtractionQueue({
  loadProcessor: () => import('./processor.ts'),
  onChange: refresh,
  onAdd: (job) =>
    inspectVideo(
      job,
      () => refresh(job),
      () => queue.jobs.includes(job),
    ),
  onRemove: removeJobTile,
});

function refresh(job?: Job): void {
  refreshView(queue.jobs, queue.state, job);
}

function addFiles(files: FileList | File[]): void {
  const { invalid, duplicate } = queue.addFiles(Array.from(files));
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
