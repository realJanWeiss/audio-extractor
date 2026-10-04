import {
  FlacOutputFormat,
  MkvOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  WavOutputFormat,
} from 'mediabunny';
import type { AudioCodec, OutputFormat } from 'mediabunny';

interface AudioFormat {
  format: OutputFormat;
  extension: string;
  mime: string;
}

const outputFormats: Partial<Record<AudioCodec, [() => OutputFormat, string, string]>> = {
  aac: [() => new Mp4OutputFormat(), 'm4a', 'audio/mp4'],
  mp3: [() => new Mp3OutputFormat({ xingHeader: false }), 'mp3', 'audio/mpeg'],
  opus: [() => new OggOutputFormat(), 'opus', 'audio/ogg'],
  vorbis: [() => new OggOutputFormat(), 'ogg', 'audio/ogg'],
  flac: [() => new FlacOutputFormat(), 'flac', 'audio/flac'],
};

export function resolveOutputFormat(codec: AudioCodec): AudioFormat {
  let definition = outputFormats[codec];
  if (!definition) {
    const wav = new WavOutputFormat();
    definition = wav.getSupportedAudioCodecs().includes(codec)
      ? [() => wav, 'wav', 'audio/wav']
      : [() => new MkvOutputFormat(), 'mka', 'audio/x-matroska'];
  }
  const [createFormat, extension, mime] = definition;
  const format = createFormat();
  if (!format.getSupportedAudioCodecs().includes(codec)) {
    throw new Error(`The ${codec} audio track cannot be extracted without reencoding.`);
  }
  return { format, extension, mime };
}

export function audioLabel(codec: string): string {
  const names: Record<string, string> = {
    opus: 'Opus',
    vorbis: 'Vorbis',
    ac3: 'AC-3',
    eac3: 'E-AC-3',
  };
  return names[codec] ?? (codec.startsWith('pcm-') ? 'PCM' : codec.toUpperCase());
}
