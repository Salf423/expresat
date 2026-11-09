/**
 * src/recognition/geometry.js — Funciones geométricas y matemáticas puras para manos MediaPipe (21 puntos)
 *
 * Sin dependencias de DOM, cámara ni React.
 * Todas las funciones operan sobre coordenadas 3D { x, y, z } e implementan:
 * - Normalización por tamaño de mano (palmScale) y alineación rotacional en el plano XY.
 * - Conservación de la orientación 2D original de la mano (UP, DOWN, HORIZONTAL, OBLIQUE).
 * - Detección de palma vs. dorso (FRONT, BACK, SIDE) por producto cruzado 3D + handedness.
 * - Sistema canónico quiral (invariante a mano izquierda/derecha y espejo de video).
 * - Estados de flexión tri-valuados (EXTENDED, HOOKED, CURLED) y matriz de contactos inter-digitales.
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

  // Verificar coherencia anatómica: ningún punto de la mano puede estar a > 4.2 veces palmScale de la muñeca
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
 * Distancia robusta con peso reducido en Z (Limitación 6: ruido monocular en Z).
 * @param {{x:number,y:number,z?:number}} a
 * @param {{x:number,y:number,z?:number}} b
 * @param {number} [zWeight=0.35]
 */
export function distanceRobust(a, b, zWeight = 0.35) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = ((a.z ?? 0) - (b.z ?? 0)) * zWeight;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  const dot = v1.x * v2.x + v1.y * v2.y + (v1.z ?? 0) * (v2.z ?? 0);
  const n1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + (v1.z ?? 0) * (v1.z ?? 0));
  const n2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + (v2.z ?? 0) * (v2.z ?? 0));
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
 * Extrae la orientación original de la mano antes de rotar en XY y la dirección de la palma
 * (FRONT, BACK, SIDE) usando el producto cruzado de los vectores de la palma y handedness.
 *
 * @param {Array<{x:number, y:number, z?:number}>} landmarks Landmarks crudos
 * @param {Array<{x:number, y:number, z:number}>} normLandmarks Landmarks normalizados por normalizeHand
 * @param {Object} [options]
 * @param {'Right'|'Left'|null} [options.handedness=null] Mano anatómica ('Right' por defecto)
 */
export function extractHandOrientation(landmarks, normLandmarks, options = {}) {
  const wrist = landmarks[HAND_LANDMARKS.WRIST];
  const midMcp = landmarks[HAND_LANDMARKS.MIDDLE_MCP];
  const dx = midMcp.x - wrist.x;
  const dy = midMcp.y - wrist.y;

  // En coordenadas de imagen (+Y hacia abajo):
  // -90° = apuntando hacia arriba (UP)
  // +90° = apuntando hacia abajo (DOWN)
  //   0° o ±180° = apuntando horizontalmente de lado (HORIZONTAL)
  const palmAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  let direction = 'OBLIQUE';
  if (palmAngleDeg >= -125 && palmAngleDeg <= -55) {
    direction = 'UP';
  } else if (palmAngleDeg >= 55 && palmAngleDeg <= 125) {
    direction = 'DOWN';
  } else if (Math.abs(palmAngleDeg) <= 25 || Math.abs(palmAngleDeg) >= 155) {
    direction = 'HORIZONTAL';
  }

  // Producto cruzado 3D de los vectores de la palma en coordenadas normalizadas:
  // u = INDEX_MCP (5) - WRIST (0), v = PINKY_MCP (17) - WRIST (0)
  const u = normLandmarks[HAND_LANDMARKS.INDEX_MCP];
  const v = normLandmarks[HAND_LANDMARKS.PINKY_MCP];
  const crossZ = u.x * v.y - u.y * v.x;

  const handedness = options?.handedness || landmarks?.handedness || 'Right';
  const isLeft = typeof handedness === 'string' && handedness.toLowerCase().startsWith('l');
  const signedCrossZ = isLeft ? -crossZ : crossZ;

  // Separación lateral entre INDEX_MCP y PINKY_MCP en la vista actual
  const mcpLateralSpan = Math.abs(v.x - u.x);

  let palmFacing = 'FRONT';
  if (mcpLateralSpan < 0.28 || Math.abs(signedCrossZ) < 0.2) {
    palmFacing = 'SIDE';
  } else if (signedCrossZ < 0) {
    palmFacing = 'BACK';
  } else {
    palmFacing = 'FRONT';
  }

  // Signo quiral para canonicalizar la coordenada X:
  // Garantiza que en coordenadas canónicas el lado radial (índice/pulgar) esté siempre en -X
  // y el lado ulnar (meñique) esté siempre en +X, sin importar si es mano izquierda, derecha, palma o dorso.
  const chiralitySign = v.x - u.x >= 0 ? 1 : -1;

  return {
    palmAngleDeg: Number(palmAngleDeg.toFixed(2)),
    direction,
    palmFacing,
    palmNormalZ: Number(signedCrossZ.toFixed(4)),
    rawCrossZ: Number(crossZ.toFixed(4)),
    mcpLateralSpan: Number(mcpLateralSpan.toFixed(4)),
    chiralitySign,
    handedness: isLeft ? 'Left' : 'Right',
  };
}

/**
 * Proyecta los landmarks normalizados al sistema canónico quiral donde el lado radial (índice)
 * siempre tiene X < 0 y el lado ulnar (meñique) siempre tiene X > 0.
 *
 * @param {Array<{x:number, y:number, z:number}>} normLandmarks
 * @param {number} chiralitySign +1 o -1
 */
export function canonicalizeHand(normLandmarks, chiralitySign = 1) {
  const s = chiralitySign >= 0 ? 1 : -1;
  return normLandmarks.map((pt) => ({
    x: pt.x * s,
    y: pt.y,
    z: pt.z,
  }));
}

/**
 * Evalúa el estado geométrico de un dedo largo (índice, medio, anular o meñique) combinando:
 * - Razón de distancias radiales a la muñeca (`tipDist / pipDist` y `tipDist / mcpDist`)
 * - Ángulo articular en MCP (`jointAngleDeg(WRIST, MCP, PIP)`), PIP (`jointAngleDeg(MCP, PIP, DIP)`) y DIP (`jointAngleDeg(PIP, DIP, TIP)`)
 * - Clasificación tri-valuada: `EXTENDED`, `HOOKED` (garra/arco semicircular para C, E, O, Q, X) o `CURLED` (puño).
 */
function evaluateFinger(canonicalLandmarks, mcpIdx, pipIdx, dipIdx, tipIdx) {
  const wrist = canonicalLandmarks[HAND_LANDMARKS.WRIST];
  const mcp = canonicalLandmarks[mcpIdx];
  const pip = canonicalLandmarks[pipIdx];
  const dip = canonicalLandmarks[dipIdx];
  const tip = canonicalLandmarks[tipIdx];

  const distMcp = distance3D(wrist, mcp);
  const distPip = distance3D(wrist, pip);
  const distTip = distance3D(wrist, tip);

  const mcpAngle = jointAngleDeg(wrist, mcp, pip);
  const pipAngle = jointAngleDeg(mcp, pip, dip);
  const dipAngle = jointAngleDeg(pip, dip, tip);

  // Un dedo extendido tiene articulación PIP abierta (>= 135°) y su punta más lejos de la muñeca que PIP y MCP
  const extended =
    pipAngle >= 135 &&
    dipAngle >= 130 &&
    distTip > distPip * 1.08 &&
    distTip > distMcp * 1.25;

  // Un dedo completamente cerrado en la palma (CURLED) tiene PIP agudo o la punta plegada por debajo de PIP
  const tightlyCurled =
    !extended && (pipAngle < 105 || distTip < distMcp * 1.08 || tip.y > mcp.y - 0.08);

  // Estado intermedio HOOKED (arqueado en C/O o en garra E/X/Q):
  // No está completamente extendido, pero tampoco plegado contra la base de la palma
  const hooked = !extended && !tightlyCurled;
  const curled = !extended;

  let state = 'CURLED';
  if (extended) {
    state = 'EXTENDED';
  } else if (hooked) {
    state = 'HOOKED';
  }

  return {
    extended,
    curled,
    hooked,
    tightlyCurled,
    state,
    mcpAngle,
    pipAngle,
    dipAngle,
    tipToWrist: distTip,
    pipToWrist: distPip,
    mcpToWrist: distMcp,
    tipY: tip.y,
    tipCanonicalX: tip.x,
  };
}

/**
 * Calcula el estado geométrico detallado de los 5 dedos, orientación 2D/3D y relaciones inter-digitales.
 * Mantiene el 100% de las propiedades existentes e incorpora los descriptores para el catálogo de LSM.
 *
 * @param {Array<{x:number, y:number, z?:number}>} landmarks
 * @param {Object} [options]
 * @param {'Right'|'Left'|null} [options.handedness=null]
 * @returns {Object|null}
 */
export function fingerStates(landmarks, options = {}) {
  const norm = normalizeHand(landmarks);
  if (!norm) return null;

  const scale = palmScale(landmarks);
  const orientation = extractHandOrientation(landmarks, norm, options);
  const canonical = canonicalizeHand(norm, orientation.chiralitySign);
  const wrist = canonical[HAND_LANDMARKS.WRIST];

  // Evaluar los 4 dedos largos sobre las coordenadas canónicas normalizadas
  const indexInfo = evaluateFinger(
    canonical,
    HAND_LANDMARKS.INDEX_MCP,
    HAND_LANDMARKS.INDEX_PIP,
    HAND_LANDMARKS.INDEX_DIP,
    HAND_LANDMARKS.INDEX_TIP
  );
  const middleInfo = evaluateFinger(
    canonical,
    HAND_LANDMARKS.MIDDLE_MCP,
    HAND_LANDMARKS.MIDDLE_PIP,
    HAND_LANDMARKS.MIDDLE_DIP,
    HAND_LANDMARKS.MIDDLE_TIP
  );
  const ringInfo = evaluateFinger(
    canonical,
    HAND_LANDMARKS.RING_MCP,
    HAND_LANDMARKS.RING_PIP,
    HAND_LANDMARKS.RING_DIP,
    HAND_LANDMARKS.RING_TIP
  );
  const pinkyInfo = evaluateFinger(
    canonical,
    HAND_LANDMARKS.PINKY_MCP,
    HAND_LANDMARKS.PINKY_PIP,
    HAND_LANDMARKS.PINKY_DIP,
    HAND_LANDMARKS.PINKY_TIP
  );

  // Evaluar el pulgar en coordenadas canónicas
  const thumbCmc = canonical[HAND_LANDMARKS.THUMB_CMC];
  const thumbMcp = canonical[HAND_LANDMARKS.THUMB_MCP];
  const thumbIp = canonical[HAND_LANDMARKS.THUMB_IP];
  const thumbTip = canonical[HAND_LANDMARKS.THUMB_TIP];
  const indexMcp = canonical[HAND_LANDMARKS.INDEX_MCP];
  const indexPip = canonical[HAND_LANDMARKS.INDEX_PIP];
  const indexDip = canonical[HAND_LANDMARKS.INDEX_DIP];
  const indexTip = canonical[HAND_LANDMARKS.INDEX_TIP];
  const middleMcp = canonical[HAND_LANDMARKS.MIDDLE_MCP];
  const middlePip = canonical[HAND_LANDMARKS.MIDDLE_PIP];
  const middleTip = canonical[HAND_LANDMARKS.MIDDLE_TIP];
  const ringMcp = canonical[HAND_LANDMARKS.RING_MCP];
  const ringTip = canonical[HAND_LANDMARKS.RING_TIP];
  const pinkyMcp = canonical[HAND_LANDMARKS.PINKY_MCP];
  const pinkyTip = canonical[HAND_LANDMARKS.PINKY_TIP];

  const thumbMcpAngle = jointAngleDeg(thumbCmc, thumbMcp, thumbIp);
  const thumbIpAngle = jointAngleDeg(thumbMcp, thumbIp, thumbTip);
  const thumbToPinkyMcp = distance3D(thumbTip, pinkyMcp);
  const thumbToMiddleMcp = distance3D(thumbTip, middleMcp);
  const thumbToIndexMcp = distance3D(thumbTip, indexMcp);
  const thumbToIndexPip = distanceRobust(thumbTip, indexPip);
  const thumbToMiddlePip = distanceRobust(thumbTip, middlePip);
  const thumbToWrist = distance3D(thumbTip, wrist);

  // Distancias entre la punta del pulgar (4) y las 4 puntas de los dedos
  const thumbIndexTipDist = distance3D(thumbTip, indexTip);
  const thumbMiddleTipDist = distanceRobust(thumbTip, middleTip);
  const thumbRingTipDist = distanceRobust(thumbTip, ringTip);
  const thumbPinkyTipDist = distanceRobust(thumbTip, pinkyTip);

  // Punto medio entre INDEX_PIP (6) y MIDDLE_PIP (10), clave para letras T, P y K
  const indexMiddlePipMid = {
    x: (indexPip.x + middlePip.x) * 0.5,
    y: (indexPip.y + middlePip.y) * 0.5,
    z: (indexPip.z + middlePip.z) * 0.5,
  };
  const thumbToIndexMiddlePipMid = distanceRobust(thumbTip, indexMiddlePipMid);

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
  const vIndex = {
    x: indexTip.x - indexMcp.x,
    y: indexTip.y - indexMcp.y,
    z: indexTip.z - indexMcp.z,
  };
  const thumbIndexAngleDeg = angleBetweenVectorsDeg(vThumb, vIndex);

  // Separaciones 2D/3D entre dedos adyacentes (normalizadas por palmScale)
  const indexMiddleSpread = distance3D(indexTip, middleTip);
  const indexMiddleSpread2D = distance2D(indexTip, middleTip);
  const middleRingSpread2D = distance2D(middleTip, ringTip);
  const ringPinkySpread2D = distance2D(ringTip, pinkyTip);
  const threeFingersSpread = middleRingSpread2D + ringPinkySpread2D;
  const fourFingersSpread = indexMiddleSpread2D + middleRingSpread2D + ringPinkySpread2D;

  // Cruce lateral entre índice y medio en el sistema canónico:
  // En posición normal sin cruzar, el índice está en el lado radial (x más negativo que el medio),
  // por lo que indexTip.x - middleTip.x < -0.15. Cuando se cruzan (letra R), indexTip.x >= middleTip.x - 0.05.
  const indexMiddleCrossDeltaX = indexTip.x - middleTip.x;
  const indexMiddleDipDist2D = distance2D(indexDip, canonical[HAND_LANDMARKS.MIDDLE_DIP]);

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
    thumbMiddleTipDist,
    thumbRingTipDist,
    thumbPinkyTipDist,
    thumbIndexAngleDeg,
    indexMiddleSpread,
    indexMiddleSpread2D,
    middleRingSpread2D,
    ringPinkySpread2D,
    threeFingersSpread,
    fourFingersSpread,
    indexMiddleCrossDeltaX,
    indexMiddleDipDist2D,
    thumbToIndexMiddlePipMid,
    thumbToIndexPip,
    thumbToMiddlePip,
    palmScale: scale,
    orientation,
    canonicalLandmarks: canonical,
    normalizedLandmarks: norm,
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
        toIndexMcp: thumbToIndexMcp,
        toIndexPip: thumbToIndexPip,
        toMiddlePip: thumbToMiddlePip,
        toIndexMiddlePipMid: thumbToIndexMiddlePipMid,
        tipCanonicalX: thumbTip.x,
        tipY: thumbTip.y,
        tipZ: thumbTip.z,
        indexMcpCanonicalX: indexMcp.x,
        middleMcpCanonicalX: middleMcp.x,
        ringMcpCanonicalX: ringMcp.x,
      },
      index: indexInfo,
      middle: middleInfo,
      ring: ringInfo,
      pinky: pinkyInfo,
    },
  };
}
