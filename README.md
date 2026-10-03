# Audio Extractor

A small, browser-only batch video-to-audio extractor. Files remain on your device.

## Run locally

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite. `pnpm build` produces the static site in `dist/`; `pnpm preview` serves that build locally.

## Cloudflare Pages

Connect this repository to Pages. Use `pnpm install --frozen-lockfile` as the install command, `pnpm build` as the build command, and `dist` as the output directory.

Hosting requires HTTPS (or localhost) and COOP/COEP response headers. Local dev and preview configure these headers; Cloudflare Pages uses `public/_headers`. Preserve them when deploying elsewhere.

## Usage

Add videos, choose an output format, and start extraction. Choose Original to preserve the audio without reencoding. Advanced settings provide encoding options and custom formats.

Changing settings stops extraction and discards existing outputs. Large files can exhaust browser memory. Downloading all results may require allowing multiple downloads in your browser.
