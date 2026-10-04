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

export function formatProgress(progress: number): string {
  return `${Math.round(progress * 100)}%`;
}

const template = document.createElement('template');
template.innerHTML = `
  <div class="${styles.row}">
    <div class="${styles.visual}">
      <div class="${styles.thumbnailSlot}"><img class="${styles.thumbnail}" alt="" hidden></div>
      <span class="${styles.state}" hidden></span>
    </div>
    <div class="${styles.info}"><strong></strong><span data-formats></span><span data-details></span></div>
    <div class="${styles.topActions}"><button class="button-icon" type="button">×</button></div>
  </div>
  <progress max="1" hidden></progress>
  <div class="${styles.bottom}">
    <span data-result hidden></span>
    <button class="button-primary" type="button" hidden>Download</button>
  </div>
`;

export class MediaJob extends HTMLElement {
  private content = document.importNode(template.content, true);
  private thumbnail = this.content.querySelector('img')!;
  private name = this.content.querySelector('strong')!;
  private formats = this.content.querySelector('[data-formats]')!;
  private details = this.content.querySelector('[data-details]')!;
  private state = this.content.querySelector<HTMLElement>(`.${styles.state}`)!;
  private progress = this.content.querySelector('progress')!;
  private result = this.content.querySelector<HTMLElement>('[data-result]')!;
  private downloadButton = this.content.querySelector<HTMLButtonElement>('.button-primary')!;
  private removeButton = this.content.querySelector<HTMLButtonElement>('.button-icon')!;

  constructor() {
    super();

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
      processing: formatProgress(job.progress),
      done: 'Done',
      error: 'Error',
      cancelled: '',
    };
    this.state.textContent = statusText[job.status];
    this.state.hidden = !this.state.textContent;
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
