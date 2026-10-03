import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { EngineController } from './engine-controller.ts';
export { EngineCancelledError } from './engine-controller.ts';
import coreURL from '@ffmpeg/core-mt?url';
import wasmURL from '@ffmpeg/core-mt/wasm?url';
import workerURL from '@ffmpeg/core-mt/worker?url';
import type { Job } from './types.ts';
import { audioCodec, canCopyAac, matroskaAudio, resolveOutputFormat } from './audio-format.ts';

interface AudioOutput {
  data: Uint8Array<ArrayBuffer>;
  extension: string;
  mime: string;
}

const urls = import.meta.env.DEV
  ? {
      coreURL: '/__ffmpeg-core/ffmpeg-core.js',
      wasmURL: '/__ffmpeg-core/ffmpeg-core.wasm',
      workerURL: '/__ffmpeg-core/ffmpeg-core.worker.js',
    }
  : { coreURL, wasmURL, workerURL };

const controller = new EngineController(
  () => new FFmpeg(),
  (instance) => instance.load(urls),
);

export function isLoaded(): boolean {
  return controller.isLoaded();
}

export async function loadEngine(): Promise<void> {
  await controller.load();
}

export function cancelCurrent(): void {
  controller.cancel();
}

async function describeCapabilities(readyInstance: FFmpeg, option: string): Promise<string> {
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    lines.push(message);
  };
  readyInstance.on('log', onLog);
  try {
    await readyInstance.exec(['-hide_banner', option]);
  } finally {
    readyInstance.off('log', onLog);
  }
  return lines.join('\n') || 'No capabilities were reported.';
}

export function listCapabilities(): Promise<string> {
  return controller.run(async (instance) => {
    const encoders = (await describeCapabilities(instance, '-encoders'))
      .split('\n')
      .filter((line) => /^\s*A[.A-Z]{5}\s+[^=]/.test(line))
      .join('\n');
    const muxers = await describeCapabilities(instance, '-muxers');
    return `Audio encoders:\n${encoders || 'No audio encoders were reported.'}\n\nFFmpeg muxers (includes containers that do not accept audio):\n${muxers}`;
  });
}

export function probeAudioCodec(
  job: Job,
  shouldInspect: () => boolean = () => true,
): Promise<string | undefined> {
  return controller.run(async (instance, signal) => {
    if (!shouldInspect()) return undefined;
    const input = `inspect-${job.id}`;
    const result = `inspect-${job.id}.txt`;
    const logs: string[] = [];
    const onLog = ({ message }: { message: string }) => {
      logs.push(message);
    };
    instance.on('log', onLog);
    try {
      await instance.writeFile(input, await fetchFile(job.file));
      const code = await instance.ffprobe([
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        '-i',
        input,
        '-o',
        result,
      ]);
      const output = await instance.readFile(result, 'utf8').catch(() => '');
      signal.throwIfAborted();
      const codec = output.toString().trim() || logs.join('\n').match(/\bAudio:\s*([^\s,(]+)/)?.[1];
      if (!codec) {
        if (code !== 0 && !logs.some((line) => line.includes('Stream #'))) {
          throw new Error(`ffprobe exited with ${code}: ${logs.slice(-4).join(' | ')}`);
        }
        return 'no audio track';
      }
      job.sourceCodec = codec;
      const names: Record<string, string> = {
        aac: 'AAC',
        mp3: 'MP3',
        flac: 'FLAC',
        opus: 'Opus',
        vorbis: 'Vorbis',
        ac3: 'AC-3',
        eac3: 'E-AC-3',
        alac: 'ALAC',
        pcm_s16le: 'PCM',
        pcm_s24le: 'PCM',
      };
      return names[codec] ?? codec.toUpperCase();
    } finally {
      instance.off('log', onLog);
      if (!signal.aborted) {
        await Promise.allSettled([input, result].map((path) => instance.deleteFile(path)));
      }
    }
  });
}

async function readAudioCodec(
  instance: FFmpeg,
  input: string,
  probe: string,
): Promise<string | undefined> {
  try {
    const code = await instance.ffprobe([
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      input,
      '-o',
      probe,
    ]);
    if (code !== 0) return undefined;
    return (await instance.readFile(probe, 'utf8')).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

export function extract(
  job: Job,
  onProgress: (progress: number) => void,
  start: () => boolean = () => true,
): Promise<AudioOutput | undefined> {
  return controller.run(async (instance, signal) => {
    if (!start()) return undefined;
    const input = `input-${job.id}`;
    const probe = `probe-${job.id}.txt`;
    const outputs: string[] = [];
    const progress = ({ progress: value }: { progress: number }) => {
      if (signal.aborted || !Number.isFinite(value)) return;
      onProgress(Math.min(0.99, Math.max(0, value)));
    };
    instance.on('progress', progress);
    try {
      await instance.writeFile(input, await fetchFile(job.file));
      const { format } = job.settings;
      const codec =
        job.sourceCodec ??
        (format === 'original' || format === 'm4a'
          ? await readAudioCodec(instance, input, probe)
          : undefined);
      signal.throwIfAborted();
      const copyAac = canCopyAac(job.settings, codec);
      let outputFormat = resolveOutputFormat(job.settings, codec);
      let output = `output-${job.id}.${outputFormat.extension}`;
      outputs.push(output);
      let code = await instance.exec([
        '-i',
        input,
        '-map',
        '0:a:0',
        '-vn',
        ...audioCodec(job.settings, copyAac),
        output,
      ]);
      signal.throwIfAborted();
      if (code !== 0 && format === 'original' && outputFormat.extension !== 'mka') {
        await instance.deleteFile(output).catch(() => undefined);
        signal.throwIfAborted();
        onProgress(0);
        outputFormat = matroskaAudio;
        output = `output-${job.id}.mka`;
        outputs.push(output);
        code = await instance.exec(['-i', input, '-map', '0:a:0', '-vn', '-c:a', 'copy', output]);
      }
      if (code !== 0 && copyAac) {
        await instance.deleteFile(output).catch(() => undefined);
        signal.throwIfAborted();
        onProgress(0);
        code = await instance.exec([
          '-i',
          input,
          '-map',
          '0:a:0',
          '-vn',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          output,
        ]);
      }
      if (code !== 0) {
        throw new Error(
          format === 'custom'
            ? 'FFmpeg could not produce this encoder and container combination. Check the names and additional arguments.'
            : 'Extraction failed. Check that the video contains a supported audio track and that the selected settings are compatible.',
        );
      }
      const data = await instance.readFile(output);
      if (typeof data === 'string') throw new Error('Unexpected FFmpeg output.');
      return { data: new Uint8Array(data), ...outputFormat };
    } finally {
      instance.off('progress', progress);
      if (!signal.aborted) {
        await Promise.allSettled(
          [input, probe, ...outputs].map((path) => instance.deleteFile(path)),
        );
      }
    }
  });
}
