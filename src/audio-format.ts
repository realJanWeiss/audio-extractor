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

export function resolveOutputFormat(codec: AudioCodec): AudioFormat {
  let format: OutputFormat;
  let extension: string;
  let mime: string;
  switch (codec) {
    case 'aac':
      format = new Mp4OutputFormat();
      extension = 'm4a';
      mime = 'audio/mp4';
      break;
    case 'mp3':
      format = new Mp3OutputFormat({ xingHeader: false });
      extension = 'mp3';
      mime = 'audio/mpeg';
      break;
    case 'opus':
    case 'vorbis':
      format = new OggOutputFormat();
      extension = codec === 'opus' ? 'opus' : 'ogg';
      mime = 'audio/ogg';
      break;
    case 'flac':
      format = new FlacOutputFormat();
      extension = 'flac';
      mime = 'audio/flac';
      break;
    default:
      format = new WavOutputFormat();
      extension = 'wav';
      mime = 'audio/wav';
      if (!format.getSupportedAudioCodecs().includes(codec)) {
        format = new MkvOutputFormat();
        extension = 'mka';
        mime = 'audio/x-matroska';
      }
  }
  if (!format.getSupportedAudioCodecs().includes(codec)) {
    throw new Error(`The ${codec} audio track cannot be extracted without reencoding.`);
  }
  return { format, extension, mime };
}

export function audioLabel(codec: string): string {
  const names: Record<string, string> = {
    aac: 'AAC',
    mp3: 'MP3',
    flac: 'FLAC',
    opus: 'Opus',
    vorbis: 'Vorbis',
    ac3: 'AC-3',
    eac3: 'E-AC-3',
    dts: 'DTS',
  };
  return names[codec] ?? (codec.startsWith('pcm-') ? 'PCM' : codec.toUpperCase());
}
