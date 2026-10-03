import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EngineCancelledError } from '../src/engine-controller.ts';
import { ExtractionQueue } from '../src/extraction-queue.ts';

const settings = { format: 'mp3', extraArgs: [] };
const output = { data: new Uint8Array([1, 2, 3]), extension: 'mp3', mime: 'audio/mpeg' };

function video(name) {
  return new File(['video'], name, { type: 'video/mp4', lastModified: 1 });
}

function setup(overrides = {}, engineAvailable = true) {
  const calls = { imports: 0, loads: 0, cancellations: 0, extracted: [], errors: [], states: [] };
  const processor = {
    async loadEngine() {
      calls.loads++;
    },
    isLoaded: () => true,
    cancelCurrent() {
      calls.cancellations++;
    },
    probeAudioCodec: async () => 'AAC',
    listCapabilities: async () => 'Capabilities',
    async extract(job, onProgress, start) {
      if (!start()) return undefined;
      calls.extracted.push(job.id);
      onProgress(0.5);
      return output;
    },
    ...overrides,
  };
  const queue = new ExtractionQueue({
    engineAvailable,
    async loadProcessor() {
      calls.imports++;
      return processor;
    },
    onChange() {
      calls.states.push(queue.state);
    },
    onAdd() {},
    onRemove() {},
    onError: (message, kind) => calls.errors.push({ message, kind }),
  });
  return { queue, calls };
}

test('adding files filters invalid files and duplicates and snapshots settings', () => {
  const { queue } = setup({}, false);
  const custom = { ...settings, extraArgs: ['-y'] };
  const result = queue.addFiles(
    [video('one.mp4'), video('one.mp4'), new File(['text'], 'notes.txt')],
    custom,
  );
  assert.deepEqual(result, { invalid: 1, duplicate: 1 });
  custom.extraArgs.push('-ar', '44100');
  assert.deepEqual(queue.jobs[0].settings.extraArgs, ['-y']);
  assert.equal(queue.jobs[0].sourceAudio, 'unavailable');
  assert.deepEqual(queue.addFiles([video('one.mp4')], settings), { invalid: 0, duplicate: 1 });
});

test('a batch shares its lazy processor and processes each job once', async () => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const { queue, calls } = setup({
    async extract(job, onProgress, start) {
      if (!start()) return undefined;
      calls.extracted.push(job.id);
      onProgress(0.5);
      if (job.id === 1) {
        started.resolve();
        await finish.promise;
      }
      return output;
    },
  });
  queue.addFiles([video('one.mp4'), video('two.mp4')], settings);
  const batch = queue.start();
  await started.promise;
  await queue.start();
  assert.deepEqual(calls.extracted, [1]);
  assert.deepEqual(
    queue.jobs.map((job) => job.status),
    ['processing', 'queued'],
  );
  finish.resolve();
  await Promise.all([batch, queue.listCapabilities()]);
  assert.equal(calls.imports, 1);
  assert.deepEqual(calls.extracted, [1, 2]);
  assert.deepEqual(
    queue.jobs.map((job) => job.status),
    ['done', 'done'],
  );
  assert.equal(queue.jobs[0].output.type, 'audio/mpeg');
  assert.equal(queue.jobs[0].output.size, 3);
  assert.equal(queue.jobs[0].progress, 1);
  assert.equal(queue.state.running, false);
  assert.equal(queue.state.engineLoading, false);
  assert.equal(
    calls.states.slice(2, -1).every((state) => state.running),
    true,
  );
});

test('a failed extraction does not prevent the next job from completing', async () => {
  const { queue } = setup({
    async extract(job, _onProgress, start) {
      start();
      if (job.id === 1) throw new Error('Invalid audio track');
      return output;
    },
  });
  queue.addFiles([video('one.mp4'), video('two.mp4')], settings);
  await queue.start();
  assert.equal(queue.jobs[0].status, 'error');
  assert.equal(queue.jobs[0].error, 'Invalid audio track');
  assert.equal(queue.jobs[1].status, 'done');
});

test('settings changes discard outputs and ignore stale progress and results', async () => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let attempt = 0;
  const { queue, calls } = setup({
    async extract(_job, onProgress, start) {
      start();
      if (++attempt === 1) {
        started.resolve(onProgress);
        return finish.promise;
      }
      return output;
    },
  });
  queue.addFiles([video('one.mp4'), video('two.mp4')], settings);
  const batch = queue.start();
  const oldProgress = await started.promise;
  queue.updateSettings({ format: 'wav', extraArgs: [] });
  oldProgress(0.9);
  finish.resolve(output);
  await batch;
  assert.equal(calls.cancellations, 1);
  assert.deepEqual(
    queue.jobs.map((job) => job.status),
    ['queued', 'queued'],
  );
  assert.equal(queue.jobs[0].progress, 0);
  assert.equal(queue.jobs[0].output, undefined);
  assert.equal(queue.jobs[0].settings.format, 'wav');
  // A new explicit start is required after changing settings.
  await queue.start();
  assert.deepEqual(
    queue.jobs.map((job) => job.status),
    ['done', 'done'],
  );
  queue.updateSettings(settings);
  for (const job of queue.jobs) {
    assert.equal(job.status, 'queued');
    assert.equal(job.progress, 0);
    assert.equal(job.output, undefined);
    assert.equal(job.outputExtension, undefined);
    assert.equal(job.error, undefined);
  }
});

test('removing an active job cancels it and continues the remaining batch', async () => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const { queue } = setup({
    cancelCurrent() {
      finish.reject(new EngineCancelledError());
    },
    async extract(job, _onProgress, start) {
      start();
      if (job.id === 1) {
        started.resolve();
        return finish.promise;
      }
      return output;
    },
  });
  queue.addFiles([video('one.mp4'), video('two.mp4')], settings);
  const removed = queue.jobs[0];
  const batch = queue.start();
  await started.promise;
  queue.remove(removed.id);
  await batch;
  assert.equal(removed.status, 'cancelled');
  assert.equal(removed.output, undefined);
  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0].id, 2);
  assert.equal(queue.jobs[0].status, 'done');
});

test('settings changes during engine loading prevent the old batch from starting', async () => {
  const loading = Promise.withResolvers();
  const ready = Promise.withResolvers();
  let attempt = 0;
  const { queue, calls } = setup({
    async loadEngine() {
      if (++attempt === 1) {
        loading.resolve();
        await ready.promise;
      }
    },
    cancelCurrent() {
      calls.cancellations++;
      ready.reject(new EngineCancelledError());
    },
  });
  queue.addFiles([video('one.mp4')], settings);
  const batch = queue.start();
  await loading.promise;
  queue.updateSettings({ format: 'flac', extraArgs: [] });
  await batch;
  assert.equal(calls.cancellations, 1);
  assert.deepEqual(calls.extracted, []);
  assert.equal(queue.jobs[0].status, 'queued');
  assert.equal(queue.state.running, false);
  assert.equal(queue.state.engineLoading, false);
  await queue.start();
  assert.equal(queue.jobs[0].status, 'done');
});

test('removing a job during engine loading cancels the load and continues the batch', async () => {
  const loading = Promise.withResolvers();
  const ready = Promise.withResolvers();
  const { queue, calls } = setup({
    async loadEngine() {
      if (++calls.loads === 1) {
        loading.resolve();
        await ready.promise;
      }
    },
    cancelCurrent() {
      calls.cancellations++;
      ready.reject(new EngineCancelledError());
    },
  });
  queue.addFiles([video('one.mp4'), video('two.mp4')], settings);
  const batch = queue.start();
  await loading.promise;
  queue.remove(1);
  await batch;
  assert.equal(calls.cancellations, 1);
  assert.equal(calls.loads, 2);
  assert.deepEqual(calls.extracted, [2]);
  assert.equal(queue.jobs[0].status, 'done');
});

test('invalid custom settings report a settings error before starting extraction', async () => {
  const { queue, calls } = setup();
  queue.addFiles([video('one.mp4')], { format: 'custom', extraArgs: [] });
  await queue.start();
  assert.equal(calls.errors.length, 1);
  assert.equal(calls.errors[0].kind, 'settings');
  assert.equal(calls.loads, 0);
  assert.deepEqual(calls.extracted, []);
  assert.equal(queue.jobs[0].status, 'queued');
});

test('an unavailable engine reports an error without importing the processor', async () => {
  const { queue, calls } = setup({}, false);
  queue.addFiles([video('one.mp4')], settings);
  await queue.start();
  assert.equal(calls.errors[0].kind, 'engine');
  assert.equal(calls.imports, 0);
  assert.equal(queue.state.running, false);
});
