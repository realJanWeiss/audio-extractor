import type { Job } from './types.ts';
import styles from './media-job.module.css';

function formatSize(bytes: number): string {
  return bytes < 1_000_000
    ? `${Math.round(bytes / 1_000)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export class MediaJob extends HTMLElement {
  private content = document.createDocumentFragment();
  private thumbnailSlot = document.createElement('div');
  private thumbnail = document.createElement('img');
  private name = document.createElement('strong');
  private formats = document.createElement('span');
  private details = document.createElement('span');
  private state = document.createElement('span');
  private progress = document.createElement('progress');
  private result = document.createElement('span');
  private downloadButton = document.createElement('button');
  private removeButton = document.createElement('button');

  constructor() {
    super();

    const row = document.createElement('div');
    row.className = styles.row;
    const visual = document.createElement('div');
    visual.className = styles.visual;
    const info = document.createElement('div');
    info.className = styles.info;
    info.append(this.name, this.formats, this.details);
    this.thumbnailSlot.className = styles.thumbnailSlot;
    this.thumbnail.className = styles.thumbnail;
    this.thumbnail.alt = '';
    this.thumbnail.hidden = true;
    this.thumbnailSlot.append(this.thumbnail);
    this.state.className = styles.state;
    visual.append(this.thumbnailSlot, this.state);
    const topActions = document.createElement('div');
    topActions.className = styles.topActions;
    this.removeButton.type = 'button';
    this.removeButton.className = styles.removeButton;
    this.removeButton.textContent = '×';
    topActions.append(this.removeButton);
    row.append(visual, info, topActions);

    const bottom = document.createElement('div');
    bottom.className = styles.bottom;
    this.downloadButton.type = 'button';
    this.downloadButton.textContent = 'Download';
    bottom.append(this.result, this.downloadButton);

    this.progress.className = styles.progress;
    this.content.append(row, this.progress, bottom);
    this.downloadButton.addEventListener('click', () => this.dispatchJobEvent('job-download'));
    this.removeButton.addEventListener('click', () => this.dispatchJobEvent('job-remove'));
  }

  connectedCallback(): void {
    this.classList.add(styles.job);
    this.append(this.content);
  }

  private dispatchJobEvent(name: string): void {
    this.dispatchEvent(
      new CustomEvent(name, {
        bubbles: true,
        detail: Number(this.dataset.id),
      }),
    );
  }

  update(job: Job): void {
    if (job.thumbnail && this.thumbnail.src !== job.thumbnail) this.thumbnail.src = job.thumbnail;
    this.thumbnail.hidden = !job.thumbnail;
    this.name.textContent = job.file.name;
    this.formats.textContent = `Video: ${job.file.type || 'unknown'} · Audio: ${job.sourceAudio ?? 'detecting…'}`;
    this.details.textContent = [
      job.duration === undefined ? '' : formatDuration(job.duration),
      formatSize(job.file.size),
    ]
      .filter(Boolean)
      .join(' · ');

    const statusText = {
      queued: '',
      processing: `${Math.round(job.progress * 100)}%`,
      done: 'Done',
      error: 'Error',
      cancelled: '',
    };
    this.state.textContent = statusText[job.status];
    this.state.hidden = !this.state.textContent;
    this.progress.max = 1;
    this.progress.value = job.progress;
    this.progress.hidden = job.status !== 'processing';

    this.result.textContent =
      job.error ||
      (job.output ? `${job.outputExtension?.toUpperCase()} · ${formatSize(job.output.size)}` : '');
    this.result.hidden = !this.result.textContent;
    this.downloadButton.hidden = job.status !== 'done';
    const removeAction = job.status === 'processing' ? 'Cancel' : 'Remove';
    this.removeButton.setAttribute('aria-label', `${removeAction} ${job.file.name}`);
    this.removeButton.title = removeAction;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'media-job': MediaJob;
  }
}

customElements.define('media-job', MediaJob);
