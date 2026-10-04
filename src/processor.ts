import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Output,
} from 'mediabunny';
import type { AudioCodec, InputAudioTrack } from 'mediabunny';
import { audioLabel, resolveOutputFormat } from './audio-format.ts';

async function withAudioTrack<T>(
  file: Blob,
  signal: AbortSignal,
  read: (track: InputAudioTrack | undefined, codec: AudioCodec | null) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [track] = await input.getAudioTracks();
    signal.throwIfAborted();
    const codec = track ? await track.getCodec() : null;
    signal.throwIfAborted();
    const result = await read(track, codec);
    signal.throwIfAborted();
    return result;
  } finally {
    input.dispose();
  }
}

export async function inspectAudio(file: Blob, signal: AbortSignal) {
  return withAudioTrack(file, signal, async (track, codec) => {
    if (!track) return { sourceAudio: 'no audio track' };
    return {
      sourceAudio: codec ? audioLabel(codec) : 'unsupported codec',
      duration: await track.computeDuration(),
    };
  });
}

export async function extract(
  file: Blob,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<{ data: ArrayBuffer; extension: string; mime: string }> {
  return withAudioTrack(file, signal, async (track, codec) => {
    if (!track) throw new Error('This video has no audio track.');
    if (!codec) throw new Error('This audio codec is not supported for extraction.');
    const { format, extension, mime } = resolveOutputFormat(codec);
    const decoderConfig = await track.getDecoderConfig();
    if (!decoderConfig) throw new Error('The audio track is missing its codec configuration.');
    const duration = await track.computeDuration();
    signal.throwIfAborted();
    const target = new BufferTarget();
    const output = new Output({ format, target });
    try {
      const source = new EncodedAudioPacketSource(codec);
      output.addAudioTrack(source);
      await output.start();

      let packets = 0;
      // Copy encoded packets directly. No decoders, encoders, or conversion fallback are used.
      for await (const packet of new EncodedPacketSink(track).packets()) {
        signal.throwIfAborted();
        await source.add(packet, { decoderConfig });
        packets++;
        if (Number.isFinite(duration) && duration > 0) {
          onProgress(Math.min(0.99, Math.max(0, (packet.timestamp + packet.duration) / duration)));
        }
        // Give the browser time to paint and handle cancellation during large extractions.
        if (packets % 256 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      signal.throwIfAborted();
      if (!packets) throw new Error('This audio track contains no audio data.');
      source.close();
      await output.finalize();
      const data = target.buffer;
      if (!data) throw new Error('The extracted audio file is empty.');
      return { data, extension, mime };
    } finally {
      if (output.state !== 'finalized' && output.state !== 'canceled') {
        await output.cancel();
      }
    }
  });
}
