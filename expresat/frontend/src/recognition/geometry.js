/**
 * src/recognition/geometry.js — Funciones geométricas y matemáticas puras para manos MediaPipe (21 puntos)
 *
 * Sin dependencias de DOM, cámara ni React.
 * Todas las funciones operan sobre coordenadas 3D { x, y, z } e implementan
 * normalización por tamaño de mano (palmScale) y alineación rotacional en el plano XY.
 */

export const HAND_LANDMARKS = Object.freeze({
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
});

/**
 * Valida que un punto tenga coordenadas numéricas finitas.
 * @param {any} pt
 * @returns {boolean}
 */
export function isValidPoint(pt) {
  if (!pt || typeof pt !== 'object') return false;
  return Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z ?? 0);
}

/**
 * Valida que el arreglo de landmarks de mano tenga exactamente 21 puntos válidos
 * y que no sea ruido degenerado (puntos colapsados o dispersión absurda).
 * @param {Array<{x:number, y:number, z?:number}>} landmarks
 * @returns {boolean}
 */
export function isValidHandLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return false;
  for (let i = 0; i < 21; i++) {
    if (!isValidPoint(landmarks[i])) return false;
  }
  const scale = palmScale(landmarks);
  if (!Number.isFinite(scale) || scale < 0.015 || scale > 5.0) return false;

  // Verificar coherencia anatómica: ningún punto de la mano puede estar a > 4.5 veces palmScale de la muñeca
  // (rechaza ruido aleatorio uniforme o picos espurios)
  const wrist = landmarks[HAND_LANDMARKS.WRIST];
  for (let i = 1; i < 21; i++) {
    const d = distance3D(wrist, landmarks[i]) / scale;
    if (d > 4.2 || d < 0.05) {
      return false;
    }
  }

  // Verificar que los nudillos MCP (5, 9, 13, 17) guarden una progresión anatómica razonable
  const dIndexMiddleMcp =
    distance3D(landmarks[HAND_LANDMARKS.INDEX_MCP], landmarks[HAND_LANDMARKS.MIDDLE_MCP]) / scale;
  const dMiddleRingMcp =
    distance3D(landmarks[HAND_LANDMARKS.MIDDLE_MCP], landmarks[HAND_LANDMARKS.RING_MCP]) / scale;
  const dRingPinkyMcp =
    distance3D(landmarks[HAND_LANDMARKS.RING_MCP], landmarks[HAND_LANDMARKS.PINKY_MCP]) / scale;

  if (dIndexMiddleMcp > 1.2 || dMiddleRingMcp > 1.2 || dRingPinkyMcp > 1.2) {
    return false;
  }

  return true;
}

/**
 * Distancia euclidiana 3D entre dos puntos.
 */
export function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Distancia euclidiana 2D en el plano XY.
 */
export function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Escala de referencia de la palma: distancia 3D entre WRIST (0) y MIDDLE_MCP (9).
 */
export function palmScale(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length <= HAND_LANDMARKS.MIDDLE_MCP) return 0;
  const w = landmarks[HAND_LANDMARKS.WRIST];
  const m = landmarks[HAND_LANDMARKS.MIDDLE_MCP];
  if (!isValidPoint(w) || !isValidPoint(m)) return 0;
  return distance3D(w, m);
}

/**
 * Ángulo en grados [0, 180] entre dos vectores 3D.
 */
export function angleBetweenVectorsDeg(v1, v2) {
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const n1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
  const n2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
  if (n1 < 1e-6 || n2 < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Calcula el ángulo de articulación en grados en el vértice B formado por los segmentos BA y BC.
 * Un dedo completamente recto tiene un ángulo cercano a 180°; doblado tiene < 130°.
 */
export function jointAngleDeg(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };
  return angleBetweenVectorsDeg(v1, v2);
}

/**
 * Normaliza los 21 landmarks de una mano:
 * 1. Traslada el origen a WRIST (0).
 * 2. Escala todas las coordenadas dividiendo por `palmScale` (distancia WRIST -> MIDDLE_MCP = 1.0).
 * 3. Rota en el plano XY para que el vector WRIST (0) -> MIDDLE_MCP (9) apunte hacia (0, -1).
 *
 * Esto garantiza invariancia a traslación, escala (distancia a cámara) y rotación en el plano XY.
 *
 * @param {Array<{x:number, y:number, z?:number}>} landmarks
 * @returns {Array<{x:number, y:number, z:number}>|null}
 */
export function normalizeHand(landmarks) {
  if (!isValidHandLandmarks(landmarks)) return null;

  const wrist = landmarks[HAND_LANDMARKS.WRIST];
  const scale = palmScale(landmarks);

  // Trasladar y escalar
  const scaled = landmarks.slice(0, 21).map((lm) => ({
    x: (lm.x - wrist.x) / scale,
    y: (lm.y - wrist.y) / scale,
    z: ((lm.z ?? 0) - (wrist.z ?? 0)) / scale,
  }));

  // Ángulo actual del eje de la palma (WRIST -> MIDDLE_MCP) en el plano XY
  // Queremos rotarlo para que quede alineado con el eje -Y (x = 0, y = -1), cuyo ángulo es -PI/2.
  const midMcp = scaled[HAND_LANDMARKS.MIDDLE_MCP];
  const currentAngle = Math.atan2(midMcp.y, midMcp.x);
  const targetAngle = -Math.PI / 2;
  const deltaAngle = targetAngle - currentAngle;
  const cosA = Math.cos(deltaAngle);
  const sinA = Math.sin(deltaAngle);

  return scaled.map((p) => ({
    x: p.x * cosA - p.y * sinA,
    y: p.x * sinA + p.y * cosA,
    z: p.z,
  }));
}

/**
 * Evalúa si un dedo no-pulgar está extendido combinando:
 * - Razón de distancias radiales a la muñeca (`tipDist / pipDist` y `tipDist / mcpDist`)
 * - Ángulo articular en PIP (`jointAngleDeg(MCP, PIP, DIP)`) y DIP (`jointAngleDeg(PIP, DIP, TIP)`)
 * Completamente invariante a escala y rotación 3D.
 */
function evaluateFinger(normLandmarks, mcpIdx, pipIdx, dipIdx, tipIdx) {
  const wrist = normLandmarks[HAND_LANDMARKS.WRIST];
  const mcp = normLandmarks[mcpIdx];
  const pip = normLandmarks[pipIdx];
  const dip = normLandmarks[dipIdx];
  const tip = normLandmarks[tipIdx];

  const distMcp = distance3D(wrist, mcp);
  const distPip = distance3D(wrist, pip);
  const distTip = distance3D(wrist, tip);

  const pipAngle = jointAngleDeg(mcp, pip, dip);
  const dipAngle = jointAngleDeg(pip, dip, tip);

  // Un dedo extendido tiene articulación PIP abierta (> 135°) y su punta más lejos de la muñeca que PIP y MCP
  const extended =
    pipAngle >= 135 &&
    dipAngle >= 130 &&
    distTip > distPip * 1.08 &&
    distTip > distMcp * 1.25;

  const curled = pipAngle < 120 || distTip < distPip * 1.02;

  return {
    extended,
    curled,
    pipAngle,
    dipAngle,
    tipToWrist: distTip,
  };
}

/**
 * Calcula el estado geométrico detallado de los 5 dedos y relaciones inter-digitales.
 * Es invariante a escala, traslación y rotación en el plano XY.
 *
 * @param {Array<{x:number, y:number, z?:number}>} landmarks
 * @returns {Object|null}
 */
export function fingerStates(landmarks) {
  const norm = normalizeHand(landmarks);
  if (!norm) return null;

  const scale = palmScale(landmarks);
  const wrist = norm[HAND_LANDMARKS.WRIST];

  // Evaluar los 4 dedos largos sobre las coordenadas normalizadas
  const indexInfo = evaluateFinger(
    norm,
    HAND_LANDMARKS.INDEX_MCP,
    HAND_LANDMARKS.INDEX_PIP,
    HAND_LANDMARKS.INDEX_DIP,
    HAND_LANDMARKS.INDEX_TIP
  );
  const middleInfo = evaluateFinger(
    norm,
    HAND_LANDMARKS.MIDDLE_MCP,
    HAND_LANDMARKS.MIDDLE_PIP,
    HAND_LANDMARKS.MIDDLE_DIP,
    HAND_LANDMARKS.MIDDLE_TIP
  );
  const ringInfo = evaluateFinger(
    norm,
    HAND_LANDMARKS.RING_MCP,
    HAND_LANDMARKS.RING_PIP,
    HAND_LANDMARKS.RING_DIP,
    HAND_LANDMARKS.RING_TIP
  );
  const pinkyInfo = evaluateFinger(
    norm,
    HAND_LANDMARKS.PINKY_MCP,
    HAND_LANDMARKS.PINKY_PIP,
    HAND_LANDMARKS.PINKY_DIP,
    HAND_LANDMARKS.PINKY_TIP
  );

  // Evaluar el pulgar:
  // En coordenadas normalizadas, el pulgar está extendido cuando:
  // 1. La articulación MCP/IP está recta (ángulo > 135°)
  // 2. La punta del pulgar (4) está alejada del nudillo del meñique (17) y del nudillo medio (9)
  const thumbCmc = norm[HAND_LANDMARKS.THUMB_CMC];
  const thumbMcp = norm[HAND_LANDMARKS.THUMB_MCP];
  const thumbIp = norm[HAND_LANDMARKS.THUMB_IP];
  const thumbTip = norm[HAND_LANDMARKS.THUMB_TIP];
  const indexMcp = norm[HAND_LANDMARKS.INDEX_MCP];
  const middleMcp = norm[HAND_LANDMARKS.MIDDLE_MCP];
  const pinkyMcp = norm[HAND_LANDMARKS.PINKY_MCP];

  const thumbMcpAngle = jointAngleDeg(thumbCmc, thumbMcp, thumbIp);
  const thumbIpAngle = jointAngleDeg(thumbMcp, thumbIp, thumbTip);
  const thumbToPinkyMcp = distance3D(thumbTip, pinkyMcp);
  const thumbToMiddleMcp = distance3D(thumbTip, middleMcp);
  const thumbToIndexMcp = distance3D(thumbTip, indexMcp);
  const thumbToWrist = distance3D(thumbTip, wrist);

  // Distancia entre la punta del pulgar (4) y la punta del índice (8) (para gesto OK / Pinza)
  const thumbIndexTipDist = distance3D(thumbTip, norm[HAND_LANDMARKS.INDEX_TIP]);

  // Si está haciendo pinza con el índice, el pulgar converge hacia el índice, no está "abierto libre"
  const isPinching = thumbIndexTipDist < 0.36;

  const thumbExtended =
    !isPinching &&
    thumbIpAngle >= 130 &&
    thumbMcpAngle >= 125 &&
    thumbToPinkyMcp > 0.88 &&
    thumbToMiddleMcp > 0.62 &&
    thumbToIndexMcp > 0.45 &&
    thumbToWrist > 0.75;

  const thumbCurled = !thumbExtended && !isPinching;

  // Ángulo entre el vector del pulgar (CMC -> TIP) y el vector del índice (MCP -> TIP)
  const vThumb = {
    x: thumbTip.x - thumbCmc.x,
    y: thumbTip.y - thumbCmc.y,
    z: thumbTip.z - thumbCmc.z,
  };
  const indexTip = norm[HAND_LANDMARKS.INDEX_TIP];
  const vIndex = {
    x: indexTip.x - indexMcp.x,
    y: indexTip.y - indexMcp.y,
    z: indexTip.z - indexMcp.z,
  };
  const thumbIndexAngleDeg = angleBetweenVectorsDeg(vThumb, vIndex);

  // Separación entre puntas de índice y medio (normalizada por palmScale)
  const indexMiddleSpread = distance3D(
    norm[HAND_LANDMARKS.INDEX_TIP],
    norm[HAND_LANDMARKS.MIDDLE_TIP]
  );

  const extendedCount =
    (thumbExtended ? 1 : 0) +
    (indexInfo.extended ? 1 : 0) +
    (middleInfo.extended ? 1 : 0) +
    (ringInfo.extended ? 1 : 0) +
    (pinkyInfo.extended ? 1 : 0);

  return {
    thumb: thumbExtended,
    index: indexInfo.extended,
    middle: middleInfo.extended,
    ring: ringInfo.extended,
    pinky: pinkyInfo.extended,
    extendedCount,
    isPinching,
    thumbIndexTipDist,
    thumbIndexAngleDeg,
    indexMiddleSpread,
    palmScale: scale,
    wristRaw: {
      x: landmarks[HAND_LANDMARKS.WRIST].x,
      y: landmarks[HAND_LANDMARKS.WRIST].y,
      z: landmarks[HAND_LANDMARKS.WRIST].z ?? 0,
    },
    details: {
      thumb: {
        extended: thumbExtended,
        curled: thumbCurled,
        mcpAngle: thumbMcpAngle,
        ipAngle: thumbIpAngle,
        toPinkyMcp: thumbToPinkyMcp,
        toMiddleMcp: thumbToMiddleMcp,
      },
      index: indexInfo,
      middle: middleInfo,
      ring: ringInfo,
      pinky: pinkyInfo,
    },
  };
}
