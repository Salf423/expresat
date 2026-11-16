import { test, expect } from '@playwright/test';

function attachOfflineErrorListeners(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (!url.startsWith('http://127.0.0.1:8000') && !url.startsWith('ws://127.0.0.1:8000')) {
      failedRequests.push(`${req.method()} ${url} -> ${req.failure()?.errorText || 'failed'}`);
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
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
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return { consoleErrors, pageErrors, failedRequests };
}

test.describe('Instrumentación Dev — Reposo vs Grabando, rVFC, getSettings y experimento exact15', () => {
  test('expone indicador de cámara real separado, marcas performance.mark y comparación Reposo vs Grabando', async ({
    page,
  }) => {
    // Headless Chromium sin GPU física compila shaders SwiftShader (~12s frío + ~1.4s/frame)
    test.setTimeout(120000);
    const { consoleErrors, pageErrors, failedRequests } = attachOfflineErrorListeners(page);

    await page.goto('/translator');

    await expect(page.getByTestId('wasm-status-badge')).toHaveText('WASM Activo', {
      timeout: 20000,
    });

    await expect(page.getByTestId('real-camera-fps')).toBeVisible();
    await expect(page.getByTestId('dev-instrumentation-panel')).toBeVisible();

    // Esperar ~1.5s en reposo para acumular métricas y ticker 1 Hz
    await expect(async () => {
      const snap = await page.evaluate(() => window.__EXPRESAT_DEV_TELEMETRY__?.getSnapshot());
      expect(snap).toBeTruthy();
      expect(snap.phases.reposo.counts.totalInferences).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });

    // Botón manual de refresco presente y funcional incluso antes/después de grabar
    await expect(page.getByTestId('dev-refresh-report-btn')).toBeVisible();

    // Iniciar grabación ~1.2s y detener para poblar fase grabando
    await page.getByTestId('dev-record-start-btn').click();
    await expect(async () => {
      const snap = await page.evaluate(() => window.__EXPRESAT_DEV_TELEMETRY__?.getSnapshot());
      expect(snap.phase).toBe('grabando');
      expect(snap.phases.grabando.counts.totalInferences).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });
    await page.getByTestId('dev-record-stop-btn').click();
    await page.getByTestId('dev-refresh-report-btn').click();

    const report = await page.evaluate(() => window.__EXPRESAT_DEV_TELEMETRY__?.getReport());
    expect(report).toBeTruthy();
    expect(report.cameraNegotiation.experimentMode).toBe('default');
    expect(report.cameraNegotiation.settings).toBeTruthy();
    expect(report.cameraNegotiation.videoWidth).toBeGreaterThan(0);

    expect(report.phases.reposo.counts.totalInferences).toBeGreaterThan(0);
    expect(report.phases.reposo.stages.handMs.count).toBeGreaterThan(0);
    expect(report.phases.reposo.stages.dibujoMs.count).toBeGreaterThan(0);
    expect(report.phases.reposo.stages.uiCommitMs.count).toBeGreaterThan(0);

    expect(report.phases.grabando.counts.totalInferences).toBeGreaterThan(0);
    expect(report.phases.grabando.stages.handMs.count).toBeGreaterThan(0);
    expect(report.phases.grabando.stages.totalFrameMs.p95).toBeGreaterThanOrEqual(
      report.phases.grabando.stages.totalFrameMs.p50
    );

    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('experimento ?camExp=exact15 solicita width/height exact y frameRate min 15 sin fallback silencioso', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors, failedRequests } = attachOfflineErrorListeners(page);

    await page.goto('/translator?camExp=exact15');

    await expect(async () => {
      const snap = await page.evaluate(() => window.__EXPRESAT_DEV_TELEMETRY__?.getSnapshot());
      expect(snap?.cameraNegotiation?.experimentMode).toBe('exact15');
      expect(snap?.cameraNegotiation?.requestedConstraints?.video?.width?.exact).toBe(640);
      expect(snap?.cameraNegotiation?.requestedConstraints?.video?.height?.exact).toBe(480);
      expect(snap?.cameraNegotiation?.requestedConstraints?.video?.frameRate?.min).toBe(15);
      expect(snap?.cameraNegotiation?.usedFallback).toBe(false);
    }).toPass({ timeout: 15000 });

    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
