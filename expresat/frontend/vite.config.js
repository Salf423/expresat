import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function resolveDevGitCommitShort() {
  try {
    const hash = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return hash || 'nogit';
  } catch {
    return 'nogit';
  }
}

/**
 * Serves WASM (.wasm / .js) and MediaPipe model (.task) assets from public/
 * directly in Vite dev server with proper MIME types and without Vite module transform errors.
 */
function servePublicWasmAndModelsPlugin() {
  return {
    name: 'serve-public-wasm-and-models',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const cleanUrl = (req.url || '').split('?')[0];
        if (cleanUrl.startsWith('/wasm/') || cleanUrl.startsWith('/models/')) {
          const relativePath = cleanUrl.replace(/^\//, '');
          const filePath = path.resolve(process.cwd(), 'public', relativePath);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            let mimeType = 'application/octet-stream';
            if (ext === '.wasm') mimeType = 'application/wasm';
            else if (ext === '.js') mimeType = 'application/javascript';
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
export default defineConfig(() => ({
  plugins: [react(), servePublicWasmAndModelsPlugin()],

  define: {
    'import.meta.env.VITE_DEV_GIT_COMMIT': JSON.stringify(resolveDevGitCommitShort()),
  },

  // Ensure WASM files from @mediapipe/tasks-vision are served with the correct
  // Content-Type and are not mangled by the bundler.
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
}));
