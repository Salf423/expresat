import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
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
            else if (ext === '.json') mimeType = 'application/json';
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
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    servePublicWasmAndModelsPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'ExpresaT — Traductor LSM',
        short_name: 'ExpresaT',
        description:
          'Traductor bidireccional de Lengua de Señas Mexicana (LSM) en tiempo real, 100% privado y sin conexión.',
        lang: 'es-MX',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#07090f',
        background_color: '#07090f',
        categories: ['accessibility', 'education', 'utilities'],
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Allow precaching local MediaPipe WASM runtimes (~12 MB), .task bundles (~7.5 MB),
        // and local ONNX neural models so ExpresaT operates 100% offline in Airplane Mode.
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,webp,wasm}',
          'wasm/*.{wasm,js}',
          'models/*.{task,onnx,json}',
        ],
        globIgnores: ['**/test_hand.png', '**/test_person.png'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],

  ...(mode !== 'production'
    ? {
        define: {
          'import.meta.env.VITE_DEV_GIT_COMMIT': JSON.stringify(resolveDevGitCommitShort()),
        },
      }
    : {}),

  // Ensure WASM files from @mediapipe/tasks-vision are served with the correct
  // Content-Type and are not mangled by the bundler.
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision', 'onnxruntime-web'],
  },
}));
