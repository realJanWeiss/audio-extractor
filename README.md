# Audio Extractor

A small, browser-only batch video-to-audio extractor. Files remain on your device.

## Run locally

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite. `pnpm build` produces the static site in `dist/`; `pnpm preview` serves that build locally.

## Cloudflare Pages

Connect this repository to Pages. Use `pnpm install --frozen-lockfile` as the install command, `pnpm build` as the build command, and `dist` as the output directory. `public/_headers` is copied into the output automatically.

The multithreaded FFmpeg core uses `SharedArrayBuffer`, which browsers expose only in a cross-origin-isolated page. COOP and COEP response headers are therefore required on the document. Vite dev and preview send these headers, and the Pages `_headers` file sends them in production. Open the site over HTTPS (or localhost).

The app imports `@ffmpeg/core-mt`, its Wasm, and its worker through Vite's `?url` asset handling. Vite emits fingerprinted files directly into `dist/assets`; no core files are copied into `public`. A tiny Vite dev middleware serves the package files raw because Vite's usual JavaScript transform interferes with FFmpeg's worker loader. The app code that imports FFmpeg is itself dynamically imported when extraction begins. Fingerprinted assets use immutable caching, while HTML revalidates so deployments pick up new asset URLs.

Jobs run sequentially through one FFmpeg instance. The Original option copies the first audio stream without reencoding it, choosing a compatible audio container (MKA for codecs without a dedicated option). AAC audio is remuxed into M4A when possible if no encoding settings are requested. Presets cover MP3, AAC/M4A, WAV, FLAC, Ogg Vorbis, Opus, ALAC, AIFF, AC-3, and WMA. Advanced settings offer bitrate for lossy formats, sample rate, channels, and additional FFmpeg arguments. The custom format option accepts an audio encoder, muxer, and file extension for other combinations supported by the bundled FFmpeg build. The available encoder and muxer list can be viewed from Advanced settings; muxers listed by FFmpeg include some that cannot contain audio. Additional arguments are entered one argument per line and are passed directly to FFmpeg before the output filename. Changing any setting stops active extraction, discards existing outputs, and queues the videos again. Individual results can be downloaded, or the completed files can be downloaded together as separate browser downloads (your browser may ask to allow multiple downloads). Large inputs and outputs occupy browser memory.
