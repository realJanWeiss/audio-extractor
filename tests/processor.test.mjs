import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';
import { extract, inspectAudio } from '../src/processor.ts';
import { makeMedia } from './media-fixtures.mjs';

async function readAudio(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const tracks = await input.getTracks();
    const [track] = await input.getAudioTracks();
    const packets = [];
    for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet.data);
    return {
      tracks: tracks.map((item) => item.type),
      codec: track.codec,
      channels: await track.getNumberOfChannels(),
      sampleRate: await track.getSampleRate(),
      config: await track.getDecoderConfig(),
      data: Buffer.concat(packets),
    };
  } finally {
    input.dispose();
  }
}

for (const [codec, extension, mime] of [
  ['aac', 'm4a', 'audio/mp4'],
  ['opus', 'opus', 'audio/ogg'],
  ['pcm-s16', 'wav', 'audio/wav'],
]) {
  test(`${codec} extraction removes video and preserves every encoded audio byte`, async () => {
    // No WebCodecs APIs exist in Node: a decoder/encoder fallback would fail this test.
    assert.equal(typeof AudioEncoder, 'undefined');
    assert.equal(typeof AudioDecoder, 'undefined');
    const file = await makeMedia(codec);
    const original = await readAudio(file);
    const progress = [];
    const result = await extract(file, new AbortController().signal, (value) =>
      progress.push(value),
    );
    const extracted = await readAudio(new Blob([result.data]));
    assert.deepEqual(original.tracks, ['video', 'audio']);
    assert.deepEqual(extracted.tracks, ['audio']);
    assert.equal(extracted.codec, original.codec);
    assert.equal(extracted.channels, original.channels);
    assert.equal(extracted.sampleRate, original.sampleRate);
    assert.deepEqual(extracted.data, original.data);
    if (codec === 'aac')
      assert.deepEqual(extracted.config.description, original.config.description);
    assert.equal(result.extension, extension);
    assert.equal(result.mime, mime);
    assert.ok(progress.length > 0);
    assert.ok(progress.every((value) => value >= 0 && value <= 0.99));
  });
}

test('only the first audio track is extracted', async () => {
  const file = await makeMedia('aac', { secondTrack: true });
  const result = await extract(file, new AbortController().signal, () => {});
  const extracted = await readAudio(new Blob([result.data]));
  assert.deepEqual(extracted.tracks, ['audio']);
  assert.equal(extracted.codec, 'aac');
  assert.deepEqual(extracted.data, (await readAudio(file)).data);
});

test('videos without audio report an error instead of producing an empty file', async () => {
  const videoOnly = await makeMedia(null);
  assert.equal(
    (await inspectAudio(videoOnly, new AbortController().signal)).sourceAudio,
    'no audio track',
  );
  await assert.rejects(
    extract(videoOnly, new AbortController().signal, () => {}),
    /no audio track/,
  );
});

test('corrupt or unsupported files fail without attempting conversion', async () => {
  await assert.rejects(
    extract(new Blob(['invalid video']), new AbortController().signal, () => {}),
  );
});

test('cancellation during extraction discards the partial output and allows another extraction', async () => {
  const file = await makeMedia();
  const controller = new AbortController();
  await assert.rejects(
    extract(file, controller.signal, () => controller.abort()),
    { name: 'AbortError' },
  );
  const result = await extract(file, new AbortController().signal, () => {});
  assert.ok(result.data.byteLength > 0);
});

test('an already cancelled extraction does not start reading the file', async () => {
  await assert.rejects(
    extract(new Blob(['invalid']), AbortSignal.abort(), () => {}),
    { name: 'AbortError' },
  );
});

test('an unrecognized source codec produces an explicit error without changing the codec', async () => {
  const bytes = new Uint8Array(await (await makeMedia()).arrayBuffer());
  const offset = Buffer.from(bytes).indexOf('A_AAC');
  assert.ok(offset >= 0);
  bytes.set(new TextEncoder().encode('A_BAD'), offset);
  const file = new Blob([bytes]);
  assert.equal(
    (await inspectAudio(file, new AbortController().signal)).sourceAudio,
    'unsupported codec',
  );
  await assert.rejects(
    extract(file, new AbortController().signal, () => {}),
    /codec is not supported/,
  );
});
