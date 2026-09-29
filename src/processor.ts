import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import coreURL from '@ffmpeg/core-mt?url'
import wasmURL from '@ffmpeg/core-mt/wasm?url'
import workerURL from '@ffmpeg/core-mt/worker?url'
import type { Job } from './types.ts'
import { extension, formatLabel } from './types.ts'

interface AudioOutput {
  data: Uint8Array<ArrayBuffer>
  extension: string
  mime: string
}

const originalContainers: Record<string, { extension: string; mime: string }> = {
  aac: { extension: 'm4a', mime: 'audio/mp4' },
  alac: { extension: 'm4a', mime: 'audio/mp4' },
  mp3: { extension: 'mp3', mime: 'audio/mpeg' },
  flac: { extension: 'flac', mime: 'audio/flac' },
  opus: { extension: 'opus', mime: 'audio/ogg' },
  vorbis: { extension: 'ogg', mime: 'audio/ogg' },
  ac3: { extension: 'ac3', mime: 'audio/ac3' },
  eac3: { extension: 'eac3', mime: 'audio/eac3' },
}
const matroskaAudio = { extension: 'mka', mime: 'audio/x-matroska' }

const urls = import.meta.env.DEV
  ? {
      coreURL: '/__ffmpeg-core/ffmpeg-core.js',
      wasmURL: '/__ffmpeg-core/ffmpeg-core.wasm',
      workerURL: '/__ffmpeg-core/ffmpeg-core.worker.js',
    }
  : { coreURL, wasmURL, workerURL }

let ffmpeg: FFmpeg | undefined
let loading: Promise<void> | undefined
let currentId = 0

export function isLoaded(): boolean {
  return !!ffmpeg?.loaded
}

export function loadEngine(): Promise<void> {
  if (ffmpeg?.loaded) return Promise.resolve()
  if (!loading) {
    ffmpeg = new FFmpeg()
    const instance = ffmpeg
    let timeout: number
    const deadline = new Promise<never>((_, reject) => {
      timeout = window.setTimeout(() => {
        reject(new Error('FFmpeg took too long to load. Check browser support and the isolation headers.'))
      }, 90_000)
    })
    loading = Promise.race([instance.load(urls), deadline])
      .then(() => undefined)
      .catch((error: unknown) => {
        instance.terminate()
        if (ffmpeg === instance) ffmpeg = undefined
        throw error
      })
      .finally(() => {
        clearTimeout(timeout)
        loading = undefined
      })
  }
  return loading
}

export function cancelCurrent() {
  currentId++
  ffmpeg?.terminate()
  ffmpeg = undefined
  loading = undefined
}

export async function listCapabilities(): Promise<string> {
  const instance = ffmpeg
  if (!instance || !instance.loaded) throw new Error('The engine is not ready.')
  async function describe(readyInstance: FFmpeg, option: string): Promise<string> {
    const lines: string[] = []
    const onLog = ({ message }: { message: string }) => { lines.push(message) }
    readyInstance.on('log', onLog)
    try {
      await readyInstance.exec(['-hide_banner', option])
    } finally {
      readyInstance.off('log', onLog)
    }
    return lines.join('\n') || 'No capabilities were reported.'
  }
  const encoders = (await describe(instance, '-encoders'))
    .split('\n')
    .filter((line) => /^\s*A[.A-Z]{5}\s+[^=]/.test(line))
    .join('\n')
  const muxers = await describe(instance, '-muxers')
  return `Audio encoders:\n${encoders || 'No audio encoders were reported.'}\n\nFFmpeg muxers (includes containers that do not accept audio):\n${muxers}`
}

export async function probeAudioCodec(job: Job): Promise<string | undefined> {
  const instance = ffmpeg
  if (!instance?.loaded) return undefined
  const input = `inspect-${job.id}`
  const result = `inspect-${job.id}.txt`
  const logs: string[] = []
  const onLog = ({ message }: { message: string }) => { logs.push(message) }
  instance.on('log', onLog)
  try {
    await instance.writeFile(input, await fetchFile(job.file))
    const code = await instance.ffprobe([
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      '-i', input,
      '-o', result,
    ])
    const output = await instance.readFile(result, 'utf8').catch(() => '')
    const codec = output.toString().trim() || logs.join('\n').match(/\bAudio:\s*([^\s,(]+)/)?.[1]
    if (!codec) {
      if (code !== 0 && !logs.some((line) => line.includes('Stream #'))) {
        throw new Error(`ffprobe exited with ${code}: ${logs.slice(-4).join(' | ')}`)
      }
      return 'no audio track'
    }
    job.sourceCodec = codec
    const names: Record<string, string> = {
      aac: 'AAC', mp3: 'MP3', flac: 'FLAC', opus: 'Opus',
      vorbis: 'Vorbis', ac3: 'AC-3', eac3: 'E-AC-3',
      alac: 'ALAC', pcm_s16le: 'PCM', pcm_s24le: 'PCM',
    }
    return names[codec] ?? codec.toUpperCase()
  } finally {
    instance.off('log', onLog)
    await Promise.allSettled([input, result].map((path) => instance.deleteFile(path)))
  }
}

async function readAudioCodec(instance: FFmpeg, input: string, probe: string): Promise<string | undefined> {
  try {
    const code = await instance.ffprobe([
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      input,
      '-o', probe,
    ])
    if (code !== 0) return undefined
    return (await instance.readFile(probe, 'utf8')).toString().trim() || undefined
  } catch {
    return undefined
  }
}

function audioCodec(job: Job, copyAac: boolean): string[] {
  const { format, bitrateKbps, sampleRate, channels, customCodec, customMuxer, extraArgs } = job.settings
  let args: string[]
  switch (format) {
    case 'original': return ['-c:a', 'copy']
    case 'mp3': args = ['-c:a', 'libmp3lame', ...(bitrateKbps ? [] : ['-q:a', '2'])]; break
    case 'm4a': args = copyAac ? ['-c:a', 'copy'] : ['-c:a', 'aac', ...(bitrateKbps ? [] : ['-b:a', '192k'])]; break
    case 'wav': args = ['-c:a', 'pcm_s16le']; break
    case 'flac': args = ['-c:a', 'flac']; break
    case 'ogg': args = ['-c:a', 'libvorbis', ...(bitrateKbps ? [] : ['-q:a', '5'])]; break
    case 'opus': args = ['-c:a', 'libopus', ...(bitrateKbps ? [] : ['-b:a', '128k'])]; break
    case 'alac': args = ['-c:a', 'alac']; break
    case 'aiff': args = ['-c:a', 'pcm_s16be']; break
    case 'ac3': args = ['-c:a', 'ac3', ...(bitrateKbps ? [] : ['-b:a', '192k'])]; break
    case 'wma': args = ['-c:a', 'wmav2', ...(bitrateKbps ? [] : ['-b:a', '192k'])]; break
    case 'custom': args = ['-c:a', customCodec!, '-f', customMuxer!]; break
  }
  if (bitrateKbps) args.push('-b:a', `${bitrateKbps}k`)
  if (sampleRate) args.push('-ar', String(sampleRate))
  if (channels) args.push('-ac', String(channels))
  return [...args, ...extraArgs]
}

export async function extract(job: Job, onProgress: (progress: number) => void): Promise<AudioOutput> {
  const instance = ffmpeg
  if (!instance?.loaded) throw new Error('The engine is not ready.')
  const token = ++currentId
  const input = `input-${job.id}`
  const probe = `probe-${job.id}.txt`
  const outputs: string[] = []
  const progress = ({ progress: value }: { progress: number }) => {
    if (token !== currentId || !Number.isFinite(value)) return
    onProgress(Math.min(0.99, Math.max(0, value)))
  }
  instance.on('progress', progress)
  try {
    await instance.writeFile(input, await fetchFile(job.file))
    const { format, bitrateKbps, sampleRate, channels, customExtension, extraArgs } = job.settings
    const codec = job.sourceCodec ?? (format === 'original' || format === 'm4a'
      ? await readAudioCodec(instance, input, probe)
      : undefined)
    const copyAac = format === 'm4a' && codec === 'aac' && !bitrateKbps && !sampleRate && !channels && extraArgs.length === 0
    let outputFormat = format === 'original'
      ? originalContainers[codec ?? ''] ?? matroskaAudio
      : { extension: format === 'custom' ? customExtension! : extension[format], mime: formatLabel[format].mime }
    let output = `output-${job.id}.${outputFormat.extension}`
    outputs.push(output)
    let code = await instance.exec(['-i', input, '-map', '0:a:0', '-vn', ...audioCodec(job, copyAac), output])
    if (code !== 0 && format === 'original' && outputFormat.extension !== 'mka') {
      await instance.deleteFile(output).catch(() => undefined)
      onProgress(0)
      outputFormat = matroskaAudio
      output = `output-${job.id}.mka`
      outputs.push(output)
      code = await instance.exec(['-i', input, '-map', '0:a:0', '-vn', '-c:a', 'copy', output])
    }
    if (code !== 0 && copyAac) {
      await instance.deleteFile(output).catch(() => undefined)
      onProgress(0)
      code = await instance.exec(['-i', input, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', output])
    }
    if (code !== 0) {
      throw new Error(format === 'custom'
        ? 'FFmpeg could not produce this encoder and container combination. Check the names and additional arguments.'
        : 'Extraction failed. Check that the video contains a supported audio track and that the selected settings are compatible.')
    }
    const data = await instance.readFile(output)
    if (typeof data === 'string') throw new Error('Unexpected FFmpeg output.')
    return { data: new Uint8Array(data), ...outputFormat }
  } finally {
    instance.off('progress', progress)
    await Promise.allSettled([input, probe, ...outputs].map((path) => instance.deleteFile(path)))
  }
}
