/**
 * src/recognition/signs/matcher.js — Motor declarativo de puntuación (0 a 1), desempate por grupo y rechazo
 *
 * Evalúa cada entrada declarativa del catálogo de LSM contra el vector de características geométricas
 * (`fingerStates`) y el contexto temporal en milisegundos (`buildTrajectoryContext`).
 * No usa una cadena monolítica de `if`: calcula la puntuación ponderada de cada seña,
 * aplica criterios de desempate dentro de cada `grupoConfundible` y rechaza con
 * `{ label: null, reason: 'LOW_CONFIDENCE' }` cuando no se superan los umbrales.
 */

import { SIGN_TYPES } from './schema.js';

/**
 * Evalúa qué tan bien un valor numérico `val` cae dentro del rango `[min, max]` con caída suave `slack`.
 * Devuelve 1.0 dentro de `[min, max]` y decae linealmente hasta 0.0 en `[min - slack, max + slack]`.
 */
export function scoreRange(val, min = -Infinity, max = Infinity, slack = 0.12) {
  if (!Number.isFinite(val)) return 0;
  if (val >= min && val <= max) return 1.0;
  if (slack <= 0) return 0;
  if (val < min) {
    return Math.max(0, 1 - (min - val) / slack);
  }
  return Math.max(0, 1 - (val - max) / slack);
}

/**
 * Evalúa el estado de un dedo individual frente al objetivo declarativo:
 * - 'EXTENDED': requiere dedo extendido
 * - 'CURLED': requiere dedo doblado (no extendido)
 * - 'TIGHTLY_CURLED': requiere dedo completamente enrollado en palma (no HOOKED ni EXTENDED)
 * - 'HOOKED': requiere dedo arqueado/garra (o ángulo PIP intermedio 70°–148°)
 * - 'NOT_EXTENDED': acepta tanto CURLED como HOOKED
 * - 'ANY': siempre 1.0
 */
function scoreSingleFinger(fingerName, targetState, features) {
  if (!targetState || targetState === 'ANY') return 1.0;

  if (fingerName === 'thumb') {
    const isExt = features.thumb;
    const isPinch = features.isPinching;
    const ipAngle = features.details.thumb.ipAngle;
    if (targetState === 'EXTENDED') {
      return isExt ? 1.0 : 0.0;
    }
    if (targetState === 'PINCHING') {
      return isPinch ? 1.0 : scoreRange(features.thumbIndexTipDist, 0, 0.36, 0.12);
    }
    if (targetState === 'CURLED' || targetState === 'NOT_EXTENDED') {
      return !isExt ? 1.0 : 0.0;
    }
    if (targetState === 'HOOKED') {
      return !isExt && ipAngle >= 85 && ipAngle <= 155 ? 1.0 : 0.25;
    }
    return 1.0;
  }

  const info = features.details[fingerName];
  if (!info) return 0;

  switch (targetState) {
    case 'EXTENDED':
      if (info.extended) return 1.0;
      return scoreRange(info.pipAngle, 135, 180, 20) * 0.5;
    case 'TIGHTLY_CURLED':
      if (info.tightlyCurled) return 1.0;
      if (!info.extended && info.pipAngle < 120) return 0.75;
      return 0.0;
    case 'HOOKED':
      if (info.hooked) return 1.0;
      if (!info.extended && info.pipAngle >= 70 && info.pipAngle <= 148) return 0.85;
      return 0.0;
    case 'CURLED':
    case 'NOT_EXTENDED':
      return !info.extended ? 1.0 : 0.0;
    default:
      return 1.0;
  }
}

/**
 * Evalúa la compatibilidad de orientación 2D (`direction`) y cara de la palma (`palmFacing`).
 * Si una seña declara `ANY` (o no declara restricción), devuelve 1.0 para mantener invariancia rotacional.
 */
function scoreOrientation(orientSpec, features) {
  if (!orientSpec) return 1.0;
  const { direction, palmAngleDeg, palmFacing } = features.orientation;

  let dirScore = 1.0;
  if (
    Array.isArray(orientSpec.directions) &&
    orientSpec.directions.length > 0 &&
    !orientSpec.directions.includes('ANY')
  ) {
    if (orientSpec.directions.includes(direction)) {
      dirScore = 1.0;
    } else if (typeof orientSpec.angleRange === 'object' && orientSpec.angleRange) {
      dirScore = scoreRange(
        palmAngleDeg,
        orientSpec.angleRange.min,
        orientSpec.angleRange.max,
        orientSpec.angleRange.slack ?? 20
      );
    } else {
      dirScore = 0.0;
    }
  }

  let faceScore = 1.0;
  if (
    Array.isArray(orientSpec.palmFacing) &&
    orientSpec.palmFacing.length > 0 &&
    !orientSpec.palmFacing.includes('ANY')
  ) {
    faceScore = orientSpec.palmFacing.includes(palmFacing) ? 1.0 : 0.0;
  }

  return dirScore * 0.65 + faceScore * 0.35;
}

/**
 * Evalúa las restricciones métricas continuas (`metricas`) declaradas en la seña.
 * Cada restricción `{ metric, min, max, slack, weight }` se evalúa sobre `features` o `features.details.thumb`.
 */
function scoreMetricConstraints(constraints, features) {
  if (!Array.isArray(constraints) || constraints.length === 0) return 1.0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const c of constraints) {
    const w = c.weight ?? 1.0;
    totalWeight += w;

    let val = features[c.metric];
    if (val === undefined && features.details?.thumb) {
      val = features.details.thumb[c.metric];
    }
    if (val === undefined && features.orientation) {
      val = features.orientation[c.metric];
    }

    const s = scoreRange(val, c.min ?? -Infinity, c.max ?? Infinity, c.slack ?? 0.1);
    if (c.required && s <= 0) {
      return 0;
    }
    weightedSum += s * w;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 1.0;
}

/**
 * Evalúa el componente dinámico (`trayectoria`) en milisegundos para señas con `tipo === 'dinamica'`.
 */
function scoreDynamicTrajectory(trajSpec, trajectoryContext) {
  if (!trajSpec || !trajectoryContext) return 0;

  switch (trajSpec.kind) {
    case 'WAVE_X': {
      const osc = trajectoryContext.oscillationX;
      if (!osc || !osc.isOscillating) return 0;
      const minChanges = trajSpec.minDirectionChanges ?? 2;
      if (osc.directionChanges < minChanges) return 0;
      return Math.min(1.0, 0.85 + Math.min(0.15, osc.totalAmplitude * 0.2));
    }
    case 'DISPLACEMENT_X': {
      const osc = trajectoryContext.oscillationX;
      if (!osc || !osc.hasDisplacement) return 0;
      const minSpan = trajSpec.minSpanX ?? 0.2;
      if (osc.spanX < minSpan) return 0;
      return Math.min(1.0, 0.84 + Math.min(0.16, (osc.spanX - minSpan) * 0.4));
    }
    case 'DISPLACEMENT_Y': {
      const oscY = trajectoryContext.oscillationY;
      if (!oscY || !oscY.hasDisplacement) return 0;
      const minSpanY = trajSpec.minSpanY ?? 0.18;
      if (oscY.spanY < minSpanY) return 0;
      return Math.min(1.0, 0.84 + Math.min(0.16, (oscY.spanY - minSpanY) * 0.4));
    }
    case 'PALM_ROTATION': {
      const rot = trajectoryContext.palmRotation;
      if (!rot || !rot.isRotating) return 0;
      return Math.min(1.0, 0.85 + Math.min(0.15, rot.normalDelta * 0.15));
    }
    case 'TEMPLATE_Z': {
      const tpl = trajectoryContext.templates?.Z;
      if (!tpl || !tpl.matched) return 0;
      return Math.min(1.0, 0.82 + tpl.score * 0.18);
    }
    case 'TEMPLATE_J': {
      const tpl = trajectoryContext.templates?.J;
      if (!tpl || !tpl.matched) return 0;
      return Math.min(1.0, 0.82 + tpl.score * 0.18);
    }
    default:
      return 0;
  }
}

/**
 * Puntúa una única entrada declarativa del catálogo en el rango [0, 1].
 *
 * @param {Object} signDef Entrada declarativa del catálogo
 * @param {Object} features Resultado de `fingerStates(landmarks, options)`
 * @param {Object|null} trajectoryContext Resultado de `buildTrajectoryContext(frames)`
 * @returns {{ score: number, breakdown: Object }}
 */
export function scoreSign(signDef, features, trajectoryContext = null) {
  if (!signDef || !features) {
    return { score: 0, breakdown: { reason: 'MISSING_INPUT' } };
  }

  // 1. Puntuación de los 5 dedos
  const fSpec = signDef.dedos || {};
  const sThumb = scoreSingleFinger('thumb', fSpec.thumb, features);
  const sIndex = scoreSingleFinger('index', fSpec.index, features);
  const sMiddle = scoreSingleFinger('middle', fSpec.middle, features);
  const sRing = scoreSingleFinger('ring', fSpec.ring, features);
  const sPinky = scoreSingleFinger('pinky', fSpec.pinky, features);

  // Compuerta dura: si algún dedo obligatorio tiene score 0, la seña queda descartada
  if (sThumb === 0 || sIndex === 0 || sMiddle === 0 || sRing === 0 || sPinky === 0) {
    return {
      score: 0,
      breakdown: { fingers: 0, sThumb, sIndex, sMiddle, sRing, sPinky },
    };
  }

  const fingerScore = (sThumb + sIndex + sMiddle + sRing + sPinky) / 5;

  // 2. Puntuación de orientación (solo cuando la seña depende de ella)
  const orientScore = scoreOrientation(signDef.orientacion, features);
  if (signDef.orientacion?.required && orientScore === 0) {
    return {
      score: 0,
      breakdown: { fingers: fingerScore, orientation: 0 },
    };
  }

  // 3. Puntuación de contactos / métricas inter-digitales
  const metricsScore = scoreMetricConstraints(signDef.metricas, features);
  if (metricsScore === 0 && Array.isArray(signDef.metricas) && signDef.metricas.length > 0) {
    return {
      score: 0,
      breakdown: { fingers: fingerScore, orientation: orientScore, metrics: 0 },
    };
  }

  // 4. Componente dinámico para señas de movimiento
  let dynamicScore = 1.0;
  if (signDef.tipo === SIGN_TYPES.DINAMICA) {
    dynamicScore = scoreDynamicTrajectory(signDef.trayectoria, trajectoryContext);
    if (dynamicScore === 0) {
      return {
        score: 0,
        breakdown: { fingers: fingerScore, orientation: orientScore, metrics: metricsScore, dynamic: 0 },
      };
    }
  }

  // 5. Pesos declarativos de combinación
  const weights = signDef.pesos || {};
  const wFingers = weights.fingers ?? 0.55;
  const wOrient = signDef.orientacion ? (weights.orientation ?? 0.15) : 0;
  const wMetrics = Array.isArray(signDef.metricas) && signDef.metricas.length > 0 ? (weights.metrics ?? 0.25) : 0;
  const wDynamic = signDef.tipo === SIGN_TYPES.DINAMICA ? (weights.dynamic ?? 0.35) : 0;

  const totalW = wFingers + wOrient + wMetrics + wDynamic;
  let combined =
    (wFingers * fingerScore +
      wOrient * orientScore +
      wMetrics * metricsScore +
      wDynamic * dynamicScore) /
    (totalW || 1);

  // Ajuste fino declarativo o función custom de desempate si existe
  if (typeof signDef.refineScore === 'function') {
    combined = signDef.refineScore(combined, features, trajectoryContext);
  }

  const finalScore = Number(Math.max(0, Math.min(0.99, combined)).toFixed(4));
  return {
    score: finalScore,
    breakdown: {
      fingers: Number(fingerScore.toFixed(4)),
      orientation: Number(orientScore.toFixed(4)),
      metrics: Number(metricsScore.toFixed(4)),
      dynamic: Number(dynamicScore.toFixed(4)),
    },
  };
}

/**
 * Verifica si dos entradas del catálogo comparten la misma configuración física (son alias entre sí).
 */
function areAliases(entryA, entryB) {
  if (!entryA || !entryB) return false;
  if (entryA.id === entryB.id || entryA.label === entryB.label) return true;
  if (Array.isArray(entryA.aliases) && entryA.aliases.includes(entryB.label)) return true;
  if (Array.isArray(entryB.aliases) && entryB.aliases.includes(entryA.label)) return true;
  return false;
}

/**
 * Evalúa todo el catálogo declarativo, aplica desempates dentro de cada grupo confundible
 * y rechaza con `{ label: null, reason: 'LOW_CONFIDENCE' }` si el mejor score o su margen son insuficientes.
 *
 * @param {Array<Object>} catalog Lista de definiciones declarativas de señas
 * @param {Object} features Resultado de `fingerStates(landmarks, options)`
 * @param {Object|null} [trajectoryContext=null]
 * @param {Object} [options]
 * @param {number} [options.minConfidence=0.72]
 * @param {number} [options.minMargin=0.05]
 * @param {'all'|'legacy'|'alphabet'|'numbers'} [options.mode='all']
 * @returns {{ label: string|null, category: string|null, confidence: number, details: Object }}
 */
export function matchCatalog(catalog, features, trajectoryContext = null, options = {}) {
  const minConfidence = options.minConfidence ?? 0.72;
  const minMargin = options.minMargin ?? 0.05;
  const mode = options.mode ?? 'all';

  if (!features || !Array.isArray(catalog) || catalog.length === 0) {
    return {
      label: null,
      category: null,
      confidence: 0,
      details: {
        reason: 'INVALID_OR_NOISY_LANDMARKS',
        states: features || null,
      },
    };
  }

  // Filtrar catálogo según el modo solicitado
  const activeCatalog = catalog.filter((entry) => {
    if (entry.estado === 'PENDIENTE_FUENTE') return false;
    if (mode === 'legacy') return entry.categoria === 'basica';
    if (mode === 'alphabet') return entry.categoria === 'letra';
    if (mode === 'numbers') return entry.categoria === 'numero';
    return true;
  });

  const scored = [];
  for (const entry of activeCatalog) {
    const { score, breakdown } = scoreSign(entry, features, trajectoryContext);
    if (score > 0) {
      // Pequeño bono de prioridad según el modo cuando dos entradas son alias exactos
      let modePriority = entry.priority ?? 0;
      if (mode === 'all' && entry.categoria === 'basica') {
        modePriority += 0.001;
      }
      scored.push({
        entry,
        score,
        effectiveScore: score + modePriority,
        breakdown,
      });
    }
  }

  if (scored.length === 0) {
    return {
      label: null,
      category: null,
      confidence: 0,
      details: {
        reason: 'LOW_CONFIDENCE',
        candidate: null,
        margin: 0,
        states: features,
      },
    };
  }

  // Ordenar de mayor a menor puntuación efectiva
  scored.sort((a, b) => b.effectiveScore - a.effectiveScore);

  const best = scored[0];

  // Buscar el segundo mejor candidato que NO sea un alias geométrico del primero
  let secondDistinct = null;
  for (let i = 1; i < scored.length; i++) {
    if (!areAliases(best.entry, scored[i].entry)) {
      secondDistinct = scored[i];
      break;
    }
  }

  const secondScore = secondDistinct ? secondDistinct.score : 0;
  const margin = Number((best.score - secondScore).toFixed(4));

  // Rechazo por baja confianza o margen insuficiente entre candidatos distintos
  if (best.score < minConfidence || (secondDistinct && margin < minMargin)) {
    return {
      label: null,
      category: null,
      confidence: best.score,
      details: {
        reason: 'LOW_CONFIDENCE',
        candidate: best.entry.label,
        candidateId: best.entry.id,
        candidateCategory: best.entry.categoria,
        runnerUp: secondDistinct ? secondDistinct.entry.label : null,
        runnerUpScore: secondScore,
        margin,
        confusableGroup: best.entry.grupoConfundible,
        states: features,
      },
    };
  }

  return {
    label: best.entry.label,
    category: best.entry.categoria,
    confidence: best.score,
    details: {
      id: best.entry.id,
      category: best.entry.categoria,
      type: best.entry.tipo,
      source: best.entry.fuente,
      confusableGroup: best.entry.grupoConfundible,
      aliases: best.entry.aliases || [],
      margin,
      runnerUp: secondDistinct ? secondDistinct.entry.label : null,
      runnerUpScore: secondScore,
      breakdown: best.breakdown,
      reason: best.entry.descripcion || best.entry.label,
      states: features,
    },
  };
}
