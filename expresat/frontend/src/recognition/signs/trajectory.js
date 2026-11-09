/**
 * src/recognition/signs/trajectory.js — Análisis de trayectorias normalizadas en ventanas de milisegundos
 *
 * Resuelve la Limitación 4/5:
 * - Ventanas definidas en milisegundos (`windowMs`, por defecto 750 ms) para soportar FPS variable (15–30 FPS).
 * - Desplazamientos y amplitudes siempre normalizados por `palmScale`.
 * - Remuestreo uniforme a M puntos y comparación con plantillas 2D invariantes a quiralidad (mano izquierda/derecha).
 */

import {
  HAND_LANDMARKS,
  isValidHandLandmarks,
  palmScale,
  fingerStates,
} from '../geometry.js';

/**
 * Plantillas canónicas 2D (normalizadas al cuadrado unitario [-0.5, 0.5] tras centrar)
 * para las señas dinámicas de trazo geométrico.
 */
export const TRAJECTORY_TEMPLATES = Object.freeze({
  // Letra Z: trazo horizontal superior -> diagonal descendente -> trazo horizontal inferior
  Z: [
    { x: -0.45, y: -0.42 },
    { x: -0.15, y: -0.42 },
    { x: 0.15, y: -0.42 },
    { x: 0.45, y: -0.42 },
    { x: 0.22, y: -0.18 },
    { x: 0.0, y: 0.0 },
    { x: -0.22, y: 0.18 },
    { x: -0.45, y: 0.42 },
    { x: -0.15, y: 0.42 },
    { x: 0.15, y: 0.42 },
    { x: 0.45, y: 0.42 },
  ],
  // Letra J: descenso vertical seguido de gancho curvo inferior hacia un lado y arriba
  J: [
    { x: 0.35, y: -0.48 },
    { x: 0.35, y: -0.22 },
    { x: 0.35, y: 0.05 },
    { x: 0.32, y: 0.28 },
    { x: 0.2, y: 0.44 },
    { x: 0.0, y: 0.48 },
    { x: -0.22, y: 0.42 },
    { x: -0.35, y: 0.24 },
    { x: -0.38, y: 0.05 },
  ],
});

/**
 * Normaliza una lista de frames para asegurar que cada elemento tenga `{ landmarks, timestampMs }`.
 * Si los frames no traen `timestampMs`, les asigna intervalos sintéticos según `assumedFps` (por defecto 25 FPS = 40 ms).
 *
 * @param {Array<any>} rawEntries
 * @param {number} [assumedFps=25]
 * @returns {Array<{ landmarks: Array<{x:number,y:number,z?:number}>, timestampMs: number, handedness?: string }>}
 */
export function normalizeTimedEntries(rawEntries, assumedFps = 25) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) return [];
  const stepMs = 1000 / Math.max(5, assumedFps);
  const result = [];

  for (let i = 0; i < rawEntries.length; i++) {
    const item = rawEntries[i];
    if (!item) continue;

    let landmarks = null;
    let timestampMs = i * stepMs;
    let handedness = 'Right';

    if (Array.isArray(item) && item.length >= 21) {
      landmarks = item;
      if (typeof item.timestampMs === 'number') timestampMs = item.timestampMs;
      if (typeof item.handedness === 'string') handedness = item.handedness;
    } else if (typeof item === 'object') {
      if (typeof item.timestampMs === 'number' && Number.isFinite(item.timestampMs)) {
        timestampMs = item.timestampMs;
      } else if (typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)) {
        timestampMs = item.timestamp;
      }
      if (typeof item.handedness === 'string') {
        handedness = item.handedness;
      }
      if (Array.isArray(item.landmarks) && item.landmarks.length >= 21) {
        landmarks = item.landmarks;
      } else if (Array.isArray(item.rightHand) && item.rightHand.length >= 21) {
        landmarks = item.rightHand;
        handedness = 'Right';
      } else if (Array.isArray(item.leftHand) && item.leftHand.length >= 21) {
        landmarks = item.leftHand;
        handedness = 'Left';
      } else if (
        Array.isArray(item.hands) &&
        item.hands.length > 0 &&
        Array.isArray(item.hands[0]) &&
        item.hands[0].length >= 21
      ) {
        landmarks = item.hands[0];
      }
    }

    if (landmarks && isValidHandLandmarks(landmarks)) {
      result.push({ landmarks, timestampMs, handedness });
    }
  }

  return result;
}

/**
 * Filtra las entradas dentro de los últimos `windowMs` milisegundos respecto al último frame válido.
 *
 * @param {Array<any>} rawEntries
 * @param {number} [windowMs=750]
 * @returns {Array<{ landmarks: Array<{x:number,y:number,z?:number}>, timestampMs: number, handedness: string }>}
 */
export function extractWindowMs(rawEntries, windowMs = 750) {
  const entries = normalizeTimedEntries(rawEntries);
  if (entries.length === 0) return [];
  const latestTs = entries[entries.length - 1].timestampMs;
  const minTs = latestTs - Math.max(150, windowMs);
  return entries.filter((e) => e.timestampMs >= minTs);
}

/**
 * Remuestrea linealmente una polilínea 2D a exactamente `numSamples` puntos equidistantes en longitud de arco
 * (o índice temporal si la longitud es casi cero).
 *
 * @param {Array<{x:number, y:number}>} points
 * @param {number} [numSamples=16]
 * @returns {Array<{x:number, y:number}>}
 */
export function resampleTrajectory(points, numSamples = 16) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (points.length === 1) {
    return Array.from({ length: numSamples }, () => ({ x: points[0].x, y: points[0].y }));
  }

  const cumDist = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    cumDist.push(cumDist[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }

  const totalLen = cumDist[cumDist.length - 1];
  if (totalLen < 1e-5) {
    return Array.from({ length: numSamples }, () => ({ x: points[0].x, y: points[0].y }));
  }

  const resampled = [];
  for (let s = 0; s < numSamples; s++) {
    const targetDist = (s / (numSamples - 1)) * totalLen;
    let idx = 0;
    while (idx < cumDist.length - 2 && cumDist[idx + 1] < targetDist) {
      idx++;
    }
    const segLen = cumDist[idx + 1] - cumDist[idx];
    const t = segLen > 1e-6 ? (targetDist - cumDist[idx]) / segLen : 0;
    resampled.push({
      x: points[idx].x + t * (points[idx + 1].x - points[idx].x),
      y: points[idx].y + t * (points[idx + 1].y - points[idx].y),
    });
  }

  return resampled;
}

/**
 * Centra y escala una trayectoria 2D a su caja envolvente máxima unitaria [-0.5, 0.5].
 */
function normalizeBoundingBox(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const span = Math.max(maxX - minX, maxY - minY, 1e-5);

  return {
    normalized: points.map((p) => ({
      x: (p.x - cx) / span,
      y: (p.y - cy) / span,
    })),
    spanX: maxX - minX,
    spanY: maxY - minY,
    maxSpan: span,
  };
}

/**
 * Compara una trayectoria observada (en unidades de `palmScale`) contra una plantilla canónica 2D.
 * Evalúa tanto la plantilla directa como su espejo horizontal (`x -> -x`) para soportar ambas manos y espejo.
 *
 * @param {Array<{x:number, y:number}>} pointsEnPalmScale
 * @param {Array<{x:number, y:number}>} templatePoints
 * @param {Object} [options]
 * @param {number} [options.minPathLength=0.55] Longitud mínima de camino en unidades de palmScale
 * @param {number} [options.minSpan=0.22] Extensión mínima de la caja envolvente en unidades de palmScale
 * @param {number} [options.toleranceRmse=0.32] RMSE máximo tolerado en el cuadrado unitario
 * @returns {{ matched: boolean, score: number, rmse: number, pathLength: number, spanX: number, spanY: number }}
 */
export function matchTrajectoryTemplate(pointsEnPalmScale, templatePoints, options = {}) {
  const minPathLength = options.minPathLength ?? 0.55;
  const minSpan = options.minSpan ?? 0.22;
  const toleranceRmse = options.toleranceRmse ?? 0.32;
  const numSamples = 16;

  if (!Array.isArray(pointsEnPalmScale) || pointsEnPalmScale.length < 4) {
    return { matched: false, score: 0, rmse: Infinity, pathLength: 0, spanX: 0, spanY: 0 };
  }

  let pathLength = 0;
  for (let i = 1; i < pointsEnPalmScale.length; i++) {
    const dx = pointsEnPalmScale[i].x - pointsEnPalmScale[i - 1].x;
    const dy = pointsEnPalmScale[i].y - pointsEnPalmScale[i - 1].y;
    pathLength += Math.sqrt(dx * dx + dy * dy);
  }

  const { normalized: obsNorm, spanX, spanY, maxSpan } = normalizeBoundingBox(
    resampleTrajectory(pointsEnPalmScale, numSamples)
  );

  if (pathLength < minPathLength || maxSpan < minSpan) {
    return {
      matched: false,
      score: 0,
      rmse: Infinity,
      pathLength: Number(pathLength.toFixed(4)),
      spanX: Number(spanX.toFixed(4)),
      spanY: Number(spanY.toFixed(4)),
    };
  }

  const tplNorm = normalizeBoundingBox(resampleTrajectory(templatePoints, numSamples)).normalized;

  // Evaluar distancia directa y espejada en X
  let sumSqDirect = 0;
  let sumSqMirror = 0;

  for (let i = 0; i < numSamples; i++) {
    const dx1 = obsNorm[i].x - tplNorm[i].x;
    const dy1 = obsNorm[i].y - tplNorm[i].y;
    sumSqDirect += dx1 * dx1 + dy1 * dy1;

    const dx2 = -obsNorm[i].x - tplNorm[i].x;
    const dy2 = obsNorm[i].y - tplNorm[i].y;
    sumSqMirror += dx2 * dx2 + dy2 * dy2;
  }

  const rmse = Math.sqrt(Math.min(sumSqDirect, sumSqMirror) / numSamples);
  const score = Math.max(0, Math.min(1, 1 - rmse / (toleranceRmse * 1.6)));
  const matched = rmse <= toleranceRmse && score >= 0.45;

  return {
    matched,
    score: Number(score.toFixed(4)),
    rmse: Number(rmse.toFixed(4)),
    pathLength: Number(pathLength.toFixed(4)),
    spanX: Number(spanX.toFixed(4)),
    spanY: Number(spanY.toFixed(4)),
  };
}

/**
 * Extrae y resume las características cinemáticas de una ventana temporal de frames en milisegundos.
 * Calcula trayectorias normalizadas por `palmScale`, oscilaciones X/Y y rotación de palma.
 *
 * @param {Array<any>} rawEntries
 * @param {number} [windowMs=750]
 * @returns {Object}
 */
export function buildTrajectoryContext(rawEntries, windowMs = 750) {
  const entries = extractWindowMs(rawEntries, windowMs);
  if (entries.length < 3) {
    return {
      hasMotion: false,
      sampleCount: entries.length,
      durationMs: 0,
      avgPalmScale: 0,
      wristPath: [],
      indexTipPath: [],
      pinkyTipPath: [],
      oscillationX: { isOscillating: false, directionChanges: 0, totalAmplitude: 0, spanX: 0 },
      oscillationY: { isOscillating: false, directionChanges: 0, totalAmplitude: 0, spanY: 0 },
      palmRotation: { isRotating: false, normalDelta: 0, angleDeltaDeg: 0 },
      templates: {
        Z: { matched: false, score: 0 },
        J: { matched: false, score: 0 },
      },
    };
  }

  let scaleSum = 0;
  for (const e of entries) {
    scaleSum += palmScale(e.landmarks);
  }
  const avgScale = scaleSum / entries.length;
  const durationMs = entries[entries.length - 1].timestampMs - entries[0].timestampMs;

  const wristPath = [];
  const indexTipPath = [];
  const pinkyTipPath = [];
  const palmNormals = [];
  const palmAngles = [];

  for (const e of entries) {
    const lm = e.landmarks;
    const w = lm[HAND_LANDMARKS.WRIST];
    const idxTip = lm[HAND_LANDMARKS.INDEX_TIP];
    const pkyTip = lm[HAND_LANDMARKS.PINKY_TIP];

    wristPath.push({ x: w.x / avgScale, y: w.y / avgScale });
    indexTipPath.push({ x: idxTip.x / avgScale, y: idxTip.y / avgScale });
    pinkyTipPath.push({ x: pkyTip.x / avgScale, y: pkyTip.y / avgScale });

    const st = fingerStates(lm, { handedness: e.handedness });
    if (st && st.orientation) {
      palmNormals.push(st.orientation.rawCrossZ);
      palmAngles.push(st.orientation.palmAngleDeg);
    }
  }

  // Analizar oscilación o desplazamiento en un eje 1D (valores ya divididos por avgScale)
  function analyzeAxis1D(values, minHalfAmp = 0.12, noiseThr = 0.015) {
    let minV = Infinity;
    let maxV = -Infinity;
    for (const v of values) {
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const span = maxV - minV;

    let currentDir = 0;
    const extremes = [values[0]];
    for (let i = 0; i < values.length - 1; i++) {
      const diff = values[i + 1] - values[i];
      if (Math.abs(diff) < noiseThr) continue;
      const newDir = diff > 0 ? 1 : -1;
      if (currentDir !== 0 && newDir !== currentDir) {
        extremes.push(values[i]);
      }
      currentDir = newDir;
    }
    extremes.push(values[values.length - 1]);

    let validChanges = 0;
    let totalAmplitude = 0;
    let lastVal = extremes[0];

    for (let i = 1; i < extremes.length; i++) {
      const amp = Math.abs(extremes[i] - lastVal);
      if (amp >= minHalfAmp) {
        validChanges++;
        totalAmplitude += amp;
        lastVal = extremes[i];
      }
    }

    return {
      isOscillating: validChanges >= 2,
      hasDisplacement: span >= minHalfAmp * 1.4,
      directionChanges: validChanges,
      totalAmplitude: Number(totalAmplitude.toFixed(4)),
      span: Number(span.toFixed(4)),
      netDelta: Number((values[values.length - 1] - values[0]).toFixed(4)),
    };
  }

  const wristOscX = analyzeAxis1D(wristPath.map((p) => p.x));
  const indexOscX = analyzeAxis1D(indexTipPath.map((p) => p.x), 0.1, 0.015);
  const indexOscY = analyzeAxis1D(indexTipPath.map((p) => p.y), 0.1, 0.015);
  const wristOscY = analyzeAxis1D(wristPath.map((p) => p.y), 0.1, 0.015);

  // Cambio en la normal de la palma (para el número 10: giro de muñeca con mano abierta)
  let minNorm = Infinity;
  let maxNorm = -Infinity;
  for (const nz of palmNormals) {
    if (nz < minNorm) minNorm = nz;
    if (nz > maxNorm) maxNorm = nz;
  }
  const normalDelta = palmNormals.length >= 2 ? maxNorm - minNorm : 0;

  let minAng = Infinity;
  let maxAng = -Infinity;
  for (const a of palmAngles) {
    if (a < minAng) minAng = a;
    if (a > maxAng) maxAng = a;
  }
  const angleDeltaDeg = palmAngles.length >= 2 ? maxAng - minAng : 0;

  const zMatch = matchTrajectoryTemplate(indexTipPath, TRAJECTORY_TEMPLATES.Z, {
    minPathLength: 0.75,
    minSpan: 0.25,
    toleranceRmse: 0.3,
  });

  const jMatch = matchTrajectoryTemplate(pinkyTipPath, TRAJECTORY_TEMPLATES.J, {
    minPathLength: 0.45,
    minSpan: 0.2,
    toleranceRmse: 0.33,
  });

  const hasMotion =
    wristOscX.hasDisplacement ||
    indexOscX.hasDisplacement ||
    indexOscY.hasDisplacement ||
    wristOscY.hasDisplacement ||
    normalDelta >= 0.45 ||
    zMatch.matched ||
    jMatch.matched;

  return {
    hasMotion,
    sampleCount: entries.length,
    durationMs: Number(durationMs.toFixed(1)),
    avgPalmScale: Number(avgScale.toFixed(4)),
    wristPath,
    indexTipPath,
    pinkyTipPath,
    oscillationX: {
      isOscillating: wristOscX.isOscillating || indexOscX.isOscillating,
      hasDisplacement: wristOscX.hasDisplacement || indexOscX.hasDisplacement,
      directionChanges: Math.max(wristOscX.directionChanges, indexOscX.directionChanges),
      totalAmplitude: Math.max(wristOscX.totalAmplitude, indexOscX.totalAmplitude),
      spanX: Math.max(wristOscX.span, indexOscX.span),
      wristOscX,
      indexOscX,
    },
    oscillationY: {
      isOscillating: wristOscY.isOscillating || indexOscY.isOscillating,
      hasDisplacement: wristOscY.hasDisplacement || indexOscY.hasDisplacement,
      directionChanges: Math.max(wristOscY.directionChanges, indexOscY.directionChanges),
      totalAmplitude: Math.max(wristOscY.totalAmplitude, indexOscY.totalAmplitude),
      spanY: Math.max(wristOscY.span, indexOscY.span),
      netDeltaY: indexOscY.netDelta,
    },
    palmRotation: {
      isRotating: normalDelta >= 0.55 || angleDeltaDeg >= 38,
      normalDelta: Number(normalDelta.toFixed(4)),
      angleDeltaDeg: Number(angleDeltaDeg.toFixed(2)),
    },
    templates: {
      Z: zMatch,
      J: jMatch,
    },
  };
}
