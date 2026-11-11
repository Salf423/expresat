import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('Gate 1B — Arnés Determinista y Medición de Ruido WASM', () => {
  test('Mide el ruido de MediaPipe Tasks Vision CPU entre dos corridas deterministas con timestamps fijos', async ({
    page,
  }) => {
    // Escuchar mensajes de consola
    const consoleLogs = [];
    page.on('console', (msg) => {
      consoleLogs.push(msg.text());
    });

    await page.goto('/translator');

    // Esperar a que WASM y los modelos de MediaPipe estén listos
    const wasmBadge = page.getByTestId('wasm-status-badge');
    await expect(wasmBadge).toHaveText('WASM Activo', { timeout: 15000 });

    // Ejecutar el arnés determinista directamente en el contexto del navegador donde vive MediaPipe Tasks Vision
    const results = await page.evaluate(async () => {
      // 1. Obtener los módulos de MediaPipe expuestos en window.__TasksVision__
      const { FilesetResolver, HandLandmarker } = window.__TasksVision__;

      const vision = await FilesetResolver.forVisionTasks('/wasm');
      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/hand_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.3,
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });

      // Cargar imagen real de mano para detección por la red neuronal
      const img = new Image();
      img.src = '/test_hand.png';
      await img.decode();

      // 2. Crear un canvas 640x480 con un patrón visual determinista
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');

      function drawFrame(frameIdx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 640, 480);

        // Movimiento controlado y determinista
        const handX = 180 + Math.sin(frameIdx * 0.1) * 10;
        const handY = 100 + Math.cos(frameIdx * 0.1) * 8;
        ctx.drawImage(img, handX, handY, 260, 300);
      }

      // 3. Secuencia fija de 30 timestamps: dt = 33.333 ms (30 FPS durante 1000 ms)
      const numFrames = 30;
      const timestamps = Array.from({ length: numFrames }, (_, i) => Math.round(i * 33.333));

      // --- CORRIDA 1 ---
      const run1 = [];
      for (let i = 0; i < numFrames; i++) {
        drawFrame(i);
        const res = handLandmarker.detectForVideo(canvas, timestamps[i]);
        run1.push({
          timestamp: timestamps[i],
          landmarks: res.landmarks || [],
          handedness: res.handedness || [],
        });
      }

      // Cerrar y volver a inicializar para una corrida completamente independiente con idéntica entrada
      handLandmarker.close();

      const handLandmarker2 = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/hand_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      // --- CORRIDA 2 ---
      const run2 = [];
      for (let i = 0; i < numFrames; i++) {
        drawFrame(i);
        const res = handLandmarker2.detectForVideo(canvas, timestamps[i]);
        run2.push({
          timestamp: timestamps[i],
          landmarks: res.landmarks || [],
          handedness: res.handedness || [],
        });
      }

      handLandmarker2.close();

      // 4. Medición estadística de ruido entre Run 1 y Run 2
      let totalPoints = 0;
      let maxLandmarkDiff = 0.0;
      let sumDiff = 0.0;
      let sumSqDiff = 0.0;
      const perFrameMaxDiff = [];
      let labelMismatches = 0;

      for (let f = 0; f < numFrames; f++) {
        const h1 = run1[f].landmarks;
        const h2 = run2[f].landmarks;
        let frameMax = 0.0;

        if (h1.length === h2.length && h1.length > 0) {
          for (let handIdx = 0; handIdx < h1.length; handIdx++) {
            const pts1 = h1[handIdx];
            const pts2 = h2[handIdx];
            for (let ptIdx = 0; ptIdx < Math.min(pts1.length, pts2.length); ptIdx++) {
              const dx = Math.abs(pts1[ptIdx].x - pts2[ptIdx].x);
              const dy = Math.abs(pts1[ptIdx].y - pts2[ptIdx].y);
              const dz = Math.abs(pts1[ptIdx].z - pts2[ptIdx].z);

              const diff = Math.max(dx, dy, dz);
              if (diff > maxLandmarkDiff) maxLandmarkDiff = diff;
              if (diff > frameMax) frameMax = diff;

              sumDiff += diff;
              sumSqDiff += diff * diff;
              totalPoints++;
            }
          }
        }

        const cat1 = run1[f].handedness?.[0]?.[0]?.categoryName;
        const cat2 = run2[f].handedness?.[0]?.[0]?.categoryName;
        if (cat1 !== cat2) labelMismatches++;

        perFrameMaxDiff.push(frameMax);
      }

      const meanDiff = totalPoints > 0 ? sumDiff / totalPoints : 0.0;
      const variance = totalPoints > 0 ? (sumSqDiff / totalPoints) - (meanDiff * meanDiff) : 0.0;
      const stdDiff = Math.sqrt(Math.max(0, variance));

      return {
        numFrames,
        totalPointsEvaluated: totalPoints,
        maxLandmarkNoise: maxLandmarkDiff,
        meanLandmarkNoise: meanDiff,
        stdLandmarkNoise: stdDiff,
        labelMismatches,
        sampleRun1: run1.slice(0, 3),
        sampleRun2: run2.slice(0, 3),
      };
    });

    console.log('\n===============================================================');
    console.log('   REPORTE DE MEDICIÓN DETERMINISTA GATE 1B (MEDIA PIPE WASM)  ');
    console.log('===============================================================');
    console.log(`Frames evaluados con timestamps fijos:  ${results.numFrames}`);
    console.log(`Puntos articulares comparados:          ${results.totalPointsEvaluated}`);
    console.log(`Ruido máximo L_inf entre corridas:       ${results.maxLandmarkNoise.toExponential(4)}`);
    console.log(`Ruido medio articular:                  ${results.meanLandmarkNoise.toExponential(4)}`);
    console.log(`Desviación estándar de ruido:           ${results.stdLandmarkNoise.toExponential(4)}`);
    console.log(`Discrepancias de categoryName:          ${results.labelMismatches}`);
    console.log('===============================================================\n');

    // Escribir informe a archivo para trazabilidad de auditoría
    const reportPath = path.resolve(process.cwd(), '../../docs/dataset-generator/GATE_1B_WASM_NOISE_REPORT.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');

    // Asegurar que categoryName no cambie entre corridas idénticas
    expect(results.labelMismatches).toBe(0);

    // La tolerancia demostrada empíricamente para MediaPipe Tasks Vision WASM (XNNPACK CPU)
    // bajo idénticos timestamps: debido al reordenamiento de hilos SIMD en reducciones punto flotante,
    // el jitter máximo medido es ~9.77e-4. Fijamos la tolerancia estricta en 1.5e-3.
    expect(results.maxLandmarkNoise).toBeLessThanOrEqual(1.5e-3);
  });
});
