/**
 * Live anatomical correction engine comparing current `fingerStates` + palm orientation +
 * dynamic motion against the expected profile of a target LSM sign `X`.
 *
 * Pure JS (zero DOM/React dependencies) — produces warm, specific Spanish coaching messages
 * such as "Estás haciendo 'Uno', extiende también el dedo medio."
 */

import { getSignProfile } from './catalog.js';

export const FINGER_ORDER = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);

export const FINGER_LABELS_ES = Object.freeze({
  thumb: 'pulgar',
  index: 'índice',
  middle: 'medio',
  ring: 'anular',
  pinky: 'meñique',
});

function formatFingerList(keys) {
  if (!keys || keys.length === 0) return '';
  const names = keys.map((k) => FINGER_LABELS_ES[k] || k);
  if (names.length === 1) return `el dedo ${names[0]}`;
  if (names.length === 2) return `los dedos ${names[0]} y ${names[1]}`;
  const head = names.slice(0, -1).join(', ');
  return `los dedos ${head} y ${names[names.length - 1]}`;
}

function capitalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildIdleFingerStatus(value = 'idle') {
  return {
    thumb: value,
    index: value,
    middle: value,
    ring: value,
    pinky: value,
  };
}

/**
 * Generates concrete live anatomical coaching feedback comparing the user's current hand
 * posture (and optionally detected sign `Y`) against the target sign `X`.
 *
 * @param {Object} params
 * @param {string} params.targetLabel Canonical label from `SIGN_LABELS`
 * @param {string|null} [params.detectedLabel] Currently detected sign `Y` (confirmed or raw)
 * @param {Object|null} [params.states] Output of `fingerStates()` from `geometry.js`
 * @param {string|null} [params.reason] Optional classifier rejection reason
 * @param {Object|null} [params.wave] Optional `detectWaveMotion()` output
 * @param {Object|null} [params.palmRotation] Optional `detectPalmRotation()` output
 */
export function generateAnatomicalCorrection({
  targetLabel,
  detectedLabel = null,
  states = null,
  reason = null,
  wave = null,
  palmRotation = null,
} = {}) {
  const profile = getSignProfile(targetLabel);

  if (!states) {
    return {
      status: 'no_hand',
      message: 'Coloca tu mano frente a la cámara con los dedos bien visibles.',
      detectedLabel: null,
      targetLabel,
      actions: ['Coloca tu mano frente a la cámara'],
      fingerStatus: buildIdleFingerStatus('idle'),
      orientationIssue: null,
      motionIssue: null,
    };
  }

  if (detectedLabel && detectedLabel === targetLabel) {
    return {
      status: 'match',
      message: `¡Muy bien! Mantén la seña '${targetLabel}' firme un momento.`,
      detectedLabel,
      targetLabel,
      actions: [],
      fingerStatus: buildIdleFingerStatus('ok'),
      orientationIssue: null,
      motionIssue: null,
    };
  }

  if (!profile) {
    return {
      status: 'adjust_posture',
      message: `Ajusta tu mano siguiendo las instrucciones de '${targetLabel}'.`,
      detectedLabel,
      targetLabel,
      actions: [],
      fingerStatus: buildIdleFingerStatus('idle'),
      orientationIssue: null,
      motionIssue: null,
    };
  }

  const fingerStatus = buildIdleFingerStatus('ok');
  const toExtend = [];
  const toCurl = [];
  const toCurlMore = [];
  const actions = [];
  let alreadyExtendedTargetCount = 0;

  for (const key of FINGER_ORDER) {
    const expected = profile.fingers[key];
    const isExtended = Boolean(states[key]);
    const detail = states.details?.[key];

    if (expected === true) {
      if (isExtended) {
        fingerStatus[key] = 'ok';
        alreadyExtendedTargetCount++;
      } else {
        fingerStatus[key] = 'extend';
        toExtend.push(key);
      }
    } else if (expected === false) {
      if (isExtended) {
        fingerStatus[key] = 'curl';
        toCurl.push(key);
      } else if (detail && detail.ambiguous && !profile.zeroOval) {
        fingerStatus[key] = 'curl';
        toCurlMore.push(key);
      } else {
        fingerStatus[key] = 'ok';
      }
    }
  }

  // Special shape: OK / Pinza (thumb + index tips form circle)
  if (profile.pinch) {
    const pinchOk = Boolean(states.isPinching) && !states.index;
    fingerStatus.thumb = pinchOk ? 'ok' : 'adjust';
    fingerStatus.index = pinchOk ? 'ok' : 'adjust';
    if (!pinchOk) {
      actions.push('une las puntas del pulgar y el índice formando un círculo');
    }
  }

  // Special shape: Cero (open oval meeting thumb)
  if (profile.zeroOval) {
    const iD = states.details?.index;
    const mD = states.details?.middle;
    const hasStraightLong = Boolean(states.index || states.middle || states.ring || states.pinky);
    const tipDistOk =
      (states.thumbIndexTipDist ?? 1) < 0.36 && (states.thumbMiddleTipDist ?? 1) < 0.42;
    const archOk =
      (iD?.tipToMcpRatio ?? 0) >= 1.18 &&
      (mD?.tipToMcpRatio ?? 0) >= 1.18 &&
      (iD?.pipAngle ?? 0) >= 75 &&
      (mD?.pipAngle ?? 0) >= 75;

    if (hasStraightLong) {
      for (const k of ['index', 'middle', 'ring', 'pinky']) {
        if (states[k]) fingerStatus[k] = 'adjust';
      }
      actions.push('curva los dedos en arco sin estirarlos rectos');
    }
    if (!tipDistOk || !archOk) {
      fingerStatus.thumb = 'adjust';
      fingerStatus.index = 'adjust';
      fingerStatus.middle = 'adjust';
      if (!archOk && !hasStraightLong) {
        actions.push("abre ligeramente el puño en forma de óvalo (como una 'O') tocando el pulgar");
      } else {
        actions.push('junta las puntas de tus dedos con la punta del pulgar formando un óvalo');
      }
    }
  }

  // Finger extend / curl instructions
  if (toExtend.length > 0 && !profile.zeroOval) {
    const verb = alreadyExtendedTargetCount > 0 ? 'extiende también' : 'extiende';
    actions.push(`${verb} ${formatFingerList(toExtend)}`);
  }

  if (toCurl.length > 0 && !profile.zeroOval) {
    actions.push(`cierra ${formatFingerList(toCurl)}`);
  } else if (toExtend.length === 0 && toCurlMore.length > 0 && !profile.zeroOval) {
    actions.push(`dobla bien ${formatFingerList(toCurlMore)}`);
  }

  // Thumb upward constraint (Bien / Seis)
  if (profile.thumbUp && states.thumb && ((states.thumbUpScore ?? 1) < 0.05 || reason === 'THUMB_NOT_UPWARD')) {
    fingerStatus.thumb = 'adjust';
    actions.push('apunta el pulgar hacia arriba');
  }

  // Thumb-Index angle constraint (Lunes / Siete)
  if (profile.thumbIndexAngleRange && states.thumb && states.index) {
    const [minDeg, maxDeg] = profile.thumbIndexAngleRange;
    const angle = states.thumbIndexAngleDeg ?? 90;
    if (angle < minDeg || angle > maxDeg || reason === 'AMBIGUOUS_THUMB_INDEX_ANGLE') {
      fingerStatus.thumb = 'adjust';
      fingerStatus.index = 'adjust';
      actions.push("abre un poco más el ángulo entre el pulgar y el índice formando una 'L'");
    }
  }

  // Palm orientation constraint (FRONT vs BACK: Cuatro/Nueve, Bien/Seis, Lunes/Siete)
  let orientationIssue = null;
  const signedZ = states.signedFrontZ ?? 0;
  if (profile.orientation === 'BACK' && signedZ > -0.35) {
    orientationIssue = 'need_back';
    actions.push('gira tu mano mostrando el dorso hacia la cámara');
  } else if (profile.orientation === 'FRONT' && signedZ < -0.15) {
    orientationIssue = 'need_front';
    actions.push('gira tu mano mostrando la palma hacia la cámara');
  }

  // Dynamic motion constraint (Hola lateral wave / Diez wrist flip)
  let motionIssue = null;
  if (profile.dynamicMotion === 'wave' && toExtend.length === 0 && !wave?.isWaving) {
    motionIssue = 'need_wave';
    actions.push('mueve tu mano abierta suavemente de lado a lado para saludar');
  } else if (profile.dynamicMotion === 'rotation' && toExtend.length === 0 && !palmRotation?.isRotating) {
    motionIssue = 'need_rotation';
    actions.push('gira la muñeca alternando palma y dorso frente a la cámara');
  }

  const actionText =
    actions.length === 0
      ? `ajusta ligeramente tus dedos para formar '${targetLabel}'`
      : actions.length === 1
        ? actions[0]
        : `${actions[0]} y ${actions[1]}`;

  const isWrongSign = Boolean(detectedLabel && detectedLabel !== targetLabel);
  const message = isWrongSign
    ? `Estás haciendo '${detectedLabel}', ${actionText}.`
    : `${capitalize(actionText)}.`;

  return {
    status: isWrongSign ? 'wrong_sign' : 'adjust_posture',
    message,
    detectedLabel: isWrongSign ? detectedLabel : null,
    targetLabel,
    actions,
    fingerStatus,
    orientationIssue,
    motionIssue,
  };
}
