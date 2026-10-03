import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveOutputFormat } from '../src/audio-format.ts';

test('chooses containers that can copy the original codec without encoding', () => {
  for (const [codec, extension] of [
    ['aac', 'm4a'],
    ['mp3', 'mp3'],
    ['opus', 'opus'],
    ['vorbis', 'ogg'],
    ['flac', 'flac'],
    ['pcm-s16', 'wav'],
    ['pcm-s24', 'wav'],
    ['ac3', 'mka'],
    ['eac3', 'mka'],
    ['dts', 'mka'],
  ]) {
    const result = resolveOutputFormat(codec);
    assert.equal(result.extension, extension);
    assert.ok(result.format.getSupportedAudioCodecs().includes(codec));
  }
});

test('unsupported codecs are rejected with no reencoding fallback', () => {
  for (const codec of ['alac', 'wma', 'unknown']) {
    assert.throws(() => resolveOutputFormat(codec), /cannot be extracted without reencoding/);
  }
});
