/**
 * src/engine/featureExtractor.js — ExpresaT: Extractor Canónico de Vectores 178D v1.2.2
 *
 * Implementación idéntica a expresat/models/feature_extractor.py y docs/dataset-generator/FEATURE_SPEC.md v1.2.2.
 * Paridad matemática demostrada con tolerancia L_inf <= 1e-6.
 *
 * Topología:
 *   - [0..51] Upper Pose (13 landmarks × 4 coords: x, y, z, visibility)
 *   - [52..114] Mano Izquierda (21 landmarks × 3 coords: x, y, z)
 *   - [115..177] Mano Derecha (21 landmarks × 3 coords: x, y, z)
 * Total: 178 features float32. Invariante de ventana: 15 frames × 178 features.
 *
 * Secuencia estricta de ExtractWindow:
 *   1. Validar hombros crudos y brechas (gap <= 100 ms)
 *   2. Asignar manos por frame crudo (costo conjunto + etiquetas + continuidad temporal)
 *   3. Remuestrear temporalmente por bloque a 15 frames (Δt = 66.67 ms)
 *   4. D_ventana y C_ventana (mediana de 15 frames, D >= 0.08)
 *   5. Filtro EMA temporal por bloque (α = 0.50, reinicio por bloque independiente)
 *   6. Normalizar hombros y muñeca Z -> Tensor (1, 15, 178) float32
 */

export const FEATURE_SPEC_VERSION = '1.3.0';
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
export const POSE_WRIST_MIN_VIS = 0.50;
export const MAX_GAP_MS = 100.0;

// Pesos para asignación de manos en unidades de D (FEATURE_SPEC v1.3.0)
export const WEIGHT_LABEL_PENALTY = 0.25;
export const WEIGHT_TEMPORAL_CONTINUITY = 0.50;

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
      if (h && typeof h === 'object' && Array.isArray(h.landmarks)) {
        hands.push(h.landmarks);
        labels.push(h.categoryName || h.label || null);
      } else if (Array.isArray(h) && h.length > 0) {
        hands.push(h);
        const lbl = i < handednessRaw.length ? getCategoryLabel(handednessRaw[i]) : null;
        labels.push(lbl);
      }
    }
    return { hands, labels };
  }

  if (Array.isArray(rawFrame.leftHand) && rawFrame.leftHand.length > 0) {
    hands.push(rawFrame.leftHand);
    labels.push('Right');
  }
  if (Array.isArray(rawFrame.rightHand) && rawFrame.rightHand.length > 0) {
    hands.push(rawFrame.rightHand);
    labels.push('Left');
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
 * Asigna las manos detectadas en un frame a { assignedLeftHand, assignedRightHand, isAmbiguous }.
 */
export function assignHandsToAnatomicalSlots(
  rawFrame,
  pose,
  D,
  prevLeftWrist = null,
  prevRightWrist = null
) {
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

    const closerWristVis = dLeft <= dRight ? pw15Vis : pw16Vis;
    const isDisconnected = Math.min(dLeft, dRight) > HAND_DISCONNECTED_THRESH * D && closerWristVis >= POSE_WRIST_MIN_VIS;

    if (!isDisconnected) {
      validHands.push({ hand: h, label: lbl, dLeft, dRight, hwX, hwY });
    }
  }

  let assignedLeftHand = null;
  let assignedRightHand = null;
  let isAmbiguous = false;

  if (validHands.length >= 2) {
    const h0 = validHands[0];
    const h1 = validHands[1];

    const costA = h0.dLeft + h1.dRight;
    const costB = h1.dLeft + h0.dRight;

    let penaltyA = 0.0;
    let penaltyB = 0.0;

    if (h0.label === 'Left') penaltyA += WEIGHT_LABEL_PENALTY * D;
    else if (h0.label === 'Right') penaltyB += WEIGHT_LABEL_PENALTY * D;

    if (h1.label === 'Left') penaltyB += WEIGHT_LABEL_PENALTY * D;
    else if (h1.label === 'Right') penaltyA += WEIGHT_LABEL_PENALTY * D;

    if (prevLeftWrist && prevRightWrist) {
      const cTempA =
        Math.hypot(h0.hwX - prevLeftWrist[0], h0.hwY - prevLeftWrist[1]) +
        Math.hypot(h1.hwX - prevRightWrist[0], h1.hwY - prevRightWrist[1]);
      const cTempB =
        Math.hypot(h1.hwX - prevLeftWrist[0], h1.hwY - prevLeftWrist[1]) +
        Math.hypot(h0.hwX - prevRightWrist[0], h0.hwY - prevRightWrist[1]);
      penaltyA += WEIGHT_TEMPORAL_CONTINUITY * cTempA;
      penaltyB += WEIGHT_TEMPORAL_CONTINUITY * cTempB;
    }

    const totalCostA = costA + penaltyA;
    const totalCostB = costB + penaltyB;

    if (Math.abs(totalCostA - totalCostB) < HAND_AMBIGUITY_THRESH * D) {
      isAmbiguous = true;
    }

    if (totalCostA <= totalCostB) {
      assignedLeftHand = h0.hand;
      assignedRightHand = h1.hand;
    } else {
      assignedLeftHand = h1.hand;
      assignedRightHand = h0.hand;
    }
  } else if (validHands.length === 1) {
    const h0 = validHands[0];
    const ambigCond =
      Math.abs(h0.dLeft - h0.dRight) < HAND_AMBIGUITY_THRESH * D ||
      pw15Vis < POSE_WRIST_MIN_VIS ||
      pw16Vis < POSE_WRIST_MIN_VIS;

    if (ambigCond) {
      isAmbiguous = true;
    }

    if (h0.label === 'Left') {
      assignedRightHand = h0.hand;
    } else if (h0.label === 'Right') {
      assignedLeftHand = h0.hand;
    } else if (prevLeftWrist || prevRightWrist) {
      const distPrevL = prevLeftWrist ? Math.hypot(h0.hwX - prevLeftWrist[0], h0.hwY - prevLeftWrist[1]) : Infinity;
      const distPrevR = prevRightWrist ? Math.hypot(h0.hwX - prevRightWrist[0], h0.hwY - prevRightWrist[1]) : Infinity;
      if (distPrevL <= distPrevR) {
        assignedLeftHand = h0.hand;
      } else {
        assignedRightHand = h0.hand;
      }
    } else {
      if (h0.dLeft <= h0.dRight) {
        assignedLeftHand = h0.hand;
      } else {
        assignedRightHand = h0.hand;
      }
    }
  }

  return { assignedLeftHand, assignedRightHand, isAmbiguous };
}

/**
 * Extrae y normaliza un frame individual a 178 características Float32Array.
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

  // Asignación de manos
  const { assignedLeftHand, assignedRightHand } = assignHandsToAnatomicalSlots(rawFrame, pose, D);

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
 * Secuencia estricta por bloques de ExtractWindow v1.2.2.
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

  validFrames.sort((a, b) => Number(a.t_ms ?? a.timestamp_ms ?? 0) - Number(b.t_ms ?? b.timestamp_ms ?? 0));

  // Validación de brechas (gap <= 100 ms)
  for (let i = 0; i < validFrames.length - 1; i++) {
    const tCurr = Number(validFrames[i].t_ms ?? validFrames[i].timestamp_ms ?? 0);
    const tNext = Number(validFrames[i + 1].t_ms ?? validFrames[i + 1].timestamp_ms ?? 0);
    const gap = (tNext - tCurr) - dtNominal;
    if (gap > MAX_GAP_MS) {
      return { tensor: null, valid: false, error: 'ERR_INVALID_FRAME_GAP_TOO_LARGE' };
    }
  }

  // 2. Asignar manos por frame crudo (desacoplamiento anatómico)
  const framesWithBlocks = [];
  let prevLeftW = null;
  let prevRightW = null;

  for (const fr of validFrames) {
    const pose = fr.pose;
    const p11 = pose[11];
    const p12 = pose[12];
    const dx = Number(p11.x ?? 0.0) - Number(p12.x ?? 0.0);
    const dy = Number(p11.y ?? 0.0) - Number(p12.y ?? 0.0);
    const dz = Number(p11.z ?? 0.0) - Number(p12.z ?? 0.0);
    const dFrame = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const { assignedLeftHand, assignedRightHand } = assignHandsToAnatomicalSlots(
      fr,
      pose,
      dFrame,
      prevLeftW,
      prevRightW
    );

    if (assignedLeftHand) {
      prevLeftW = [Number(assignedLeftHand[0]?.x ?? 0.0), Number(assignedLeftHand[0]?.y ?? 0.0)];
    }
    if (assignedRightHand) {
      prevRightW = [Number(assignedRightHand[0]?.x ?? 0.0), Number(assignedRightHand[0]?.y ?? 0.0)];
    }

    framesWithBlocks.push({
      pose: JSON.parse(JSON.stringify(pose)),
      leftHand: assignedLeftHand ? JSON.parse(JSON.stringify(assignedLeftHand)) : null,
      rightHand: assignedRightHand ? JSON.parse(JSON.stringify(assignedRightHand)) : null,
      timestamp_ms: Number(fr.t_ms ?? fr.timestamp_ms ?? 0),
    });
  }

  const tStart = framesWithBlocks[0].timestamp_ms;

  // 3. Remuestreo temporal por bloque anatómico
  const resampledBlocks = [];
  for (let k = 0; k < SEQUENCE_LENGTH; k++) {
    const tTarget = tStart + k * dtNominal;

    let prevF = framesWithBlocks[0];
    let nextF = framesWithBlocks[framesWithBlocks.length - 1];

    for (const f of framesWithBlocks) {
      const ts = f.timestamp_ms;
      if (ts <= tTarget) prevF = f;
      if (ts >= tTarget) {
        nextF = f;
        break;
      }
    }

    const tPrev = prevF.timestamp_ms;
    const tNext = nextF.timestamp_ms;
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

    // Bloque Mano Izquierda interpolado
    let interpLH = null;
    if (prevF.leftHand && nextF.leftHand) {
      interpLH = [];
      const nPtsH = Math.min(prevF.leftHand.length, nextF.leftHand.length);
      for (let i = 0; i < nPtsH; i++) {
        interpLH.push({
          x: (1.0 - tau) * Number(prevF.leftHand[i].x ?? 0.0) + tau * Number(nextF.leftHand[i].x ?? 0.0),
          y: (1.0 - tau) * Number(prevF.leftHand[i].y ?? 0.0) + tau * Number(nextF.leftHand[i].y ?? 0.0),
          z: (1.0 - tau) * Number(prevF.leftHand[i].z ?? 0.0) + tau * Number(nextF.leftHand[i].z ?? 0.0),
        });
      }
    } else if (tau < 0.5 && prevF.leftHand) {
      interpLH = JSON.parse(JSON.stringify(prevF.leftHand));
    } else if (tau >= 0.5 && nextF.leftHand) {
      interpLH = JSON.parse(JSON.stringify(nextF.leftHand));
    }

    // Bloque Mano Derecha interpolado
    let interpRH = null;
    if (prevF.rightHand && nextF.rightHand) {
      interpRH = [];
      const nPtsH = Math.min(prevF.rightHand.length, nextF.rightHand.length);
      for (let i = 0; i < nPtsH; i++) {
        interpRH.push({
          x: (1.0 - tau) * Number(prevF.rightHand[i].x ?? 0.0) + tau * Number(nextF.rightHand[i].x ?? 0.0),
          y: (1.0 - tau) * Number(prevF.rightHand[i].y ?? 0.0) + tau * Number(nextF.rightHand[i].y ?? 0.0),
          z: (1.0 - tau) * Number(prevF.rightHand[i].z ?? 0.0) + tau * Number(nextF.rightHand[i].z ?? 0.0),
        });
      }
    } else if (tau < 0.5 && prevF.rightHand) {
      interpRH = JSON.parse(JSON.stringify(prevF.rightHand));
    } else if (tau >= 0.5 && nextF.rightHand) {
      interpRH = JSON.parse(JSON.stringify(nextF.rightHand));
    }

    resampledBlocks.push({
      pose: interpPose,
      leftHand: interpLH,
      rightHand: interpRH,
      timestamp_ms: tTarget,
    });
  }

  // 4. Mediana de escala D y centro C por ventana
  const dPerFrame = [];
  const cxPerFrame = [];
  const cyPerFrame = [];
  const czPerFrame = [];

  for (const fr of resampledBlocks) {
    const p11 = fr.pose[11];
    const p12 = fr.pose[12];
    const dx = Number(p11.x ?? 0.0) - Number(p12.x ?? 0.0);
    const dy = Number(p11.y ?? 0.0) - Number(p12.y ?? 0.0);
    const dz = Number(p11.z ?? 0.0) - Number(p12.z ?? 0.0);
    dPerFrame.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
    cxPerFrame.push((Number(p11.x ?? 0.0) + Number(p12.x ?? 0.0)) / 2.0);
    cyPerFrame.push((Number(p11.y ?? 0.0) + Number(p12.y ?? 0.0)) / 2.0);
    czPerFrame.push((Number(p11.z ?? 0.0) + Number(p12.z ?? 0.0)) / 2.0);
  }

  const dVentana = median(dPerFrame);
  const cxVentana = median(cxPerFrame);
  const cyVentana = median(cyPerFrame);
  const czVentana = median(czPerFrame);

  if (dVentana < SHOULDERS_D_MIN) {
    return { tensor: null, valid: false, error: 'ERR_SHOULDERS_TOO_SMALL' };
  }

  // 5. Filtro EMA temporal por bloque (alpha = 0.50)
  const alpha = 0.50;
  const smoothed = [];
  let prevPose = null;
  let prevLH = null;
  let prevRH = null;

  for (let k = 0; k < SEQUENCE_LENGTH; k++) {
    const fr = resampledBlocks[k];

    // Pose
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

    // Mano Izquierda
    let smoothLH = null;
    if (fr.leftHand) {
      if (!prevLH || prevLH.length !== fr.leftHand.length) {
        smoothLH = JSON.parse(JSON.stringify(fr.leftHand)); // Reinicio al reaparecer
      } else {
        smoothLH = [];
        for (let i = 0; i < fr.leftHand.length; i++) {
          smoothLH.push({
            x: alpha * Number(fr.leftHand[i].x ?? 0.0) + (1.0 - alpha) * Number(prevLH[i].x ?? 0.0),
            y: alpha * Number(fr.leftHand[i].y ?? 0.0) + (1.0 - alpha) * Number(prevLH[i].y ?? 0.0),
            z: alpha * Number(fr.leftHand[i].z ?? 0.0) + (1.0 - alpha) * Number(prevLH[i].z ?? 0.0),
          });
        }
      }
    }
    prevLH = smoothLH;

    // Mano Derecha
    let smoothRH = null;
    if (fr.rightHand) {
      if (!prevRH || prevRH.length !== fr.rightHand.length) {
        smoothRH = JSON.parse(JSON.stringify(fr.rightHand)); // Reinicio al reaparecer
      } else {
        smoothRH = [];
        for (let i = 0; i < fr.rightHand.length; i++) {
          smoothRH.push({
            x: alpha * Number(fr.rightHand[i].x ?? 0.0) + (1.0 - alpha) * Number(prevRH[i].x ?? 0.0),
            y: alpha * Number(fr.rightHand[i].y ?? 0.0) + (1.0 - alpha) * Number(prevRH[i].y ?? 0.0),
            z: alpha * Number(fr.rightHand[i].z ?? 0.0) + (1.0 - alpha) * Number(prevRH[i].z ?? 0.0),
          });
        }
      }
    }
    prevRH = smoothRH;

    smoothed.push({
      pose: smoothPose,
      leftHand: smoothLH,
      rightHand: smoothRH,
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

    // Mano Izquierda
    if (fr.leftHand) {
      const lf = handToFeatures(fr.leftHand, dVentana, cxVentana, cyVentana);
      tensor.set(lf, offset + 52);
    } else {
      tensor.fill(0.0, offset + 52, offset + 115);
    }

    // Mano Derecha
    if (fr.rightHand) {
      const rf = handToFeatures(fr.rightHand, dVentana, cxVentana, cyVentana);
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
 */
export function mirrorFeatures178(features) {
  const out = new Float64Array(features);

  out[0] = -out[0];

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

/**
 * Calcula el hash de configuración canónico (equivalente a Python compute_config_hash).
 * @param {string} fixturesSha256 Digest SHA256 de feature_spec_cases.json
 * @returns {string} Objeto serializado en JSON canónico para validación de contrato
 */
export function getCanonicalConfigObject(fixturesSha256) {
  return {
    duration_ms: 1000.0,
    feature_spec_version: FEATURE_SPEC_VERSION,
    fixtures_sha256: fixturesSha256,
    sequence_length: SEQUENCE_LENGTH,
    shoulders_d_min: SHOULDERS_D_MIN,
    target_fps: 15,
    total_features: TOTAL_FEATURES,
    weight_label_penalty: WEIGHT_LABEL_PENALTY,
    weight_temporal_continuity: WEIGHT_TEMPORAL_CONTINUITY,
  };
}
