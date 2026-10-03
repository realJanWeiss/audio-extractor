import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedVideoPacketSource,
  EncodedPacket,
  MkvOutputFormat,
  Output,
} from 'mediabunny';

// Small synthetic encoded frames. Tests copy packets without using any media encoder or decoder.
const fixtures = {
  aac: {
    config: {
      codec: 'mp4a.40.2',
      numberOfChannels: 2,
      sampleRate: 48000,
      description: new Uint8Array([0x11, 0x90]),
    },
    data: new Uint8Array([0x21, 0x10, 0x04, 0x60, 0x8c, 0x1c]),
    duration: 1024 / 48000,
  },
  opus: {
    config: {
      codec: 'opus',
      numberOfChannels: 1,
      sampleRate: 48000,
      description: new Uint8Array([
        79, 112, 117, 115, 72, 101, 97, 100, 1, 1, 0, 0, 128, 187, 0, 0, 0, 0, 0,
      ]),
    },
    data: new Uint8Array([0xf8, 0xff, 0xfe]),
    duration: 0.02,
  },
  'pcm-s16': {
    config: { codec: 'pcm-s16', numberOfChannels: 1, sampleRate: 48000 },
    data: Uint8Array.from({ length: 1920 }, (_, i) => [0, 0, 255, 127, 0, 128, 42, 0][i % 8]),
    duration: 0.02,
  },
};

export async function makeMedia(codec = 'aac', { video = true, secondTrack = false } = {}) {
  const output = new Output({ format: new MkvOutputFormat(), target: new BufferTarget() });
  const fixture = fixtures[codec];
  const audio = fixture ? new EncodedAudioPacketSource(codec) : undefined;
  const second = secondTrack ? new EncodedAudioPacketSource('pcm-s16') : undefined;
  const visual = video ? new EncodedVideoPacketSource('vp8') : undefined;
  if (visual) output.addVideoTrack(visual);
  if (audio) output.addAudioTrack(audio);
  if (second) output.addAudioTrack(second);
  await output.start();
  if (visual) {
    await visual.add(
      new EncodedPacket(new Uint8Array([0x10, 0, 0, 0x9d, 1, 0x2a, 16, 0, 16, 0]), 'key', 0, 1),
      { decoderConfig: { codec: 'vp8', codedWidth: 16, codedHeight: 16 } },
    );
    visual.close();
  }
  if (audio) {
    for (let i = 0; i < 3; i++) {
      // oxlint-disable-next-line no-await-in-loop
      await audio.add(
        new EncodedPacket(fixture.data, 'key', i * fixture.duration, fixture.duration),
        {
          decoderConfig: fixture.config,
        },
      );
    }
    audio.close();
  }
  if (second) {
    const pcm = fixtures['pcm-s16'];
    await second.add(new EncodedPacket(pcm.data, 'key', 0, pcm.duration), {
      decoderConfig: pcm.config,
    });
    second.close();
  }
  await output.finalize();
  return new File([output.target.buffer], 'sample.mkv', { type: 'video/x-matroska' });
}
