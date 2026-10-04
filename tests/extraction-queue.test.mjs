import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExtractionQueue } from '../src/extraction-queue.ts';

const output = { data: new Uint8Array([1, 2, 3]).buffer, extension: 'm4a', mime: 'audio/mp4' };

function video(name) {
  return new File(['video'], name, { type: 'video/mp4', lastModified: 1 });
}

function setup(overrides = {}, loadProcessor) {
  const calls = { imports: 0, extracted: [], states: [] };
  const processor = {
    inspectAudio: async () => ({ sourceAudio: 'AAC' }),
    async extract(file, _signal, onProgress) {
      calls.extracted.push(file.name);
      onProgress(0.5);
      return output;
    },
    ...overrides,
  };
  const queue = new ExtractionQueue({
    async loadProcessor() {
      calls.imports++;
      return loadProcessor ? loadProcessor(processor, calls) : processor;
    },
    onChange() {
      calls.states.push(queue.state);
    },
    onAdd() {},
    onRemove() {},
  });
  return { queue, calls };
}

test('adding files filters invalid files and duplicates', () => {
  const { queue } = setup();
  assert.deepEqual(
    queue.addFiles([video('one.mp4'), video('one.mp4'), new File(['text'], 'notes.txt')]),
    {
      invalid: 1,
      duplicate: 1,
    },
  );
  assert.deepEqual(queue.addFiles([video('one.mp4')]), { invalid: 0, duplicate: 1 });
  assert.equal(queue.jobs.length, 1);
});

test('a batch shares its lazy processor and processes each job once', async () => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const { queue, calls } = setup({
    async extract(file, _signal, onProgress) {
      calls.extracted.push(file.name);
      onProgress(0.5);
      if (file.name === 'one.mp4') {
        started.resolve();
        await finish.promise;
      }
      return output;
    },
  });
  queue.addFiles([video('one.mp4'), video('two.mp4')]);
  const batch = queue.start();
  await started.promise;
  await queue.start();
  assert.deepEqual(calls.extracted, ['one.mp4']);
  assert.deepEqual(
    queue.jobs.map((job) => job.status),
    ['processing', 'queued'],
  );
  finish.resolve();
  await batch;
  assert.equal(calls.imports, 1);
  assert.deepEqual(calls.extracted, ['one.mp4', 'two.mp4']);
  assert.deepEqual(
    queue.jobs.map((job) => job.status),
    ['done', 'done'],
  );
  assert.equal(queue.jobs[0].output.type, 'audio/mp4');
  assert.equal(queue.jobs[0].output.size, 3);
  assert.equal(queue.jobs[0].progress, 1);
  assert.equal(queue.state.running, false);
  assert.equal(queue.state.processorLoading, false);
});

test('a failed extraction does not prevent the next job from completing', async () => {
  const { queue } = setup({
    async extract(file) {
      if (file.name === 'one.mp4') throw new Error('Unsupported audio codec');
      return output;
    },
  });
  queue.addFiles([video('one.mp4'), video('two.mp4')]);
  await queue.start();
  assert.equal(queue.jobs[0].status, 'error');
  assert.equal(queue.jobs[0].error, 'Unsupported audio codec');
  assert.equal(queue.jobs[0].output, undefined);
  assert.equal(queue.jobs[1].status, 'done');
});

test('removing an active job cancels it and continues the remaining batch', async () => {
  const started = Promise.withResolvers();
  const { queue } = setup({
    async extract(file, signal) {
      if (file.name === 'one.mp4') {
        started.resolve(signal);
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      return output;
    },
  });
  queue.addFiles([video('one.mp4'), video('two.mp4')]);
  const removed = queue.jobs[0];
  const batch = queue.start();
  const signal = await started.promise;
  queue.remove(removed.id);
  await batch;
  assert.equal(signal.aborted, true);
  assert.equal(removed.status, 'cancelled');
  assert.equal(removed.output, undefined);
  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0].status, 'done');
});

test('late results and progress from a removed job are ignored', async () => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const { queue } = setup({
    async extract(_file, _signal, onProgress) {
      started.resolve(onProgress);
      return finish.promise;
    },
  });
  queue.addFiles([video('one.mp4')]);
  const job = queue.jobs[0];
  const batch = queue.start();
  const progress = await started.promise;
  queue.remove(job.id);
  progress(0.9);
  finish.resolve(output);
  await batch;
  assert.equal(job.output, undefined);
  assert.equal(job.progress, 0);
  assert.equal(job.status, 'cancelled');
});

test('removing a job during module loading prevents extraction and continues the batch', async () => {
  const ready = Promise.withResolvers();
  const { queue, calls } = setup({}, async (processor) => {
    await ready.promise;
    return processor;
  });
  queue.addFiles([video('one.mp4'), video('two.mp4')]);
  const batch = queue.start();
  queue.remove(1);
  ready.resolve();
  await batch;
  assert.equal(calls.imports, 1);
  assert.deepEqual(calls.extracted, ['two.mp4']);
  assert.equal(queue.jobs[0].status, 'done');
});

test('a failed module import can be retried on a subsequent batch', async () => {
  const { queue } = setup({}, (processor, calls) => {
    if (calls.imports === 1) throw new Error('Module download failed');
    return processor;
  });
  queue.addFiles([video('one.mp4')]);
  await queue.start();
  assert.equal(queue.jobs[0].status, 'error');
  queue.addFiles([video('two.mp4')]);
  await queue.start();
  assert.equal(queue.jobs[1].status, 'done');
});
