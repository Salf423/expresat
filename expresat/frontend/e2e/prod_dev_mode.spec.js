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

test.describe('Modo Desarrollador en Producción — Botón Toggle, Persistencia y Grabación de Calibración', () => {
  test('inicia desactivado en modo producción, se activa al pulsar Modo Dev, graba calibración y se desactiva limpiamente', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const { consoleErrors, pageErrors, failedRequests } = attachOfflineErrorListeners(page);
    const isPreviewProd = process.env.EXPRESAT_PREVIEW === '1';

    await page.goto(isPreviewProd ? '/translator' : '/translator?dev=0');

    const toggleBtn = page.getByTestId('dev-mode-toggle');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('wasm-status-badge')).toHaveText('WASM Activo', {
      timeout: 20000,
    });

    // Con Modo Dev apagado no debe exponerse ningún panel dev ni telemetría
    await expect(page.getByTestId('dev-recorder-panel')).toHaveCount(0);
    await expect(page.getByTestId('dev-instrumentation-panel')).toHaveCount(0);
    await expect(page.getByTestId('real-camera-fps')).toHaveCount(0);
    await expect(page.getByTestId('dev-fixture-recorder')).toHaveCount(0);
    const hasGlobalBefore = await page.evaluate(() => Boolean(window.__EXPRESAT_DEV_TELEMETRY__));
    expect(hasGlobalBefore).toBe(false);

    // Activar Modo Desarrollador desde el botón en UI
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('dev-recorder-panel')).toBeVisible();
    await expect(page.getByTestId('dev-instrumentation-panel')).toBeVisible();
    await expect(page.getByTestId('real-camera-fps')).toBeVisible();
    await expect(page.getByTestId('dev-fixture-recorder')).toBeVisible();

    const storedAfterOn = await page.evaluate(() => window.localStorage.getItem('expresat_dev_mode'));
    expect(storedAfterOn).toBe('true');

    // Recargar sin ?dev=0 para confirmar persistencia tras reload (clave al cambiar delegate o camExp)
    await page.goto('/translator');
    await expect(page.getByTestId('dev-mode-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('wasm-status-badge')).toHaveText('WASM Activo', {
      timeout: 20000,
    });

    await expect(async () => {
      const snap = await page.evaluate(() => window.__EXPRESAT_DEV_TELEMETRY__?.getSnapshot());
      expect(snap).toBeTruthy();
      expect(snap.runtimeConfig?.enablePose).toBe(true);
      expect(snap.phases.reposo.counts.totalInferences).toBeGreaterThan(0);
    }).toPass({ timeout: 20000 });

    // Ejecutar toma corta con DevRecorder y verificar metadatos del reporte
    await page.getByTestId('dev-record-start-btn').click();
    await expect(async () => {
      const snap = await page.evaluate(() => window.__EXPRESAT_DEV_TELEMETRY__?.getSnapshot());
      expect(snap?.phase).toBe('grabando');
      expect(snap?.phases?.grabando?.counts?.totalInferences).toBeGreaterThan(0);
    }).toPass({ timeout: 15000 });
    await page.getByTestId('dev-record-stop-btn').click();

    const report = await page.evaluate(() => window.__EXPRESAT_DEV_TELEMETRY__?.getReport());
    const reportFilename = await page.evaluate(() =>
      window.__EXPRESAT_DEV_TELEMETRY__?.getReportFilename()
    );
    expect(report?.git_commit_short).toMatch(/^[a-f0-9]{7,}$/);
    expect(report?.track_settings?.width).toBeGreaterThan(0);
    expect(reportFilename).toMatch(/^telemetry_\d{8}_\d{6}_[a-f0-9]{7,}\.json$/);

    // Desactivar Modo Desarrollador debe desmontar los paneles y limpiar telemetría global
    await page.getByTestId('dev-mode-toggle').click();
    await expect(page.getByTestId('dev-mode-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('dev-recorder-panel')).toHaveCount(0);
    await expect(page.getByTestId('dev-instrumentation-panel')).toHaveCount(0);
    await expect(page.getByTestId('dev-fixture-recorder')).toHaveCount(0);
    await expect(async () => {
      const hasGlobalAfter = await page.evaluate(() => Boolean(window.__EXPRESAT_DEV_TELEMETRY__));
      expect(hasGlobalAfter).toBe(false);
    }).toPass({ timeout: 10000 });

    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
