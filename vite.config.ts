import { defineConfig } from 'vite'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const coreDir = join(dirname(createRequire(import.meta.url).resolve('@ffmpeg/core-mt')), '../esm')
const coreFiles: Record<string, string> = {
  '/__ffmpeg-core/ffmpeg-core.js': 'ffmpeg-core.js',
  '/__ffmpeg-core/ffmpeg-core.wasm': 'ffmpeg-core.wasm',
  '/__ffmpeg-core/ffmpeg-core.worker.js': 'ffmpeg-core.worker.js',
}
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

const rawCoreInDev = () => ({
  name: 'raw-ffmpeg-core-in-dev',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use((request, response, next) => {
      const file = coreFiles[request.url?.split('?')[0] ?? '']
      if (!file) return next()
      for (const [name, value] of Object.entries(isolationHeaders)) response.setHeader(name, value)
      response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
      response.setHeader('Cache-Control', 'no-cache')
      response.end(readFileSync(join(coreDir, file)))
    })
  },
})

// Cloudflare Pages applies the same isolation headers from public/_headers.
export default defineConfig({
  plugins: [rawCoreInDev()],
  build: { assetsInlineLimit: 0 },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
})
