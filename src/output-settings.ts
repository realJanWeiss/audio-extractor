import type { OutputFormat, OutputSettings } from './types.ts';
import { isOutputFormat } from './types.ts';
import type { ui } from './ui.ts';

type SettingsControls = Pick<
  typeof ui,
  | 'format'
  | 'bitrate'
  | 'sampleRate'
  | 'channels'
  | 'customCodec'
  | 'customMuxer'
  | 'customExtension'
  | 'extraArgs'
  | 'customFields'
  | 'advanced'
>;

const lossyFormats = new Set<OutputFormat>(['mp3', 'm4a', 'ogg', 'opus', 'ac3', 'wma', 'custom']);

export function readFormat(ui: SettingsControls): OutputFormat {
  const value = ui.format.value;
  if (!isOutputFormat(value)) throw new Error(`Unsupported output format: ${value}`);
  return value;
}

export function readSettings(ui: SettingsControls): OutputSettings {
  const format = readFormat(ui);
  const adjustable = format !== 'original';
  return {
    format,
    bitrateKbps:
      adjustable && lossyFormats.has(format) && ui.bitrate.value
        ? Number(ui.bitrate.value)
        : undefined,
    sampleRate: adjustable && ui.sampleRate.value ? Number(ui.sampleRate.value) : undefined,
    channels: adjustable && ui.channels.value ? Number(ui.channels.value) : undefined,
    customCodec: format === 'custom' ? ui.customCodec.value.trim() : undefined,
    customMuxer: format === 'custom' ? ui.customMuxer.value.trim() : undefined,
    customExtension:
      format === 'custom' ? ui.customExtension.value.trim().replace(/^\./, '') : undefined,
    extraArgs: adjustable
      ? ui.extraArgs.value
          .split(/\r?\n/)
          .map((arg) => arg.trim())
          .filter(Boolean)
      : [],
  };
}

export function updateSettingsControls(ui: SettingsControls): void {
  const format = readFormat(ui);
  const original = format === 'original';
  ui.bitrate.disabled = !lossyFormats.has(format);
  ui.sampleRate.disabled = original;
  ui.channels.disabled = original;
  ui.extraArgs.disabled = original;
  ui.customFields.hidden = format !== 'custom';
  if (format === 'custom') ui.advanced.open = true;
}
