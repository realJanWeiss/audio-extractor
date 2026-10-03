# Audio Extractor

A small, browser-only batch video-to-audio extractor powered by Mediabunny. Files remain on your device. Extraction copies the first audio track's encoded packets unchanged. It never decodes or reencodes audio.

## Run locally

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite. `pnpm build` produces the static site in `dist/`; `pnpm preview` serves that build locally.

## Usage

Add videos and start extraction. The first audio track is copied into a compatible audio-only container chosen automatically: AAC → M4A, MP3 → MP3, Opus → Opus/Ogg, Vorbis → Ogg, FLAC → FLAC, supported PCM → WAV, and other supported codecs → Matroska audio (MKA). The container and metadata may change; the encoded audio stays unchanged.
