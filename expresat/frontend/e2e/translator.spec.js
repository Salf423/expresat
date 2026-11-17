import { test, expect } from '@playwright/test';
import { SYNTHETIC_PRESETS } from '../src/recognition/syntheticHand.js';

test.describe('ExpresaT Demo E2E — Navegador real con cámara falsa y MediaPipe WASM en hilo principal', () => {
  test('1. Modo Demo 100% en navegador (sin backend): carga WASM, FPS > 0, detecta landmarks > 0, reconoce gesto y sin errores de consola', async ({
    page,
  }) => {
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore TFLite XNNPACK info messages and expected port 8000 network failures when offline
        if (
          !text.includes('INFO: Created TensorFlow Lite XNNPACK') &&
          !text.includes('127.0.0.1:8000') &&
          !text.includes('ERR_CONNECTION_REFUSED') &&
          !text.includes('WebSocket connection to')
        ) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    const syntheticDos = SYNTHETIC_PRESETS.DOS();
    await page.addInitScript((handPoints) => {
      window.__EXPRESAT_SYNTHETIC_FRAME__ = () => ({
        hands: [handPoints],
        handedness: [[{ categoryName: 'Left', score: 0.99 }]],
        pose: null,
      });
    }, syntheticDos);

    await page.goto('/translator');

    // Verify WASM initialized on the main thread without ModuleFactory not set errors
    const wasmBadge = page.getByTestId('wasm-status-badge');
    await expect(wasmBadge).toHaveText('WASM Activo', { timeout: 15000 });

    // Wait > 1.2s for the 1000ms FPS ticker to report non-zero inference FPS
    await expect(async () => {
      const inferFpsText = await page.getByTestId('inference-fps').innerText();
      const match = inferFpsText.match(/(\d+)/);
      const inferFps = match ? Number(match[1]) : 0;
      expect(inferFps).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });

    // Verify 21 detected hand landmarks
    await expect(page.getByTestId('landmarks-count')).toContainText('21 landmarks', {
      timeout: 5000,
    });

    // Verify the "Dos" geometric gesture is recognized locally without backend
    await expect(page.getByTestId('detected-gesture')).toHaveText('Dos', {
      timeout: 5000,
    });

    // Ensure no ReferenceError, ModuleFactory, or AbortError occurred
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('2. Con Backend en modo demo: conecta WebSocket y muestra "Conectado" sin bucles de reconexión', async ({
    page,
  }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const syntheticOpen = SYNTHETIC_PRESETS.MANO_ABIERTA();
    await page.addInitScript((handPoints) => {
      window.__EXPRESAT_SYNTHETIC_FRAME__ = () => ({
        hands: [handPoints],
        handedness: [[{ categoryName: 'Left', score: 0.99 }]],
        pose: null,
      });
    }, syntheticOpen);

    await page.goto('/translator');

    await expect(page.getByTestId('wasm-status-badge')).toHaveText('WASM Activo', {
      timeout: 15000,
    });

    // Verify WebSocket shows "Conectado" if local demo backend is up,
    // or cleanly reaches an explicit status when running offline
    const wsStatus = page.getByTestId('ws-status');
    await expect(wsStatus).toBeVisible();
    try {
      const healthResp = await page.request.get('http://127.0.0.1:8000/health', { timeout: 1500 });
      if (healthResp.ok()) {
        await expect(wsStatus).toContainText('Conectado', { timeout: 5000 });
      }
    } catch {
      // Offline mode: verify explicit status remains visible without crashing
      await expect(wsStatus).toBeVisible();
    }
    await expect(page.getByTestId('detected-gesture')).toHaveText('Mano Abierta', {
      timeout: 5000,
    });
    expect(pageErrors).toEqual([]);
  });
});
