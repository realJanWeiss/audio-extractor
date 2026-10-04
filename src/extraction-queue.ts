import type { Job } from './types.ts';

type Processor = Pick<typeof import('./processor.ts'), 'inspectAudio' | 'extract'>;

export interface QueueState {
  running: boolean;
  processorLoading: boolean;
}

interface QueueOptions {
  accept: string;
  loadProcessor: () => Promise<Processor>;
  onChange: (job?: Job) => void;
  onAdd: (job: Job) => void;
  onRemove: (id: number) => void;
}

function isVideo(file: File, accept: string): boolean {
  return (
    file.type.startsWith('video/') ||
    accept
      .split(',')
      .some((extension) => extension.startsWith('.') && file.name.toLowerCase().endsWith(extension))
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
  private processorLoading = false;
  private active: { job: Job; controller: AbortController } | undefined;
  private readonly inspections = new Map<number, AbortController>();
  private processor: Processor | undefined;
  private processorPromise: Promise<Processor> | undefined;

  constructor(options: QueueOptions) {
    this.options = options;
  }

  get jobs(): readonly Job[] {
    return this.items;
  }

  get state(): QueueState {
    return { running: this.running, processorLoading: this.processorLoading };
  }

  addFiles(files: Iterable<File>): { invalid: number; duplicate: number } {
    const seen = new Set(this.items.map((job) => fileKey(job.file)));
    let invalid = 0;
    let duplicate = 0;
    for (const file of files) {
      if (!isVideo(file, this.options.accept)) {
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
        status: 'queued',
        progress: 0,
      };
      this.items.push(job);
      this.options.onChange(job);
      this.options.onAdd(job);
      void this.inspectAudio(job);
    }
    return { invalid, duplicate };
  }

  remove(id: number): void {
    const index = this.items.findIndex((job) => job.id === id);
    if (index < 0) return;
    const [job] = this.items.splice(index, 1);
    this.inspections.get(id)?.abort();
    if (this.active?.job === job) {
      job.status = 'cancelled';
      this.active.controller.abort();
    }
    this.options.onRemove(id);
    this.options.onChange();
  }

  async start(): Promise<void> {
    let next = this.items.find((job) => job.status === 'queued');
    if (this.running || !next) return;
    this.running = true;
    try {
      while (next) {
        // Process one file at a time to limit peak memory usage.
        // oxlint-disable-next-line no-await-in-loop
        await this.processJob(next);
        next = this.items.find((job) => job.status === 'queued');
      }
    } finally {
      this.running = false;
      this.options.onChange();
    }
  }

  private async processJob(job: Job): Promise<void> {
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && this.items.includes(job);
    this.active = { job, controller };
    this.processorLoading = !this.processor;
    this.options.onChange();
    try {
      const processor = await this.getProcessor();
      if (!isCurrent()) return;
      this.processorLoading = false;
      job.status = 'processing';
      this.options.onChange(job);
      const result = await processor.extract(job.file, controller.signal, (progress) => {
        if (!isCurrent()) return;
        job.progress = progress;
        this.options.onChange(job);
      });
      if (isCurrent()) {
        job.output = new Blob([result.data], { type: result.mime });
        job.outputExtension = result.extension;
        job.progress = 1;
        job.status = 'done';
      }
    } catch (error) {
      if (isCurrent()) {
        job.status = 'error';
        job.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      this.processorLoading = false;
      this.active = undefined;
      this.options.onChange(this.items.includes(job) ? job : undefined);
    }
  }

  private getProcessor(): Promise<Processor> {
    return (this.processorPromise ??= this.options
      .loadProcessor()
      .then((processor) => (this.processor = processor))
      .catch((error) => {
        this.processorPromise = undefined;
        throw error;
      }));
  }

  private async inspectAudio(job: Job): Promise<void> {
    const controller = new AbortController();
    this.inspections.set(job.id, controller);
    try {
      const processor = await this.getProcessor();
      controller.signal.throwIfAborted();
      const info = await processor.inspectAudio(job.file, controller.signal);
      if (!controller.signal.aborted) Object.assign(job, info);
    } catch {
      if (!controller.signal.aborted) job.sourceAudio = 'could not detect';
    } finally {
      this.inspections.delete(job.id);
      if (this.items.includes(job)) this.options.onChange(job);
    }
  }
}
