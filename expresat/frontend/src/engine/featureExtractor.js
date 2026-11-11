/**
 * src/engine/featureExtractor.js — ExpresaT: Extractor Canónico de Vectores 178D v1.2.1
 *
 * Implementación idéntica a expresat/models/feature_extractor.py y docs/dataset-generator/FEATURE_SPEC.md v1.2.1.
 * Paridad matemática demostrada con tolerancia <= 1e-6.
 *
 * Topología:
 *   - [0..51] Upper Pose (13 landmarks × 4 coords: x, y, z, visibility)
 *   - [52..114] Mano Izquierda (21 landmarks × 3 coords: x, y, z)
 *   - [115..177] Mano Derecha (21 landmarks × 3 coords: x, y, z)
 * Total: 178 features float32. Invariante de ventana: 15 frames × 178 features.
 */

export const FEATURE_SPEC_VERSION = '1.2.1';
export const TOTAL_FEATURES = 178;
export const SEQUENCE_LENGTH = 15;

export const POSE_UPPER_INDICES = Object.freeze([0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
export const POSE_COORDS = 4;
export const HAND_LANDMARKS = 21;
export const HAND_COORDS = 3;

export const SHOULDER_VIS_THRESH = 0.40;
export const SHOULDERS_D_MIN = 0.08;
export const HAND_DISCONNECTED_THRESH = 1.75;
export const HAND_AMBIGUITY_THRESH = 0.15;
export const MAX_GAP_MS = 100.0;

const POSE_BILATERAL_PAIRS = Object.freeze([
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
]);

const UPPER_BILATERAL_INDEX_PAIRS = Object.freeze([
  [1, 2],
  [3, 4],
  [5, 6],
  [7, 8],
  [9, 10],
  [11, 12],
]);

function getCategoryLabel(hItem) {
  if (Array.isArray(hItem) && hItem.length > 0) {
    return getCategoryLabel(hItem[0]);
  }
  if (hItem && typeof hItem === 'object') {
    return hItem.categoryName || hItem.label || hItem.displayName || null;
  }
  if (typeof hItem === 'string') {
    return hItem;
  }
  return null;
}

function getDetectedHandsAndLabels(rawFrame) {
  const hands = [];
  const labels = [];

  if (Array.isArray(rawFrame.hands)) {
    const handednessRaw = Array.isArray(rawFrame.handedness) ? rawFrame.handedness : [];
    for (let i = 0; i < rawFrame.hands.length; i++) {
      const h = rawFrame.hands[i];
      if (Array.isArray(h) && h.length > 0) {
        hands.push(h);
        const lbl = i < handednessRaw.length ? getCategoryLabel(handednessRaw[i]) : null;
        labels.push(lbl);
      }
    }
    return { hands, labels };
  }

  // Fallback a claves separadas leftHand / rightHand
  if (Array.isArray(rawFrame.leftHand) && rawFrame.leftHand.length > 0) {
    hands.push(rawFrame.leftHand);
    labels.push('Right'); // Mano izquierda del usuario -> 'Right' en MediaPipe
  }
  if (Array.isArray(rawFrame.rightHand) && rawFrame.rightHand.length > 0) {
    hands.push(rawFrame.rightHand);
    labels.push('Left'); // Mano derecha del usuario -> 'Left' en MediaPipe
  }

  return { hands, labels };
}

function handToFeatures(rawHand, D, Cx, Cy) {
  const out = new Float64Array(HAND_LANDMARKS * HAND_COORDS);
  if (!rawHand || rawHand.length === 0) return out;

  const zWrist = Number(rawHand[0]?.z ?? 0.0);
  const n = Math.min(HAND_LANDMARKS, rawHand.length);

  for (let i = 0; i < n; i++) {
    const lm = rawHand[i];
    const x = Number(lm.x ?? 0.0);
    const y = Number(lm.y ?? 0.0);
    const z = Number(lm.z ?? 0.0);
    out[i * 3 + 0] = (x - Cx) / D;
    out[i * 3 + 1] = (y - Cy) / D;
    out[i * 3 + 2] = (z - zWrist) / D;
  }
  return out;
}

function median(arr) {
  if (!arr || arr.length === 0) return 0.0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2.0;
}

/**
 * Extrae y normaliza un frame individual a 178 características Float32Array.
 * @param {Object} rawFrame Frame crudo con { pose, hands, handedness } o { pose, leftHand, rightHand }
 * @returns {{ features: Float32Array|null, valid: boolean, error: string|null }}
 */
export function extractFrameFeatures(rawFrame) {
  const pose = rawFrame?.pose;
  if (!Array.isArray(pose) || pose.length < 23) {
    return { features: null, valid: false, error: 'ERR_POSE_MISSING' };
  }

  const p11 = pose[11];
  const p12 = pose[12];
  const vis11 = Number(p11?.visibility ?? 1.0);
  const vis12 = Number(p12?.visibility ?? 1.0);
  if (vis11 < SHOULDER_VIS_THRESH || vis12 < SHOULDER_VIS_THRESH) {
    return { features: null, valid: false, error: 'ERR_SHOULDER_VISIBILITY' };
  }

  const x11 = Number(p11?.x ?? 0.0);
  const y11 = Number(p11?.y ?? 0.0);
  const x12 = Number(p12?.x ?? 0.0);
  const y12 = Number(p12?.y ?? 0.0);
  if (x11 < 0.0 || x11 > 1.0 || y11 < 0.0 || y11 > 1.0 || x12 < 0.0 || x12 > 1.0 || y12 < 0.0 || y12 > 1.0) {
    return { features: null, valid: false, error: 'ERR_OUT_OF_BOUNDS' };
  }

  const z11 = Number(p11?.z ?? 0.0);
  const z12 = Number(p12?.z ?? 0.0);
  const cx = (x11 + x12) / 2.0;
  const cy = (y11 + y12) / 2.0;
  const cz = (z11 + z12) / 2.0;

  const dx = x11 - x12;
  const dy = y11 - y12;
  const dz = z11 - z12;
  const D = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (D < SHOULDERS_D_MIN) {
    return { features: null, valid: false, error: 'ERR_SHOULDERS_TOO_SMALL' };
  }

  const features = new Float64Array(TOTAL_FEATURES);

  // Upper Pose [0..51]
  for (let i = 0; i < POSE_UPPER_INDICES.length; i++) {
    const pIdx = POSE_UPPER_INDICES[i];
    const lm = pose[pIdx];
    const px = Number(lm.x ?? 0.0);
    const py = Number(lm.y ?? 0.0);
    const pz = Number(lm.z ?? 0.0);
    const pvis = Number(lm.visibility ?? 1.0);

    features[i * 4 + 0] = (px - cx) / D;
    features[i * 4 + 1] = (py - cy) / D;
    features[i * 4 + 2] = (pz - cz) / D;
    features[i * 4 + 3] = Math.max(0.0, Math.min(1.0, pvis));
  }

  // Manos y asignación conjunta a P15 / P16
  const { hands: detectedHands, labels: detectedLabels } = getDetectedHandsAndLabels(rawFrame);

  const pw15X = Number(pose[15]?.x ?? 0.0);
  const pw15Y = Number(pose[15]?.y ?? 0.0);
  const pw15Vis = Number(pose[15]?.visibility ?? 1.0);

  const pw16X = Number(pose[16]?.x ?? 0.0);
  const pw16Y = Number(pose[16]?.y ?? 0.0);
  const pw16Vis = Number(pose[16]?.visibility ?? 1.0);

  const validHands = [];
  for (let i = 0; i < detectedHands.length; i++) {
    const h = detectedHands[i];
    const lbl = detectedLabels[i];
    const hwX = Number(h[0]?.x ?? 0.0);
    const hwY = Number(h[0]?.y ?? 0.0);
    const dLeft = Math.hypot(hwX - pw15X, hwY - pw15Y);
    const dRight = Math.hypot(hwX - pw16X, hwY - pw16Y);

    if (Math.min(dLeft, dRight) <= HAND_DISCONNECTED_THRESH * D) {
      validHands.push({ hand: h, label: lbl, dLeft, dRight });
    }
  }

  let assignedLeftHand = null;
  let assignedRightHand = null;

  if (validHands.length >= 2) {
    const h0 = validHands[0];
    const h1 = validHands[1];
    const costA = h0.dLeft + h1.dRight;
    const costB = h1.dLeft + h0.dRight;

    if (Math.abs(costA - costB) < HAND_AMBIGUITY_THRESH * D && (h0.label || h1.label)) {
      if (h0.label === 'Left' || h1.label === 'Right') {
        assignedLeftHand = h1.hand;
        assignedRightHand = h0.hand;
      } else {
        assignedLeftHand = h0.hand;
        assignedRightHand = h1.hand;
      }
    } else if (costA <= costB) {
      assignedLeftHand = h0.hand;
      assignedRightHand = h1.hand;
    } else {
      assignedLeftHand = h1.hand;
      assignedRightHand = h0.hand;
    }
  } else if (validHands.length === 1) {
    const h0 = validHands[0];
    const isAmbiguous =
      Math.abs(h0.dLeft - h0.dRight) < HAND_AMBIGUITY_THRESH * D ||
      pw15Vis < 0.50 ||
      pw16Vis < 0.50;

    if (isAmbiguous && (h0.label === 'Left' || h0.label === 'Right')) {
      if (h0.label === 'Left') {
        assignedRightHand = h0.hand;
      } else {
        assignedLeftHand = h0.hand;
      }
    } else {
      if (h0.dLeft < h0.dRight) {
        assignedLeftHand = h0.hand;
      } else {
        assignedRightHand = h0.hand;
      }
    }
  }

  if (assignedLeftHand) {
    const leftFeats = handToFeatures(assignedLeftHand, D, cx, cy);
    features.set(leftFeats, 52);
  } else {
    features.fill(0.0, 52, 115);
  }

  if (assignedRightHand) {
    const rightFeats = handToFeatures(assignedRightHand, D, cx, cy);
    features.set(rightFeats, 115);
  } else {
    features.fill(0.0, 115, 178);
  }

  return {
    features: new Float32Array(features),
    valid: true,
    error: null,
  };
}

/**
 * Secuencia estricta de ExtractWindow (Sección 5).
 * @param {Array<Object>} framesWithTimestamps Lista de frames con timestamp_ms
 * @param {Object} [options]
 * @param {number} [options.targetFps=15]
 * @param {number} [options.durationMs=1000]
 * @returns {{ tensor: Float32Array|null, valid: boolean, error: string|null }} Tensor de 15 * 178 floats
 */
export function extractWindow(framesWithTimestamps, options = {}) {
  if (!Array.isArray(framesWithTimestamps) || framesWithTimestamps.length === 0) {
    return { tensor: null, valid: false, error: 'ERR_POSE_MISSING' };
  }

  const durationMs = options.durationMs ?? 1000.0;
  const dtNominal = durationMs / SEQUENCE_LENGTH;

  // 1. Filtrar frames con hombros válidos
  const validFrames = [];
  for (const fr of framesWithTimestamps) {
    if (!fr?.pose || fr.pose.length < 23) continue;
    const p11 = fr.pose[11];
    const p12 = fr.pose[12];
    const v11 = Number(p11?.visibility ?? 1.0);
    const v12 = Number(p12?.visibility ?? 1.0);
    if (v11 < SHOULDER_VIS_THRESH || v12 < SHOULDER_VIS_THRESH) continue;
    const x11 = Number(p11?.x ?? 0.0);
    const y11 = Number(p11?.y ?? 0.0);
    const x12 = Number(p12?.x ?? 0.0);
    const y12 = Number(p12?.y ?? 0.0);
    if (x11 < 0.0 || x11 > 1.0 || y11 < 0.0 || y11 > 1.0 || x12 < 0.0 || x12 > 1.0 || y12 < 0.0 || y12 > 1.0) continue;
    validFrames.push(fr);
  }

  if (validFrames.length === 0) {
    return { tensor: null, valid: false, error: 'ERR_POSE_MISSING' };
  }

  validFrames.sort((a, b) => Number(a.timestamp_ms ?? 0) - Number(b.timestamp_ms ?? 0));

  // 2. Validación de brechas
  for (let i = 0; i < validFrames.length - 1; i++) {
    const tCurr = Number(validFrames[i].timestamp_ms ?? 0);
    const tNext = Number(validFrames[i + 1].timestamp_ms ?? 0);
    const gap = (tNext - tCurr) - dtNominal;
    if (gap > MAX_GAP_MS) {
      return { tensor: null, valid: false, error: 'ERR_INVALID_FRAME_GAP_TOO_LARGE' };
    }
  }

  const tStart = Number(validFrames[0].timestamp_ms ?? 0);

  // 3. Remuestreo temporal
  const resampled = [];
  for (let k = 0; k < SEQUENCE_LENGTH; k++) {
    const tTarget = tStart + k * dtNominal;

    let prevF = validFrames[0];
    let nextF = validFrames[validFrames.length - 1];

    for (const f of validFrames) {
      const ts = Number(f.timestamp_ms ?? 0);
      if (ts <= tTarget) prevF = f;
      if (ts >= tTarget) {
        nextF = f;
        break;
      }
    }

    const tPrev = Number(prevF.timestamp_ms ?? 0);
    const tNext = Number(nextF.timestamp_ms ?? 0);
    const tau = tPrev === tNext ? 0.0 : Math.max(0.0, Math.min(1.0, (tTarget - tPrev) / (tNext - tPrev)));

    // Pose interpolada
    const interpPose = [];
    const nPts = Math.min(prevF.pose.length, nextF.pose.length);
    for (let pI = 0; pI < nPts; pI++) {
      const lp = prevF.pose[pI];
      const ln = nextF.pose[pI];
      interpPose.push({
        x: (1.0 - tau) * Number(lp.x ?? 0.0) + tau * Number(ln.x ?? 0.0),
        y: (1.0 - tau) * Number(lp.y ?? 0.0) + tau * Number(ln.y ?? 0.0),
        z: (1.0 - tau) * Number(lp.z ?? 0.0) + tau * Number(ln.z ?? 0.0),
        visibility: (1.0 - tau) * Number(lp.visibility ?? 1.0) + tau * Number(ln.visibility ?? 1.0),
      });
    }

    // Manos interpoladas
    const hPrev = getDetectedHandsAndLabels(prevF);
    const hNext = getDetectedHandsAndLabels(nextF);
    let interpHands = [];
    let interpLabels = [];

    if (hPrev.hands.length === hNext.hands.length && hPrev.hands.length > 0) {
      for (let hIdx = 0; hIdx < hPrev.hands.length; hIdx++) {
        const hp = hPrev.hands[hIdx];
        const hn = hNext.hands[hIdx];
        const hPoints = [];
        const nPoints = Math.min(hp.length, hn.length);
        for (let ptI = 0; ptI < nPoints; ptI++) {
          hPoints.push({
            x: (1.0 - tau) * Number(hp[ptI].x ?? 0.0) + tau * Number(hn[ptI].x ?? 0.0),
            y: (1.0 - tau) * Number(hp[ptI].y ?? 0.0) + tau * Number(hn[ptI].y ?? 0.0),
            z: (1.0 - tau) * Number(hp[ptI].z ?? 0.0) + tau * Number(hn[ptI].z ?? 0.0),
          });
        }
        interpHands.push(hPoints);
        interpLabels.push(tau < 0.5 ? hPrev.labels[hIdx] : hNext.labels[hIdx]);
      }
    } else if (tau < 0.5 && hPrev.hands.length > 0) {
      interpHands = JSON.parse(JSON.stringify(hPrev.hands));
      interpLabels = [...hPrev.labels];
    } else if (tau >= 0.5 && hNext.hands.length > 0) {
      interpHands = JSON.parse(JSON.stringify(hNext.hands));
      interpLabels = [...hNext.labels];
    }

    resampled.push({
      pose: interpPose,
      hands: interpHands,
      handedness: interpLabels.map((lbl) => (lbl ? { categoryName: lbl } : {})),
      timestamp_ms: tTarget,
    });
  }

  // 4. Mediana de escala D y centro C por ventana
  const dPerFrame = [];
  const cxPerFrame = [];
  const cyPerFrame = [];
  const czPerFrame = [];

  for (const fr of resampled) {
    const p11 = fr.pose[11];
    const p12 = fr.pose[12];
    const x11 = Number(p11.x ?? 0.0);
    const y11 = Number(p11.y ?? 0.0);
    const z11 = Number(p11.z ?? 0.0);
    const x12 = Number(p12.x ?? 0.0);
    const y12 = Number(p12.y ?? 0.0);
    const z12 = Number(p12.z ?? 0.0);
    const dx = x11 - x12;
    const dy = y11 - y12;
    const dz = z11 - z12;
    dPerFrame.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
    cxPerFrame.push((x11 + x12) / 2.0);
    cyPerFrame.push((y11 + y12) / 2.0);
    czPerFrame.push((z11 + z12) / 2.0);
  }

  const dVentana = median(dPerFrame);
  const cxVentana = median(cxPerFrame);
  const cyVentana = median(cyPerFrame);
  const czVentana = median(czPerFrame);

  if (dVentana < SHOULDERS_D_MIN) {
    return { tensor: null, valid: false, error: 'ERR_SHOULDERS_TOO_SMALL' };
  }

  // 5. Filtro EMA temporal (alpha = 0.50)
  const alpha = 0.50;
  const smoothed = [];
  let prevPose = null;
  const prevHands = new Map();

  for (let k = 0; k < SEQUENCE_LENGTH; k++) {
    const fr = resampled[k];
    const currPose = fr.pose;
    const smoothPose = [];

    if (k === 0 || !prevPose) {
      for (const pt of currPose) smoothPose.push({ ...pt });
    } else {
      for (let ptI = 0; ptI < currPose.length; ptI++) {
        const c = currPose[ptI];
        const p = prevPose[ptI];
        smoothPose.push({
          x: alpha * Number(c.x ?? 0.0) + (1.0 - alpha) * Number(p.x ?? 0.0),
          y: alpha * Number(c.y ?? 0.0) + (1.0 - alpha) * Number(p.y ?? 0.0),
          z: alpha * Number(c.z ?? 0.0) + (1.0 - alpha) * Number(p.z ?? 0.0),
          visibility: Number(c.visibility ?? 1.0),
        });
      }
    }
    prevPose = smoothPose;

    const smoothHands = [];
    for (let hI = 0; hI < fr.hands.length; hI++) {
      const h = fr.hands[hI];
      const prevH = prevHands.get(hI);
      if (!prevH || prevH.length !== h.length) {
        smoothHands.push(JSON.parse(JSON.stringify(h)));
      } else {
        const hSmooth = [];
        for (let ptI = 0; ptI < h.length; ptI++) {
          const c = h[ptI];
          const p = prevH[ptI];
          hSmooth.push({
            x: alpha * Number(c.x ?? 0.0) + (1.0 - alpha) * Number(p.x ?? 0.0),
            y: alpha * Number(c.y ?? 0.0) + (1.0 - alpha) * Number(p.y ?? 0.0),
            z: alpha * Number(c.z ?? 0.0) + (1.0 - alpha) * Number(p.z ?? 0.0),
          });
        }
        smoothHands.push(hSmooth);
      }
      prevHands.set(hI, smoothHands[smoothHands.length - 1]);
    }

    // Cleanup absent hands
    for (const oldKey of prevHands.keys()) {
      if (oldKey >= fr.hands.length) {
        prevHands.delete(oldKey);
      }
    }

    smoothed.push({
      pose: smoothPose,
      hands: smoothHands,
      handedness: fr.handedness,
      timestamp_ms: fr.timestamp_ms,
    });
  }

  // 6. Normalización y Ensamble (15 frames x 178 features)
  const tensor = new Float32Array(SEQUENCE_LENGTH * TOTAL_FEATURES);

  for (let k = 0; k < SEQUENCE_LENGTH; k++) {
    const fr = smoothed[k];
    const offset = k * TOTAL_FEATURES;

    // Upper pose
    for (let i = 0; i < POSE_UPPER_INDICES.length; i++) {
      const pIdx = POSE_UPPER_INDICES[i];
      const lm = fr.pose[pIdx];
      tensor[offset + i * 4 + 0] = (Number(lm.x ?? 0.0) - cxVentana) / dVentana;
      tensor[offset + i * 4 + 1] = (Number(lm.y ?? 0.0) - cyVentana) / dVentana;
      tensor[offset + i * 4 + 2] = (Number(lm.z ?? 0.0) - czVentana) / dVentana;
      tensor[offset + i * 4 + 3] = Math.max(0.0, Math.min(1.0, Number(lm.visibility ?? 1.0)));
    }

    // Manos
    const { hands: detectedHands, labels: detectedLabels } = getDetectedHandsAndLabels(fr);
    const pw15X = Number(fr.pose[15]?.x ?? 0.0);
    const pw15Y = Number(fr.pose[15]?.y ?? 0.0);
    const pw15Vis = Number(fr.pose[15]?.visibility ?? 1.0);
    const pw16X = Number(fr.pose[16]?.x ?? 0.0);
    const pw16Y = Number(fr.pose[16]?.y ?? 0.0);
    const pw16Vis = Number(fr.pose[16]?.visibility ?? 1.0);

    const validHands = [];
    for (let i = 0; i < detectedHands.length; i++) {
      const h = detectedHands[i];
      const lbl = detectedLabels[i];
      const hwX = Number(h[0]?.x ?? 0.0);
      const hwY = Number(h[0]?.y ?? 0.0);
      const dLeft = Math.hypot(hwX - pw15X, hwY - pw15Y);
      const dRight = Math.hypot(hwX - pw16X, hwY - pw16Y);
      if (Math.min(dLeft, dRight) <= HAND_DISCONNECTED_THRESH * dVentana) {
        validHands.push({ hand: h, label: lbl, dLeft, dRight });
      }
    }

    let assignedLeft = null;
    let assignedRight = null;

    if (validHands.length >= 2) {
      const h0 = validHands[0];
      const h1 = validHands[1];
      const costA = h0.dLeft + h1.dRight;
      const costB = h1.dLeft + h0.dRight;
      if (Math.abs(costA - costB) < HAND_AMBIGUITY_THRESH * dVentana && (h0.label || h1.label)) {
        if (h0.label === 'Left' || h1.label === 'Right') {
          assignedLeft = h1.hand;
          assignedRight = h0.hand;
        } else {
          assignedLeft = h0.hand;
          assignedRight = h1.hand;
        }
      } else if (costA <= costB) {
        assignedLeft = h0.hand;
        assignedRight = h1.hand;
      } else {
        assignedLeft = h1.hand;
        assignedRight = h0.hand;
      }
    } else if (validHands.length === 1) {
      const h0 = validHands[0];
      const isAmb =
        Math.abs(h0.dLeft - h0.dRight) < HAND_AMBIGUITY_THRESH * dVentana ||
        pw15Vis < 0.50 ||
        pw16Vis < 0.50;

      if (isAmb && (h0.label === 'Left' || h0.label === 'Right')) {
        if (h0.label === 'Left') {
          assignedRight = h0.hand;
        } else {
          assignedLeft = h0.hand;
        }
      } else {
        if (h0.dLeft < h0.dRight) {
          assignedLeft = h0.hand;
        } else {
          assignedRight = h0.hand;
        }
      }
    }

    if (assignedLeft) {
      const lf = handToFeatures(assignedLeft, dVentana, cxVentana, cyVentana);
      tensor.set(lf, offset + 52);
    } else {
      tensor.fill(0.0, offset + 52, offset + 115);
    }

    if (assignedRight) {
      const rf = handToFeatures(assignedRight, dVentana, cxVentana, cyVentana);
      tensor.set(rf, offset + 115);
    } else {
      tensor.fill(0.0, offset + 115, offset + 178);
    }
  }

  return { tensor, valid: true, error: null };
}

/**
 * Espeja landmarks crudos (espacio [0, 1]).
 */
export function mirrorRawFrame(rawFrame) {
  const mirrored = JSON.parse(JSON.stringify(rawFrame));

  if (Array.isArray(mirrored.pose)) {
    for (const lm of mirrored.pose) {
      if (lm && typeof lm.x === 'number') {
        lm.x = 1.0 - lm.x;
      }
    }
    for (const [idxL, idxR] of POSE_BILATERAL_PAIRS) {
      if (idxL < mirrored.pose.length && idxR < mirrored.pose.length) {
        const tmp = mirrored.pose[idxL];
        mirrored.pose[idxL] = mirrored.pose[idxR];
        mirrored.pose[idxR] = tmp;
      }
    }
  }

  if (Array.isArray(mirrored.hands)) {
    for (const h of mirrored.hands) {
      if (Array.isArray(h)) {
        for (const lm of h) {
          if (lm && typeof lm.x === 'number') {
            lm.x = 1.0 - lm.x;
          }
        }
      }
    }
  }

  for (const k of ['leftHand', 'rightHand']) {
    if (Array.isArray(mirrored[k])) {
      for (const lm of mirrored[k]) {
        if (lm && typeof lm.x === 'number') {
          lm.x = 1.0 - lm.x;
        }
      }
    }
  }

  if (Array.isArray(mirrored.handedness)) {
    for (const item of mirrored.handedness) {
      if (Array.isArray(item)) {
        for (const entry of item) {
          if (entry && typeof entry.categoryName === 'string') {
            entry.categoryName = entry.categoryName === 'Left' ? 'Right' : (entry.categoryName === 'Right' ? 'Left' : entry.categoryName);
          }
        }
      } else if (item && typeof item.categoryName === 'string') {
        item.categoryName = item.categoryName === 'Left' ? 'Right' : (item.categoryName === 'Right' ? 'Left' : item.categoryName);
      }
    }
  }

  return mirrored;
}

/**
 * Espeja analíticamente un vector de 178 features ya normalizado.
 * @param {Float32Array|Array<number>} features Vector 178D
 * @returns {Float32Array}
 */
export function mirrorFeatures178(features) {
  const out = new Float64Array(features);

  // Upper pose nariz
  out[0] = -out[0];

  // Upper pose pares bilaterales
  for (const [idxL, idxR] of UPPER_BILATERAL_INDEX_PAIRS) {
    const startL = idxL * 4;
    const startR = idxR * 4;

    const bL = out.slice(startL, startL + 4);
    const bR = out.slice(startR, startR + 4);

    bL[0] = -bL[0];
    bR[0] = -bR[0];

    out.set(bR, startL);
    out.set(bL, startR);
  }

  // Manos: swap e inversión de x
  const leftHand = out.slice(52, 115);
  const rightHand = out.slice(115, 178);

  for (let i = 0; i < HAND_LANDMARKS; i++) {
    leftHand[i * 3 + 0] = -leftHand[i * 3 + 0];
    rightHand[i * 3 + 0] = -rightHand[i * 3 + 0];
  }

  out.set(rightHand, 52);
  out.set(leftHand, 115);

  return new Float32Array(out);
}
