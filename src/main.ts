import './style.css';
import './media-job.ts';

import type { Job, OutputFormat, OutputSettings } from './types.ts';
import { extension } from './types.ts';
import { ui, announce, refreshView, removeJobTile } from './ui.ts';

const jobs: Job[] = [];
let nextJobId = 0;
let running = false;
let engineLoading = false;
let engine: typeof import('./processor.ts') | undefined;
let mediaTasks: Promise<unknown> = Promise.resolve();
let formatGeneration = 0;
const engineAvailable = crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
const lossyFormats = new Set<OutputFormat>(['mp3', 'm4a', 'ogg', 'opus', 'ac3', 'wma', 'custom']);

function readSettings(): OutputSettings {
  const format = ui.format.value as OutputFormat;
  const adjustable = format !== 'original';
  return {
    format,
    bitrateKbps:
      adjustable && lossyFormats.has(format) && ui.bitrate.value
        ? Number(ui.bitrate.value)
        : undefined,
    sampleRate: adjustable && ui.sampleRate.value ? Number(ui.sampleRate.value) : undefined,
    channels: adjustable && ui.channels.value ? Number(ui.channels.value) : undefined,
    customCodec: format === 'custom' ? ui.customCodec.value.trim() : undefined,
    customMuxer: format === 'custom' ? ui.customMuxer.value.trim() : undefined,
    customExtension:
      format === 'custom' ? ui.customExtension.value.trim().replace(/^\./, '') : undefined,
    extraArgs: adjustable
      ? ui.extraArgs.value
          .split(/\r?\n/)
          .map((arg) => arg.trim())
          .filter(Boolean)
      : [],
  };
}

function updateSettingsControls(): void {
  const format = ui.format.value as OutputFormat;
  const original = format === 'original';
  ui.bitrate.disabled = !lossyFormats.has(format);
  ui.sampleRate.disabled = original;
  ui.channels.disabled = original;
  ui.extraArgs.disabled = original;
  ui.customFields.hidden = format !== 'custom';
  if (format === 'custom') ui.advanced.open = true;
}

function settingsError(settings: OutputSettings): string | undefined {
  if (settings.format !== 'custom') return undefined;
  if (!/^[a-zA-Z0-9_]+$/.test(settings.customCodec ?? ''))
    return 'Enter a valid FFmpeg audio encoder in Advanced settings.';
  if (!/^[a-zA-Z0-9_]+$/.test(settings.customMuxer ?? ''))
    return 'Enter a valid FFmpeg muxer in Advanced settings.';
  if (!/^[a-zA-Z0-9]+$/.test(settings.customExtension ?? ''))
    return 'Enter a valid file extension in Advanced settings.';
}

function queueMediaTask<T>(task: () => Promise<T>): Promise<T> {
  const next = mediaTasks.then(task, task);
  mediaTasks = next.catch(() => undefined);
  return next;
}

function inspectAudio(job: Job): void {
  if (!engineAvailable) {
    job.sourceAudio = 'unavailable';
    refresh(job);
    return;
  }
  void queueMediaTask(async () => {
    if (!jobs.includes(job)) return;
    try {
      engine ??= await import('./processor.ts');
      await engine.loadEngine();
      job.sourceAudio = (await engine.probeAudioCodec(job)) ?? 'could not detect';
    } catch (error) {
      console.error('Audio format detection failed:', error);
      job.sourceAudio = 'could not detect';
    }
    if (jobs.includes(job)) refresh(job);
  });
}

function refresh(job?: Job): void {
  refreshView(jobs, { running, engineLoading, engineAvailable }, job);
}

function inspectVideo(job: Job): void {
  const url = URL.createObjectURL(job.file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  let finished = false;
  const timeout = window.setTimeout(cleanup, 15_000);

  function cleanup(): void {
    if (finished) return;
    finished = true;
    window.clearTimeout(timeout);
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }

  function captureFrame(): void {
    if (finished) return;
    if (jobs.includes(job) && video.videoWidth && video.videoHeight) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = Math.max(1, Math.round((480 * video.videoHeight) / video.videoWidth));
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          job.thumbnail = canvas.toDataURL('image/jpeg', 0.75);
          refresh(job);
        }
      } catch {
        // The browser may be unable to decode a frame from this video.
      }
    }
    cleanup();
  }

  video.addEventListener(
    'loadedmetadata',
    () => {
      if (finished) return;
      if (Number.isFinite(video.duration)) job.duration = video.duration;
      if (jobs.includes(job)) refresh(job);
      const frameTime =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(1, video.duration / 10)
          : 0;
      if (frameTime > 0) {
        video.addEventListener('seeked', captureFrame, { once: true });
        try {
          video.currentTime = frameTime;
        } catch {
          captureFrame();
        }
      } else {
        video.addEventListener('loadeddata', captureFrame, { once: true });
      }
    },
    { once: true },
  );
  video.addEventListener('error', cleanup, { once: true });
  video.src = url;
}

function isVideo(file: File): boolean {
  return (
    file.type.startsWith('video/') ||
    /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|ogv|ts)$/i.test(file.name)
  );
}

function fileKey(file: File): string {
  return JSON.stringify([file.name, file.size, file.type, file.lastModified]);
}

function addFiles(files: FileList | File[]): void {
  const seen = new Set(jobs.map((job) => fileKey(job.file)));
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const file of files) {
    if (!isVideo(file)) {
      invalidCount++;
      continue;
    }
    const key = fileKey(file);
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    const job: Job = {
      id: ++nextJobId,
      file,
      settings: readSettings(),
      status: 'queued',
      progress: 0,
    };
    jobs.push(job);
    refresh(job);
    inspectVideo(job);
    inspectAudio(job);
  }

  const messages = [];
  if (duplicateCount)
    messages.push(
      `${duplicateCount} duplicate ${duplicateCount === 1 ? 'file was' : 'files were'} skipped.`,
    );
  if (invalidCount)
    messages.push(
      `${invalidCount} ${invalidCount === 1 ? 'file was' : 'files were'} skipped because ${invalidCount === 1 ? 'it does' : 'they do'} not look like videos.`,
    );
  announce(messages.join(' '), invalidCount > 0);
  ui.files.value = '';
}

function download(job: Job): void {
  if (!job.output) return;

  const url = URL.createObjectURL(job.output);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${job.file.name.replace(/\.[^.]+$/, '') || 'audio'}.${job.outputExtension ?? extension[job.settings.format]}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function processQueue(): Promise<void> {
  if (running) return;

  const job = jobs.find((item) => item.status === 'queued');
  if (!job) return;
  const generation = formatGeneration;

  const invalidSettings = settingsError(job.settings);
  if (invalidSettings) {
    announce(invalidSettings, true);
    ui.advanced.open = true;
    return;
  }

  if (!engineAvailable) {
    announce(
      'Multithreaded FFmpeg needs cross-origin isolation. Serve this app with COOP/COEP headers and reload.',
      true,
    );
    return;
  }

  running = true;
  engineLoading = true;
  refresh();

  try {
    engine ??= await import('./processor.ts');
    await engine.loadEngine();
    engineLoading = false;

    if (generation !== formatGeneration || !jobs.includes(job)) return;

    const result = await queueMediaTask(async () => {
      if (generation !== formatGeneration || !jobs.includes(job)) return undefined;
      job.status = 'processing';
      refresh(job);
      return engine!.extract(job, (progress) => {
        if (generation !== formatGeneration) return;
        job.progress = progress;
        if (jobs.includes(job)) refresh(job);
      });
    });

    if (generation === formatGeneration && result && job.status === 'processing') {
      job.output = new Blob([result.data], { type: result.mime });
      job.outputExtension = result.extension;
      job.progress = 1;
      job.status = 'done';
    }
  } catch (error) {
    if (
      generation === formatGeneration &&
      (job.status === 'queued' || job.status === 'processing')
    ) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
    }
    if (generation === formatGeneration && !engine?.isLoaded()) {
      announce(
        'The FFmpeg engine could not load. Check the isolation headers and try again.',
        true,
      );
    }
  } finally {
    engineLoading = false;
    running = false;
    refresh(jobs.includes(job) ? job : undefined);
    if (generation === formatGeneration) void processQueue();
  }
}

ui.files.addEventListener('change', () => {
  if (ui.files.files) addFiles(ui.files.files);
});

function settingsChanged(): void {
  formatGeneration++;
  const wasProcessing = jobs.some((job) => job.status === 'processing');
  for (const job of jobs) {
    job.settings = readSettings();
    job.status = 'queued';
    job.progress = 0;
    job.output = undefined;
    job.outputExtension = undefined;
    job.error = undefined;
    refresh(job);
  }
  if (wasProcessing) engine?.cancelCurrent();
  refresh();
}

ui.format.addEventListener('change', () => {
  updateSettingsControls();
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
  void queueMediaTask(async () => {
    try {
      engine ??= await import('./processor.ts');
      await engine.loadEngine();
      ui.capabilities.textContent = await engine.listCapabilities();
    } catch (error) {
      ui.capabilities.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      ui.capabilities.hidden = false;
      ui.showCapabilities.disabled = false;
      ui.showCapabilities.textContent = 'Refresh available encoders and muxers';
    }
  });
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
  void processQueue();
});

ui.downloadAll.addEventListener('click', () => {
  for (const job of jobs) {
    if (job.status === 'done') download(job);
  }
  announce(
    'If your browser blocks multiple downloads, allow them for this site or use the individual buttons.',
  );
});

ui.jobs.addEventListener('job-download', (event) => {
  const id = (event as CustomEvent<number>).detail;
  const job = jobs.find((item) => item.id === id);
  if (job) download(job);
});

ui.jobs.addEventListener('job-remove', (event) => {
  const id = (event as CustomEvent<number>).detail;
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) return;

  const [job] = jobs.splice(index, 1);
  if (job.status === 'processing') {
    job.status = 'cancelled';
    engine?.cancelCurrent();
  }
  removeJobTile(id);
  refresh();
});

refresh();
updateSettingsControls();
if (!engineAvailable) {
  announce(
    'This page is not cross-origin isolated. The multithreaded engine requires COOP/COEP response headers; use pnpm dev or the configured Cloudflare Pages deployment.',
    true,
  );
}
