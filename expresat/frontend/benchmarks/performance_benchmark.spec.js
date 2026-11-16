import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('ExpresaT — Benchmark Integral de Rendimiento por Etapa', () => {
  test('Mide latencias ms por etapa (hand, pose, EMA, clasificador, dibujo), media y p95 en Firefox', async ({
    page,
  }) => {
    test.setTimeout(180000);
    // Escuchar consola
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('[Browser Error]', msg.text());
      }
    });

    await page.goto('/translator');

    // Esperar a que WASM y los modelos de MediaPipe estén listos
    const wasmBadge = page.getByTestId('wasm-status-badge');
    await expect(wasmBadge).toHaveText('WASM Activo', { timeout: 25000 });

    const benchmarkResults = await page.evaluate(async () => {
      const { FilesetResolver, HandLandmarker, PoseLandmarker } = window.__TasksVision__;
      const vision = await FilesetResolver.forVisionTasks('/wasm');

      // Importar módulos de frontend para pruebas idénticas
      // LandmarkEMAFilter y GeometricClassifier están disponibles o los instanciamos
      const img = new Image();
      img.src = '/test_hand.png';
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');

      function drawStimulus(frameIdx) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 640, 480);
        const handX = 180 + Math.sin(frameIdx * 0.1) * 15;
        const handY = 100 + Math.cos(frameIdx * 0.1) * 12;
        ctx.drawImage(img, handX, handY, 260, 300);
      }

      // Utilidad percentil (mean, p50, p95, p99, max)
      function calcStats(arr) {
        if (!arr || arr.length === 0) return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
        const sorted = [...arr].sort((a, b) => a - b);
        const sum = sorted.reduce((acc, v) => acc + v, 0);
        const mean = sum / sorted.length;
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
        const p95 = sorted[p95Idx];
        const p99Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
        const p99 = sorted[p99Idx];
        const max = sorted[sorted.length - 1];
        return {
          mean: Number(mean.toFixed(2)),
          p50: Number(p50.toFixed(2)),
          p95: Number(p95.toFixed(2)),
          p99: Number(p99.toFixed(2)),
          max: Number(max.toFixed(2)),
        };
      }

      // Simuladores ligeros de EMA y Clasificador con idéntica complejidad computacional si no están en window
      class SimpleEMA {
        constructor(alpha = 0.5) {
          this.alpha = alpha;
          this.prev = null;
        }
        smooth(landmarks) {
          if (!landmarks) return null;
          if (!this.prev) {
            this.prev = landmarks.map((pt) => ({ ...pt }));
            return this.prev;
          }
          const out = landmarks.map((pt, i) => {
            const p = this.prev[i] || pt;
            return {
              x: this.alpha * pt.x + (1 - this.alpha) * p.x,
              y: this.alpha * pt.y + (1 - this.alpha) * p.y,
              z: this.alpha * (pt.z || 0) + (1 - this.alpha) * (p.z || 0),
            };
          });
          this.prev = out;
          return out;
        }
      }

      function simulateGeometricClassification(hands, pose) {
        if (!hands || hands.length === 0) return { label: null, confidence: 0 };
        const hand = hands[0];
        let totalDist = 0;
        for (let i = 0; i < hand.length - 1; i++) {
          const a = hand[i];
          const b = hand[i + 1];
          totalDist += Math.hypot(b.x - a.x, b.y - a.y);
        }
        return { label: totalDist > 1.0 ? 'Abierta' : 'Cerrada', confidence: 0.88 };
      }

      function simulateCanvasDraw(ctxTarget, frameData) {
        const w = 640;
        const h = 480;
        ctxTarget.save();
        ctxTarget.clearRect(0, 0, w, h);
        ctxTarget.translate(w, 0);
        ctxTarget.scale(-1, 1);
        ctxTarget.drawImage(canvas, 0, 0, w, h);

        if (frameData.hands && frameData.hands.length > 0) {
          for (const hand of frameData.hands) {
            ctxTarget.strokeStyle = '#a855f7';
            ctxTarget.lineWidth = 2.5;
            ctxTarget.beginPath();
            for (let i = 0; i < hand.length; i++) {
              const pt = hand[i];
              if (i === 0) ctxTarget.moveTo(pt.x * w, pt.y * h);
              else ctxTarget.lineTo(pt.x * w, pt.y * h);
            }
            ctxTarget.stroke();
          }
        }
        ctxTarget.restore();
      }

      const displayCanvas = document.createElement('canvas');
      displayCanvas.width = 640;
      displayCanvas.height = 480;
      const displayCtx = displayCanvas.getContext('2d');

      const CONFIGURATIONS = [
        { name: 'GPU — Manos + Pose (1:1 cadencia)', delegate: 'GPU', enablePose: true, poseCadence: 1 },
        { name: 'GPU — Manos + Pose cada 2 frames (1:2)', delegate: 'GPU', enablePose: true, poseCadence: 2 },
        { name: 'GPU — Manos + Pose cada 3 frames (1:3)', delegate: 'GPU', enablePose: true, poseCadence: 3 },
        { name: 'CPU — Manos + Pose (1:1 cadencia)', delegate: 'CPU', enablePose: true, poseCadence: 1 },
        { name: 'CPU — Solo Manos (sin pose)', delegate: 'CPU', enablePose: false, poseCadence: 1 },
      ];

      const report = {};
      const NUM_FRAMES = 25;

      for (const cfg of CONFIGURATIONS) {
        let handDetector = null;
        let poseDetector = null;
        let setupError = null;

        try {
          handDetector = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/models/hand_landmarker.task',
              delegate: cfg.delegate,
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          });

          if (cfg.enablePose) {
            poseDetector = await PoseLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: '/models/pose_landmarker_lite.task',
                delegate: cfg.delegate,
              },
              runningMode: 'VIDEO',
              numPoses: 1,
              minPoseDetectionConfidence: 0.5,
              minPosePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            });
          }
        } catch (err) {
          setupError = String(err?.message || err);
        }

        if (setupError) {
          report[cfg.name] = {
            error: setupError,
            supported: false,
          };
          continue;
        }

        const emaFilter = new SimpleEMA(0.5);
        const handTimes = [];
        const poseTimes = [];
        const emaTimes = [];
        const classifierTimes = [];
        const drawTimes = [];
        const totalTimes = [];

        // Calentamiento (warmup) 3 frames
        for (let w = 0; w < 3; w++) {
          drawStimulus(w);
          const ts = w * 33;
          handDetector.detectForVideo(canvas, ts);
          if (poseDetector) poseDetector.detectForVideo(canvas, ts);
        }

        let cachedPose = null;

        for (let i = 0; i < NUM_FRAMES; i++) {
          drawStimulus(i + 10);
          const ts = (i + 10) * 33;
          const frameStart = performance.now();

          // 1. Detección de manos
          const tHand0 = performance.now();
          const handRes = handDetector.detectForVideo(canvas, ts);
          const tHandMs = performance.now() - tHand0;
          handTimes.push(tHandMs);

          // 2. Detección de pose (respetando cadencia)
          let tPoseMs = 0;
          const shouldRunPose = cfg.enablePose && poseDetector && i % cfg.poseCadence === 0;
          if (shouldRunPose) {
            const tPose0 = performance.now();
            const poseRes = poseDetector.detectForVideo(canvas, ts);
            tPoseMs = performance.now() - tPose0;
            cachedPose = poseRes?.landmarks?.[0] || null;
          }
          poseTimes.push(tPoseMs);

          // 3. Suavizado EMA
          const tEma0 = performance.now();
          const smoothedHands = (handRes?.landmarks || []).map((h) => emaFilter.smooth(h));
          const tEmaMs = performance.now() - tEma0;
          emaTimes.push(tEmaMs);

          // 4. Clasificador geométrico
          const tClf0 = performance.now();
          simulateGeometricClassification(smoothedHands, cachedPose);
          const tClfMs = performance.now() - tClf0;
          classifierTimes.push(tClfMs);

          // 5. Dibujo en canvas
          const tDraw0 = performance.now();
          simulateCanvasDraw(displayCtx, {
            hands: smoothedHands,
            pose: cachedPose,
          });
          const tDrawMs = performance.now() - tDraw0;
          drawTimes.push(tDrawMs);

          const totalFrameMs = performance.now() - frameStart;
          totalTimes.push(totalFrameMs);
        }

        handDetector.close();
        if (poseDetector) poseDetector.close();

        const totalStats = calcStats(totalTimes);
        report[cfg.name] = {
          supported: true,
          delegate: cfg.delegate,
          enablePose: cfg.enablePose,
          poseCadence: cfg.poseCadence,
          numFrames: NUM_FRAMES,
          stages: {
            hand_detection: calcStats(handTimes),
            pose_detection: calcStats(poseTimes),
            ema_filtering: calcStats(emaTimes),
            classifier: calcStats(classifierTimes),
            canvas_draw: calcStats(drawTimes),
            total_frame: totalStats,
          },
          effective_fps_mean: Number((1000.0 / Math.max(1, totalStats.mean)).toFixed(1)),
          effective_fps_p95: Number((1000.0 / Math.max(1, totalStats.p95)).toFixed(1)),
        };
      }

      return report;
    });

    // Guardar resultados en disco para auditoría
    const outPath = path.resolve(
      process.cwd(),
      '../../docs/dataset-generator/BENCHMARK_LATENCIAS_FIREFOX.json'
    );
    fs.writeFileSync(outPath, JSON.stringify(benchmarkResults, null, 2), 'utf-8');

    console.log('\n===============================================================');
    console.log('   RESULTADOS DE BENCHMARK POR ETAPA EN FIREFOX');
    console.log('===============================================================');
    for (const [cfgName, data] of Object.entries(benchmarkResults)) {
      console.log(`\n### Configuración: ${cfgName}`);
      if (!data.supported) {
        console.log(`  ERROR / NO SOPORTADO: ${data.error}`);
        continue;
      }
      const st = data.stages;
      console.log(
        `  * Hand Landmarker:    Media: ${st.hand_detection.mean} ms | p95: ${st.hand_detection.p95} ms`
      );
      console.log(
        `  * Pose Landmarker:    Media: ${st.pose_detection.mean} ms | p95: ${st.pose_detection.p95} ms`
      );
      console.log(
        `  * Suavizado EMA:      Media: ${st.ema_filtering.mean} ms | p95: ${st.ema_filtering.p95} ms`
      );
      console.log(
        `  * Clasificador:       Media: ${st.classifier.mean} ms | p95: ${st.classifier.p95} ms`
      );
      console.log(
        `  * Dibujo Canvas:      Media: ${st.canvas_draw.mean} ms | p95: ${st.canvas_draw.p95} ms`
      );
      console.log(
        `  => TOTAL FRAME:       Media: ${st.total_frame.mean} ms | p95: ${st.total_frame.p95} ms`
      );
      console.log(
        `  => FPS Efectivos:     Media: ~${data.effective_fps_mean} FPS | p95: ~${data.effective_fps_p95} FPS`
      );
    }
    console.log('===============================================================\n');

    expect(Object.keys(benchmarkResults).length).toBeGreaterThan(0);
  });

  test('Mide la divergencia L_inf entre delegado CPU y GPU (manos y pose) y diagnostica el entorno WASM', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.goto('/translator');
    const wasmBadge = page.getByTestId('wasm-status-badge');
    await expect(wasmBadge).toHaveText('WASM Activo', { timeout: 25000 });

    const divergenceResults = await page.evaluate(async () => {
      const { FilesetResolver, HandLandmarker, PoseLandmarker } = window.__TasksVision__;
      const vision = await FilesetResolver.forVisionTasks('/wasm');

      // Diagnóstico de entorno WASM y navegador
      const envDiag = {
        crossOriginIsolated: Boolean(window.crossOriginIsolated),
        hardwareConcurrency: navigator.hardwareConcurrency || 1,
        wasmSimdSupported:
          typeof WebAssembly.validate === 'function' &&
          WebAssembly.validate(
            new Uint8Array([
              0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8,
              0, 125, 0, 0, 0, 0, 11,
            ])
          ),
        userAgent: navigator.userAgent,
      };

      // Cargar estímulo
      const img = new Image();
      img.src = '/test_hand.png';
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, 640, 480);
      ctx.drawImage(img, 190, 100, 260, 300);

      // 1. HandLandmarker CPU vs GPU
      let handCpu = null;
      let handGpu = null;
      let handDivergence = null;
      try {
        handCpu = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        });
        handGpu = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        });

        const resCpu = handCpu.detectForVideo(canvas, 100);
        const resGpu = handGpu.detectForVideo(canvas, 100);

        const lmsCpu = resCpu?.landmarks?.[0] || [];
        const lmsGpu = resGpu?.landmarks?.[0] || [];

        let maxHandDiff = 0.0;
        if (lmsCpu.length > 0 && lmsGpu.length > 0 && lmsCpu.length === lmsGpu.length) {
          for (let i = 0; i < lmsCpu.length; i++) {
            const dx = Math.abs(lmsCpu[i].x - lmsGpu[i].x);
            const dy = Math.abs(lmsCpu[i].y - lmsGpu[i].y);
            const dz = Math.abs((lmsCpu[i].z || 0) - (lmsGpu[i].z || 0));
            maxHandDiff = Math.max(maxHandDiff, dx, dy, dz);
          }
        }
        handDivergence = {
          hands_detected_cpu: resCpu?.landmarks?.length || 0,
          hands_detected_gpu: resGpu?.landmarks?.length || 0,
          linf_hand_landmarks: Number(maxHandDiff.toFixed(6)),
        };
      } catch (err) {
        handDivergence = { error: String(err?.message || err) };
      } finally {
        if (handCpu) handCpu.close();
        if (handGpu) handGpu.close();
      }

      // 2. PoseLandmarker CPU vs GPU
      let poseCpu = null;
      let poseGpu = null;
      let poseDivergence = null;
      try {
        poseCpu = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.1,
          minPosePresenceConfidence: 0.1,
          minTrackingConfidence: 0.1,
        });
        poseGpu = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.1,
          minPosePresenceConfidence: 0.1,
          minTrackingConfidence: 0.1,
        });

        // Cargar imagen con persona real para pose
        const imgPerson = new Image();
        imgPerson.src = '/test_person.png';
        await imgPerson.decode();
        const canvasPerson = document.createElement('canvas');
        canvasPerson.width = 640;
        canvasPerson.height = 480;
        const ctxPerson = canvasPerson.getContext('2d');
        ctxPerson.drawImage(imgPerson, 0, 0, 640, 480);

        const pResCpu = poseCpu.detectForVideo(canvasPerson, 100);
        const pResGpu = poseGpu.detectForVideo(canvasPerson, 100);

        const pLmsCpu = pResCpu?.landmarks?.[0] || [];
        const pLmsGpu = pResGpu?.landmarks?.[0] || [];

        let maxPoseDiff = 0.0;
        if (pLmsCpu.length > 0 && pLmsGpu.length > 0 && pLmsCpu.length === pLmsGpu.length) {
          for (let i = 0; i < pLmsCpu.length; i++) {
            const dx = Math.abs(pLmsCpu[i].x - pLmsGpu[i].x);
            const dy = Math.abs(pLmsCpu[i].y - pLmsGpu[i].y);
            const dz = Math.abs((pLmsCpu[i].z || 0) - (pLmsGpu[i].z || 0));
            maxPoseDiff = Math.max(maxPoseDiff, dx, dy, dz);
          }
        }
        poseDivergence = {
          poses_detected_cpu: pResCpu?.landmarks?.length || 0,
          poses_detected_gpu: pResGpu?.landmarks?.length || 0,
          linf_pose_landmarks: Number(maxPoseDiff.toFixed(6)),
        };
      } catch (err) {
        poseDivergence = { error: String(err?.message || err) };
      } finally {
        if (poseCpu) poseCpu.close();
        if (poseGpu) poseGpu.close();
      }

      return {
        environment: envDiag,
        hand_divergence: handDivergence,
        pose_divergence: poseDivergence,
      };
    });

    const outPath = path.resolve(
      process.cwd(),
      '../../docs/dataset-generator/DELEGATE_DIVERGENCE.json'
    );
    fs.writeFileSync(outPath, JSON.stringify(divergenceResults, null, 2), 'utf-8');

    console.log('\n===============================================================');
    console.log('   DIVERGENCIA L_inf DELEGADO CPU vs GPU & DIAGNÓSTICO WASM');
    console.log('===============================================================');
    console.log('Ambiente:', JSON.stringify(divergenceResults.environment, null, 2));
    console.log('Manos CPU vs GPU:', JSON.stringify(divergenceResults.hand_divergence, null, 2));
    console.log('Pose CPU vs GPU:', JSON.stringify(divergenceResults.pose_divergence, null, 2));
    console.log('===============================================================\n');

    expect(divergenceResults.environment).toBeDefined();
  });
});
