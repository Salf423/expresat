import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('Gate 1B — Arnés Determinista y Medición de Ruido WASM', () => {
  test('Mide el ruido de MediaPipe Tasks Vision CPU entre dos corridas deterministas con timestamps fijos', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000);
    const browserName = testInfo.project.name || 'chromium';

    // Collect browser console output
    const consoleLogs = [];
    page.on('console', (msg) => {
      consoleLogs.push(msg.text());
    });

    await page.goto('/translator');

    // Wait for WASM and MediaPipe models to become ready
    const wasmBadge = page.getByTestId('wasm-status-badge');
    await expect(wasmBadge).toHaveText('WASM Activo', { timeout: 25000 });

    // Run deterministic harness inside the browser context hosting MediaPipe Tasks Vision
    const results = await page.evaluate(async () => {
      // Obtain MediaPipe constructors exposed on window.__TasksVision__
      const { FilesetResolver, HandLandmarker, PoseLandmarker } = window.__TasksVision__;

      const vision = await FilesetResolver.forVisionTasks('/wasm');
      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
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

      let poseLandmarker = null;
      try {
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/pose_landmarker_lite.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.3,
          minPosePresenceConfidence: 0.3,
          minTrackingConfidence: 0.3,
        });
      } catch (err) {
        console.warn('PoseLandmarker error:', err);
      }

      // Load a real hand image for CNN feature stimulation
      const img = new Image();
      img.src = '/test_hand.png';
      await img.decode();

      // Create a 640x480 canvas with a deterministic visual pattern
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');

      function drawFrame(frameIdx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 640, 480);

        // Deterministic synthetic motion path
        const handX = 180 + Math.sin(frameIdx * 0.1) * 10;
        const handY = 100 + Math.cos(frameIdx * 0.1) * 8;
        ctx.drawImage(img, handX, handY, 260, 300);
      }

      // Fixed sequence of 30 timestamps: dt = 33.333 ms (30 FPS over 1000 ms)
      const numFrames = 30;
      const timestamps = Array.from({ length: numFrames }, (_, i) => Math.round(i * 33.333));

      // Run 1
      const run1 = [];
      for (let i = 0; i < numFrames; i++) {
        drawFrame(i);
        const resHand = handLandmarker.detectForVideo(canvas, timestamps[i]);
        const resPose = poseLandmarker ? poseLandmarker.detectForVideo(canvas, timestamps[i]) : null;
        run1.push({
          timestamp: timestamps[i],
          landmarks: resHand.landmarks || [],
          handedness: resHand.handedness || [],
          poseLandmarks: resPose?.landmarks || [],
        });
      }

      // Close and re-initialize for an independent second run with identical input
      handLandmarker.close();
      if (poseLandmarker) poseLandmarker.close();

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

      let poseLandmarker2 = null;
      try {
        poseLandmarker2 = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/pose_landmarker_lite.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.3,
          minPosePresenceConfidence: 0.3,
          minTrackingConfidence: 0.3,
        });
      } catch (e) {
        // Optional pose model
      }

      // Run 2
      const run2 = [];
      for (let i = 0; i < numFrames; i++) {
        drawFrame(i);
        const resHand = handLandmarker2.detectForVideo(canvas, timestamps[i]);
        const resPose = poseLandmarker2 ? poseLandmarker2.detectForVideo(canvas, timestamps[i]) : null;
        run2.push({
          timestamp: timestamps[i],
          landmarks: resHand.landmarks || [],
          handedness: resHand.handedness || [],
          poseLandmarks: resPose?.landmarks || [],
        });
      }

      handLandmarker2.close();
      if (poseLandmarker2) poseLandmarker2.close();

      // Measure statistical noise between Run 1 and Run 2 (Hands)
      let totalPoints = 0;
      let maxLandmarkDiff = 0.0;
      let sumDiff = 0.0;
      let sumSqDiff = 0.0;
      const perFrameMaxDiff = [];
      let labelMismatches = 0;
      let framesDetectedHand = 0;

      for (let f = 0; f < numFrames; f++) {
        const h1 = run1[f].landmarks;
        const h2 = run2[f].landmarks;
        let frameMax = 0.0;

        if (h1.length > 0) framesDetectedHand++;

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

      // Pose noise statistics (if pose landmarks were detected)
      let totalPosePoints = 0;
      let maxPoseDiff = 0.0;
      let sumPoseDiff = 0.0;
      let framesDetectedPose = 0;

      for (let f = 0; f < numFrames; f++) {
        const p1 = run1[f].poseLandmarks;
        const p2 = run2[f].poseLandmarks;
        if (p1.length > 0) framesDetectedPose++;

        if (p1.length === p2.length && p1.length > 0) {
          for (let poseIdx = 0; poseIdx < p1.length; poseIdx++) {
            const pts1 = p1[poseIdx];
            const pts2 = p2[poseIdx];
            for (let ptIdx = 0; ptIdx < Math.min(pts1.length, pts2.length); ptIdx++) {
              const dx = Math.abs(pts1[ptIdx].x - pts2[ptIdx].x);
              const dy = Math.abs(pts1[ptIdx].y - pts2[ptIdx].y);
              const dz = Math.abs(pts1[ptIdx].z - pts2[ptIdx].z);
              const diff = Math.max(dx, dy, dz);
              if (diff > maxPoseDiff) maxPoseDiff = diff;
              sumPoseDiff += diff;
              totalPosePoints++;
            }
          }
        }
      }

      return {
        userAgent: navigator.userAgent,
        numFrames,
        framesDetectedHand,
        framesDetectedPose,
        totalPointsEvaluated: totalPoints,
        maxLandmarkNoise: maxLandmarkDiff,
        meanLandmarkNoise: meanDiff,
        stdLandmarkNoise: stdDiff,
        labelMismatches,
        totalPosePointsEvaluated: totalPosePoints,
        maxPoseNoise: maxPoseDiff,
        meanPoseNoise: totalPosePoints > 0 ? sumPoseDiff / totalPosePoints : 0.0,
      };
    });

    results.browser = browserName;

    console.log('\n===============================================================');
    console.log(`   REPORTE DETERMINISTA GATE 1B — NAVEGADOR: ${browserName.toUpperCase()}`);
    console.log('===============================================================');
    console.log(`Frames evaluados con timestamps fijos:  ${results.numFrames}`);
    console.log(`Detección de manos:                     ${results.framesDetectedHand} / ${results.numFrames}`);
    console.log(`Puntos articulares de manos:            ${results.totalPointsEvaluated}`);
    console.log(`Ruido máximo L_inf entre corridas:       ${results.maxLandmarkNoise.toExponential(4)}`);
    console.log(`Ruido medio articular (E = mu):         ${results.meanLandmarkNoise.toExponential(4)}`);
    console.log(`Desviación estándar de ruido (sigma):   ${results.stdLandmarkNoise.toExponential(4)}`);
    console.log(`Cota 3 * E (3 * mu):                    ${(3 * results.meanLandmarkNoise).toExponential(4)}`);
    console.log(`Cota mu + 3 * sigma:                    ${(results.meanLandmarkNoise + 3 * results.stdLandmarkNoise).toExponential(4)}`);
    console.log(`Discrepancias de categoryName:          ${results.labelMismatches}`);
    console.log(`Detección de pose (lite):               ${results.framesDetectedPose} / ${results.numFrames}`);
    if (results.totalPosePointsEvaluated > 0) {
      console.log(`Ruido máximo L_inf de pose:             ${results.maxPoseNoise.toExponential(4)}`);
    }
    console.log('===============================================================\n');

    // Write per-browser report file for traceability
    const reportPath = path.resolve(
      process.cwd(),
      `../../docs/dataset-generator/GATE_1B_WASM_NOISE_REPORT_${browserName.toUpperCase()}.json`
    );
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');

    // Update consolidated report file
    const mainReportPath = path.resolve(process.cwd(), '../../docs/dataset-generator/GATE_1B_WASM_NOISE_REPORT.json');
    let consolidated = {};
    if (fs.existsSync(mainReportPath)) {
      try {
        consolidated = JSON.parse(fs.readFileSync(mainReportPath, 'utf-8'));
      } catch (e) {
        consolidated = {};
      }
    }
    consolidated[browserName] = results;
    fs.writeFileSync(mainReportPath, JSON.stringify(consolidated, null, 2), 'utf-8');

    // Confirm 30/30 hand detections
    expect(results.framesDetectedHand).toBe(30);

    // Ensure categoryName stays 100% consistent across identical runs
    expect(results.labelMismatches).toBe(0);

    // Empirical WASM (XNNPACK CPU) landmark jitter bound:
    // With mean E = 1.09e-4 and SIMD reduction peak ~9.77e-4, 1.5e-3 bounds all observed jitter
    expect(results.maxLandmarkNoise).toBeLessThanOrEqual(1.5e-3);
  });
});
