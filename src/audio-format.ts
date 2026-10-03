import type { OutputSettings } from './types.ts';
import { extension, formatLabel } from './types.ts';

const originalContainers: Record<string, { extension: string; mime: string }> = {
  aac: { extension: 'm4a', mime: 'audio/mp4' },
  alac: { extension: 'm4a', mime: 'audio/mp4' },
  mp3: { extension: 'mp3', mime: 'audio/mpeg' },
  flac: { extension: 'flac', mime: 'audio/flac' },
  opus: { extension: 'opus', mime: 'audio/ogg' },
  vorbis: { extension: 'ogg', mime: 'audio/ogg' },
  ac3: { extension: 'ac3', mime: 'audio/ac3' },
  eac3: { extension: 'eac3', mime: 'audio/eac3' },
};
export const matroskaAudio = { extension: 'mka', mime: 'audio/x-matroska' };

export function canCopyAac(settings: OutputSettings, codec?: string): boolean {
  const { format, bitrateKbps, sampleRate, channels, extraArgs } = settings;
  return (
    format === 'm4a' &&
    codec === 'aac' &&
    !bitrateKbps &&
    !sampleRate &&
    !channels &&
    extraArgs.length === 0
  );
}

export function resolveOutputFormat(
  settings: OutputSettings,
  codec?: string,
): { extension: string; mime: string } {
  const { format, customExtension } = settings;
  return format === 'original'
    ? (originalContainers[codec ?? ''] ?? matroskaAudio)
    : {
        extension: format === 'custom' ? customExtension! : extension[format],
        mime: formatLabel[format].mime,
      };
}

export function audioCodec(settings: OutputSettings, copyAac: boolean): string[] {
  const { format, bitrateKbps, sampleRate, channels, customCodec, customMuxer, extraArgs } =
    settings;
  let args: string[];
  switch (format) {
    case 'original':
      return ['-c:a', 'copy'];
    case 'mp3':
      args = ['-c:a', 'libmp3lame', ...(bitrateKbps ? [] : ['-q:a', '2'])];
      break;
    case 'm4a':
      args = copyAac ? ['-c:a', 'copy'] : ['-c:a', 'aac', ...(bitrateKbps ? [] : ['-b:a', '192k'])];
      break;
    case 'wav':
      args = ['-c:a', 'pcm_s16le'];
      break;
    case 'flac':
      args = ['-c:a', 'flac'];
      break;
    case 'ogg':
      args = ['-c:a', 'libvorbis', ...(bitrateKbps ? [] : ['-q:a', '5'])];
      break;
    case 'opus':
      args = ['-c:a', 'libopus', ...(bitrateKbps ? [] : ['-b:a', '128k'])];
      break;
    case 'alac':
      args = ['-c:a', 'alac'];
      break;
    case 'aiff':
      args = ['-c:a', 'pcm_s16be'];
      break;
    case 'ac3':
      args = ['-c:a', 'ac3', ...(bitrateKbps ? [] : ['-b:a', '192k'])];
      break;
    case 'wma':
      args = ['-c:a', 'wmav2', ...(bitrateKbps ? [] : ['-b:a', '192k'])];
      break;
    case 'custom':
      args = ['-c:a', customCodec!, '-f', customMuxer!];
      break;
  }
  if (bitrateKbps) args.push('-b:a', `${bitrateKbps}k`);
  if (sampleRate) args.push('-ar', String(sampleRate));
  if (channels) args.push('-ac', String(channels));
  return [...args, ...extraArgs];
}

export function settingsError(settings: OutputSettings): string | undefined {
  if (settings.format !== 'custom') return undefined;
  if (!/^[a-zA-Z0-9_]+$/.test(settings.customCodec ?? ''))
    return 'Enter a valid FFmpeg audio encoder in Advanced settings.';
  if (!/^[a-zA-Z0-9_]+$/.test(settings.customMuxer ?? ''))
    return 'Enter a valid FFmpeg muxer in Advanced settings.';
  if (!/^[a-zA-Z0-9]+$/.test(settings.customExtension ?? ''))
    return 'Enter a valid file extension in Advanced settings.';
  return undefined;
}
