import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EngineCancelledError, EngineController } from '../src/engine-controller.ts';

function deferred() {
  return Promise.withResolvers();
}

function setup(loadTimeoutMs) {
  const instances = [];
  const controller = new EngineController(
    () => {
      const instance = {
        loaded: false,
        terminated: false,
        ready: deferred(),
        started: deferred(),
        terminate() {
          this.terminated = true;
          this.loaded = false;
        },
      };
      instances.push(instance);
      return instance;
    },
    async (instance) => {
      instance.started.resolve();
      await instance.ready.promise;
      instance.loaded = true;
    },
    loadTimeoutMs,
  );
  return { controller, instances };
}

test('cancelled load cleanup cannot clear a replacement load', async () => {
  const { controller, instances } = setup();
  const oldLoad = controller.load();
  const cancelled = assert.rejects(oldLoad, EngineCancelledError);
  await instances[0].started.promise;
  controller.cancel();
  const replacement = controller.load();
  await cancelled;
  assert.equal(controller.load(), replacement);
  instances[0].ready.reject(new Error('Late load failure'));
  instances[1].ready.resolve();
  assert.equal(await replacement, instances[1]);
  assert.equal(controller.isLoaded(), true);
  assert.equal(instances[1].terminated, false);
});

test('operations execute serially and a failure does not poison the queue', async () => {
  const { controller, instances } = setup();
  const loading = controller.load();
  instances[0].ready.resolve();
  await loading;
  const started = deferred();
  const finish = deferred();
  const calls = [];
  const first = controller.run(async () => {
    calls.push('first');
    started.resolve();
    await finish.promise;
    throw new Error('Conversion failed');
  });
  const failed = assert.rejects(first, /Conversion failed/);
  const second = controller.run(async () => {
    calls.push('second');
    return 42;
  });
  await started.promise;
  assert.deepEqual(calls, ['first']);
  finish.resolve();
  await failed;
  assert.equal(await second, 42);
  assert.deepEqual(calls, ['first', 'second']);
});

test('cancellation releases an active task and queued work uses a fresh instance', async () => {
  const { controller, instances } = setup();
  const loading = controller.load();
  instances[0].ready.resolve();
  await loading;
  const started = deferred();
  const finish = deferred();
  const first = controller.run(async (instance, signal) => {
    started.resolve(signal);
    await finish.promise;
    return instance;
  });
  const cancelled = assert.rejects(first, EngineCancelledError);
  const second = controller.run(async (instance) => instance);
  const signal = await started.promise;
  controller.cancel();
  await cancelled;
  // The abandoned task is still pending, but no longer holds up the queue.
  assert.equal(signal.aborted, true);
  assert.equal(instances[0].terminated, true);
  await instances[1].started.promise;
  instances[1].ready.resolve();
  assert.equal(await second, instances[1]);
  finish.resolve();
  await Promise.resolve();
  assert.equal(controller.isLoaded(), true);
});

test('load timeout terminates the engine and allows a retry', async () => {
  const { controller, instances } = setup(5);
  await assert.rejects(controller.load(), /too long to load/);
  assert.equal(instances[0].terminated, true);
  const retry = controller.load();
  instances[1].ready.resolve();
  assert.equal(await retry, instances[1]);
});
