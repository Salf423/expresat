import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

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
