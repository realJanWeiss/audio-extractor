import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioCodec, canCopyAac, resolveOutputFormat } from '../src/audio-format.ts';

test('original audio selects a compatible container or falls back to Matroska', () => {
  const settings = { format: 'original', extraArgs: [] };
  assert.deepEqual(resolveOutputFormat(settings, 'aac'), { extension: 'm4a', mime: 'audio/mp4' });
  assert.deepEqual(resolveOutputFormat(settings, 'opus'), {
    extension: 'opus',
    mime: 'audio/ogg',
  });
  for (const codec of [undefined, 'unknown']) {
    assert.deepEqual(resolveOutputFormat(settings, codec), {
      extension: 'mka',
      mime: 'audio/x-matroska',
    });
  }
  assert.deepEqual(audioCodec(settings, false), ['-c:a', 'copy']);
});

test('AAC stream copying only applies when settings do not require reencoding', () => {
  const settings = { format: 'm4a', extraArgs: [] };
  assert.equal(canCopyAac(settings, 'aac'), true);
  assert.deepEqual(audioCodec(settings, true), ['-c:a', 'copy']);
  assert.deepEqual(audioCodec(settings, false), ['-c:a', 'aac', '-b:a', '192k']);
  assert.equal(canCopyAac(settings, 'mp3'), false);
  assert.equal(canCopyAac({ ...settings, format: 'mp3' }, 'aac'), false);
  for (const options of [
    { bitrateKbps: 128 },
    { sampleRate: 44100 },
    { channels: 1 },
    { extraArgs: ['-af', 'volume=0.5'] },
  ]) {
    assert.equal(canCopyAac({ ...settings, ...options }, 'aac'), false);
  }
});

test('explicit encoding settings replace defaults and preserve additional argument order', () => {
  assert.deepEqual(audioCodec({ format: 'mp3', extraArgs: [] }, false), [
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
  ]);
  assert.deepEqual(
    audioCodec(
      {
        format: 'mp3',
        bitrateKbps: 128,
        sampleRate: 44100,
        channels: 1,
        extraArgs: ['-af', 'volume=0.5'],
      },
      false,
    ),
    ['-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1', '-af', 'volume=0.5'],
  );
});

test('custom formats use the requested encoder, muxer, and extension', () => {
  const settings = {
    format: 'custom',
    customCodec: 'aac',
    customMuxer: 'adts',
    customExtension: 'aac',
    extraArgs: [],
  };
  assert.deepEqual(audioCodec(settings, false), ['-c:a', 'aac', '-f', 'adts']);
  assert.deepEqual(resolveOutputFormat(settings), {
    extension: 'aac',
    mime: 'application/octet-stream',
  });
});
