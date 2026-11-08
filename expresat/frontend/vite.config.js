import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Serves WASM and JS assets from public/wasm directly in Vite dev server,
 * preventing Vite from failing dynamic import('/wasm/vision_wasm_internal.js') with:
 * "This file is in /public and will be copied as-is during build...".
 */
function servePublicWasmPlugin() {
  return {
    name: 'serve-public-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const cleanUrl = (req.url || '').split('?')[0];
        if (cleanUrl.startsWith('/wasm/')) {
          const relativePath = cleanUrl.replace(/^\/wasm\//, '');
          const filePath = path.resolve(process.cwd(), 'public/wasm', relativePath);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const mimeType = ext === '.wasm' ? 'application/wasm' : 'application/javascript';
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Cache-Control', 'no-cache');
            return fs.createReadStream(filePath).pipe(res);
          }
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), servePublicWasmPlugin()],

  // Ensure WASM files from @mediapipe/tasks-vision are served with the correct
  // Content-Type and are not mangled by the bundler.
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },

  // Allows module workers (new Worker(..., { type: 'module' })) to use
  // top-level imports (e.g. import { HandLandmarker } from '@mediapipe/tasks-vision')
  worker: {
    format: 'es',
  },
})
