import type { Job } from './types.ts';

export type Processor = Pick<typeof import('./processor.ts'), 'inspectAudio' | 'extract'>;

export interface QueueState {
  running: boolean;
  processorLoading: boolean;
}

interface QueueOptions {
  loadProcessor: () => Promise<Processor>;
  onChange: (job?: Job) => void;
  onAdd: (job: Job) => void;
  onRemove: (id: number) => void;
}

function isVideo(file: File): boolean {
  return (
    file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|ts|mts|m2ts|ogv)$/i.test(file.name)
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
  private activeJob: Job | undefined;
  private activeExtraction: AbortController | undefined;
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
    this.inspections.get(id)?.abort();
    if (this.activeJob === job) {
      job.status = 'cancelled';
      this.activeExtraction?.abort();
    }
    this.options.onRemove(id);
    this.options.onChange();
  }

  async start(): Promise<void> {
    if (this.running || !this.items.some((job) => job.status === 'queued')) return;
    this.running = true;
    try {
      let next = this.items.find((job) => job.status === 'queued');
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
    this.activeJob = job;
    this.activeExtraction = controller;
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
      this.activeJob = undefined;
      this.activeExtraction = undefined;
      this.options.onChange(this.items.includes(job) ? job : undefined);
    }
  }

  private getProcessor(): Promise<Processor> {
    if (this.processor) return Promise.resolve(this.processor);
    if (this.processorPromise) return this.processorPromise;
    this.processorPromise = this.options
      .loadProcessor()
      .then((processor) => {
        this.processor = processor;
        return processor;
      })
      .finally(() => {
        this.processorPromise = undefined;
      });
    return this.processorPromise;
  }

  private inspectAudio(job: Job): void {
    const controller = new AbortController();
    this.inspections.set(job.id, controller);
    void (async () => {
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
    })();
  }
}
