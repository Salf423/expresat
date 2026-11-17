import { defineConfig, devices } from '@playwright/test';

const isPreview = process.env.EXPRESAT_PREVIEW === '1';
const port = isPreview ? 4173 : 5173;
const baseUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /(translator|dev_instrumentation|prod_dev_mode)\.spec\.js/,
  workers: 1,
  fullyParallel: false,
  timeout: 35000,
  webServer: {
    command: isPreview
      ? `node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`
      : `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseUrl,
    reuseExistingServer: !process.env.CI && !isPreview,
    timeout: 20000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: baseUrl,
        headless: true,
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
    },
  ],
});
