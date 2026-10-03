interface Engine {
  loaded: boolean;
  terminate(): void;
}

export class EngineCancelledError extends Error {
  constructor() {
    super('The engine operation was cancelled.');
    this.name = 'EngineCancelledError';
  }
}

export class EngineController<T extends Engine> {
  private instance: T | undefined;
  private loading: Promise<T> | undefined;
  private tasks: Promise<unknown> = Promise.resolve();
  private cancellation = new AbortController();

  private readonly create: () => T;
  private readonly initialize: (instance: T) => Promise<unknown>;
  private readonly loadTimeoutMs: number;

  constructor(
    create: () => T,
    initialize: (instance: T) => Promise<unknown>,
    loadTimeoutMs = 90_000,
  ) {
    this.create = create;
    this.initialize = initialize;
    this.loadTimeoutMs = loadTimeoutMs;
  }

  isLoaded(): boolean {
    return !!this.instance?.loaded;
  }

  load(): Promise<T> {
    if (this.loading) return this.loading;
    if (this.instance?.loaded) return Promise.resolve(this.instance);

    const instance = this.create();
    const signal = this.cancellation.signal;
    this.instance = instance;
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(
          new Error(
            'FFmpeg took too long to load. Check browser support and the isolation headers.',
          ),
        );
      }, this.loadTimeoutMs);
    });
    const loading = this.untilCancelled(
      Promise.race([
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return this.initialize(instance);
        }),
        deadline,
      ]),
      signal,
    )
      .then(() => instance)
      .catch((error: unknown) => {
        instance.terminate();
        if (this.instance === instance) this.instance = undefined;
        throw error;
      })
      .finally(() => {
        clearTimeout(timeout);
        // A cancelled load may settle after a replacement load has started.
        if (this.loading === loading) this.loading = undefined;
      });
    this.loading = loading;
    return loading;
  }

  run<R>(task: (instance: T, signal: AbortSignal) => Promise<R>): Promise<R> {
    const next = this.tasks.then(async () => {
      const signal = this.cancellation.signal;
      const instance = await this.load();
      signal.throwIfAborted();
      return this.untilCancelled(
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return task(instance, signal);
        }),
        signal,
      );
    });
    // Failed or cancelled tasks must not prevent queued tasks from starting.
    this.tasks = next.catch(() => undefined);
    return next;
  }

  cancel(): void {
    const instance = this.instance;
    this.instance = undefined;
    this.loading = undefined;
    this.cancellation.abort(new EngineCancelledError());
    this.cancellation = new AbortController();
    instance?.terminate();
  }

  private untilCancelled<R>(task: Promise<R>, signal: AbortSignal): Promise<R> {
    let onAbort: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([task, cancelled]).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  }
}
