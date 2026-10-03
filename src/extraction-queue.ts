import { EngineCancelledError } from './engine-controller.ts';
import { settingsError } from './audio-format.ts';
import type { Job, OutputSettings } from './types.ts';

export type Processor = Pick<
  typeof import('./processor.ts'),
  'loadEngine' | 'isLoaded' | 'cancelCurrent' | 'probeAudioCodec' | 'extract' | 'listCapabilities'
>;

export interface QueueState {
  running: boolean;
  engineLoading: boolean;
  engineAvailable: boolean;
}

interface QueueOptions {
  engineAvailable: boolean;
  loadProcessor: () => Promise<Processor>;
  onChange: (job?: Job) => void;
  onAdd: (job: Job) => void;
  onRemove: (id: number) => void;
  onError: (message: string, kind: 'settings' | 'engine') => void;
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

export class ExtractionQueue {
  private readonly items: Job[] = [];
  private readonly options: QueueOptions;
  private nextJobId = 0;
  private running = false;
  private activeJob: Job | undefined;
  private engineLoading = false;
  private processor: Processor | undefined;
  private processorLoading: Promise<Processor> | undefined;
  private settingsGeneration = 0;

  constructor(options: QueueOptions) {
    this.options = options;
  }

  get jobs(): readonly Job[] {
    return this.items;
  }

  get state(): QueueState {
    return {
      running: this.running,
      engineLoading: this.engineLoading,
      engineAvailable: this.options.engineAvailable,
    };
  }

  addFiles(
    files: Iterable<File>,
    settings: OutputSettings,
  ): { invalid: number; duplicate: number } {
    const seen = new Set(this.items.map((job) => fileKey(job.file)));
    let invalid = 0;
    let duplicate = 0;
    for (const file of files) {
      if (!isVideo(file)) {
        invalid++;
        continue;
      }
      const key = fileKey(file);
      if (seen.has(key)) {
        duplicate++;
        continue;
      }
      seen.add(key);
      const job: Job = {
        id: ++this.nextJobId,
        file,
        settings: { ...settings, extraArgs: [...settings.extraArgs] },
        status: 'queued',
        progress: 0,
      };
      this.items.push(job);
      this.options.onChange(job);
      this.options.onAdd(job);
      this.inspectAudio(job);
    }
    return { invalid, duplicate };
  }

  remove(id: number): void {
    const index = this.items.findIndex((job) => job.id === id);
    if (index < 0) return;
    const [job] = this.items.splice(index, 1);
    if (this.activeJob === job) {
      job.status = 'cancelled';
      this.processor?.cancelCurrent();
    }
    this.options.onRemove(id);
    this.options.onChange();
  }

  updateSettings(settings: OutputSettings): void {
    this.settingsGeneration++;
    for (const job of this.items) {
      job.settings = { ...settings, extraArgs: [...settings.extraArgs] };
      job.status = 'queued';
      job.progress = 0;
      job.output = undefined;
      job.outputExtension = undefined;
      job.error = undefined;
      this.options.onChange(job);
    }
    if (this.running) this.processor?.cancelCurrent();
    this.options.onChange();
  }

  async listCapabilities(): Promise<string> {
    return (await this.getProcessor()).listCapabilities();
  }

  async start(): Promise<void> {
    if (this.running) return;
    const job = this.items.find((item) => item.status === 'queued');
    if (!job) return;
    if (!this.options.engineAvailable) {
      this.options.onError(
        'Multithreaded FFmpeg needs cross-origin isolation. Serve this app with COOP/COEP headers and reload.',
        'engine',
      );
      return;
    }
    const generation = this.settingsGeneration;
    this.running = true;
    try {
      let next: Job | undefined = job;
      while (next && generation === this.settingsGeneration) {
        const invalidSettings = settingsError(next.settings);
        if (invalidSettings) {
          this.options.onError(invalidSettings, 'settings');
          break;
        }
        // Jobs share one FFmpeg filesystem and must complete in sequence.
        // oxlint-disable-next-line no-await-in-loop
        await this.processJob(next, generation);
        next = this.items.find((item) => item.status === 'queued');
      }
    } finally {
      this.running = false;
      this.options.onChange();
    }
  }

  private async processJob(job: Job, generation: number): Promise<void> {
    const isCurrent = () => generation === this.settingsGeneration && this.items.includes(job);
    this.activeJob = job;
    this.engineLoading = true;
    this.options.onChange();
    try {
      const processor = await this.getProcessor();
      if (!isCurrent()) return;
      await processor.loadEngine();
      this.engineLoading = false;
      this.options.onChange();
      if (!isCurrent()) return;
      const result = await processor.extract(
        job,
        (progress) => {
          if (!isCurrent() || job.status !== 'processing') return;
          job.progress = progress;
          this.options.onChange(job);
        },
        () => {
          if (!isCurrent()) return false;
          job.status = 'processing';
          this.options.onChange(job);
          return true;
        },
      );
      if (isCurrent() && result && job.status === 'processing') {
        job.output = new Blob([result.data], { type: result.mime });
        job.outputExtension = result.extension;
        job.progress = 1;
        job.status = 'done';
      }
    } catch (error) {
      if (error instanceof EngineCancelledError) return;
      if (isCurrent() && (job.status === 'queued' || job.status === 'processing')) {
        job.status = 'error';
        job.error = error instanceof Error ? error.message : String(error);
      }
      if (isCurrent() && !this.processor?.isLoaded()) {
        this.options.onError(
          'The FFmpeg engine could not load. Check the isolation headers and try again.',
          'engine',
        );
      }
    } finally {
      this.engineLoading = false;
      this.activeJob = undefined;
      this.options.onChange(this.items.includes(job) ? job : undefined);
    }
  }

  private getProcessor(): Promise<Processor> {
    if (this.processor) return Promise.resolve(this.processor);
    if (this.processorLoading) return this.processorLoading;
    this.processorLoading = this.options
      .loadProcessor()
      .then((processor) => {
        this.processor = processor;
        return processor;
      })
      .finally(() => {
        this.processorLoading = undefined;
      });
    return this.processorLoading;
  }

  private inspectAudio(job: Job): void {
    if (!this.options.engineAvailable) {
      job.sourceAudio = 'unavailable';
      this.options.onChange(job);
      return;
    }
    void (async () => {
      if (!this.items.includes(job)) return;
      try {
        const processor = await this.getProcessor();
        job.sourceAudio =
          (await processor.probeAudioCodec(job, () => this.items.includes(job))) ??
          'could not detect';
      } catch (error) {
        if (error instanceof EngineCancelledError) return;
        console.error('Audio format detection failed:', error);
        job.sourceAudio = 'could not detect';
      }
      if (this.items.includes(job)) this.options.onChange(job);
    })();
  }
}
