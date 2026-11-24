/**
 * Directed single-sign evaluation engine for `Learn.jsx` (`evaluateTargetSign`).
 *
 * Evaluates a user's live hand against the EXACT anatomical criteria (3D finger angles,
 * palm orientation, hand direction, inter-finger geometry, framing distance) and real-time
 * `t_ms` trajectory of the selected target sign `X`, without altering or colliding with
 * `Translator.jsx`'s free-running `GeometricClassifier`.
 *
 * Pure JavaScript — zero DOM, camera, or React dependencies.
 */

import {
  HAND_LANDMARKS,
  resolveAspectRatio,
  projectIsotropic,
  isValidPoint,
  isValidHandLandmarks,
  palmScale,
  computePalmNormal,
  computeSignedFrontZ,
  computeExtendedHandAnatomy,
  extractHandsFromFrame,
  detectWaveMotion,
  detectPalmRotation,
} from '../recognition/index.js';
import { getLearningSignById, getLearningSignByLabel } from './catalog.js';
import { FINGER_ORDER, FINGER_LABELS_ES } from './anatomicalFeedback.js';

export const MIN_PRACTICE_PALM_SCALE = 0.06;
export const MAX_PRACTICE_PALM_SCALE = 0.6;
const HISTORY_RETENTION_MS = 1600;
const MAX_HISTORY_SAMPLES = 96;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function capitalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatFingerList(keys) {
  if (!keys || keys.length === 0) return '';
  const names = keys.map((k) => FINGER_LABELS_ES[k] || k);
  if (names.length === 1) return `el dedo ${names[0]}`;
  if (names.length === 2) return `los dedos ${names[0]} y ${names[1]}`;
  const head = names.slice(0, -1).join(', ');
  return `los dedos ${head} y ${names[names.length - 1]}`;
}

function buildFingerStatus(value = 'idle') {
  return {
    thumb: value,
    index: value,
    middle: value,
    ring: value,
    pinky: value,
  };
}

/**
 * Resolves a target sign from a full catalog object, an ID string, or a label string.
 */
export function resolveTargetSign(targetSign) {
  if (!targetSign) return null;
  if (typeof targetSign === 'string') {
    return getLearningSignById(targetSign) || getLearningSignByLabel(targetSign);
  }
  if (typeof targetSign === 'object') {
    if (targetSign.profile && targetSign.profile.fingers) {
      return targetSign;
    }
    if (targetSign.id) {
      const byId = getLearningSignById(targetSign.id);
      if (byId) return byId;
    }
    if (targetSign.label) {
      const byLabel = getLearningSignByLabel(targetSign.label);
      if (byLabel) return byLabel;
    }
  }
  return null;
}

function extractCandidates(handData) {
  if (!handData) return [];
  if (Array.isArray(handData)) {
    return handData.length >= 21 ? [{ handId: 'hand_0', landmarks: handData }] : [];
  }
  if (typeof handData === 'object') {
    if (
      Array.isArray(handData.landmarks) &&
      handData.landmarks.length >= 21 &&
      !handData.rightHand &&
      !handData.leftHand &&
      !Array.isArray(handData.hands)
    ) {
      return [
        {
          handId: handData.handId || 'hand_0',
          landmarks: handData.landmarks,
        },
      ];
    }
    return extractHandsFromFrame(handData);
  }
  return [];
}

function extractTimestampMs(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const raw = obj.t_ms ?? obj.tMs ?? obj.timestamp_ms ?? obj.timestamp;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function hasAllValidPoints(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return false;
  for (let i = 0; i < 21; i++) {
    if (!isValidPoint(landmarks[i])) return false;
  }
  return true;
}

function computeExtendedAnatomy(landmarks, aspectRatio, handId) {
  return computeExtendedHandAnatomy(landmarks, {
    aspectRatio,
    handId,
    _skipValidation: true,
  });
}

function isLongFingerExtendedRelaxed(states, key) {
  if (states[key]) return true;
  const d = states.details?.[key];
  if (!d || d.curled) return false;
  return d.pipAngle >= 126 && d.dipAngle >= 115 && d.tipToMcpRatio >= 1.18;
}

function isLongFingerCurledRelaxed(states, key) {
  const d = states.details?.[key];
  if (!d) return !states[key];
  if (d.curled) return true;
  return !states[key] && (d.pipAngle <= 134 || d.tipToMcpRatio <= 1.24);
}

function isThumbStraightAdducted(states) {
  const tD = states.details?.thumb;
  if (!tD) return false;
  return (
    tD.mcpAngle >= 125 &&
    tD.ipAngle >= 125 &&
    tD.toWrist >= 0.85 &&
    tD.toIndexMcp <= 0.88
  );
}

function isThumbCurledForTarget(states) {
  const tD = states.details?.thumb;
  if (!tD) return !states.thumb;
  if (states.thumb) return false;
  // Reject straight upright "Letra A" thumb when expecting a folded thumb across the palm
  const straightAdducted =
    tD.toWrist > 1.0 &&
    tD.toPinkyMcp > 0.9 &&
    tD.mcpAngle >= 140 &&
    tD.ipAngle >= 140;
  if (straightAdducted) return false;
  return tD.curled || tD.toMiddleMcp <= 0.72 || tD.ipAngle <= 125 || tD.mcpAngle <= 125;
}

/**
 * Evaluates static posture criteria (fingers, special shapes, spread, orientation, hand direction)
 * for one validated hand against a target sign's profile.
 */
function evaluateStaticPosture(anatomy, sign) {
  const { states } = anatomy;
  const profile = sign.profile;
  const fingerStatus = buildFingerStatus('ok');
  const actions = [];
  const toExtend = [];
  const toCurl = [];
  let alreadyExtendedTargetCount = 0;
  let totalChecks = 0;
  let passedChecks = 0;

  const recordCheck = (ok) => {
    totalChecks++;
    if (ok) passedChecks++;
    return ok;
  };

  // 1. Evaluate standard boolean & 'any' finger states (skip fingers handled by special shapes)
  const specialWholeHand = Boolean(profile.zeroOval || profile.cArc || profile.clawShape);

  if (!specialWholeHand) {
    for (const key of FINGER_ORDER) {
      const expected = profile.fingers[key];
      if (expected === 'any') {
        fingerStatus[key] = 'ok';
        continue;
      }

      if (expected === true) {
        const ok =
          key === 'thumb'
            ? Boolean(states.thumb)
            : isLongFingerExtendedRelaxed(states, key);
        recordCheck(ok);
        if (ok) {
          fingerStatus[key] = 'ok';
          alreadyExtendedTargetCount++;
        } else {
          fingerStatus[key] = 'extend';
          toExtend.push(key);
        }
      } else if (expected === false) {
        const ok =
          key === 'thumb'
            ? isThumbCurledForTarget(states)
            : isLongFingerCurledRelaxed(states, key);
        recordCheck(ok);
        if (ok) {
          fingerStatus[key] = 'ok';
        } else {
          fingerStatus[key] = 'curl';
          toCurl.push(key);
        }
      } else if (expected === 'adducted' && key === 'thumb') {
        // Letra A / Ayuda / Agua: straight upright thumb along index side
        const straightOk = Boolean(states.thumb) || isThumbStraightAdducted(states);
        const upOk = (states.thumbUpScore ?? 0) >= 0.18;
        const ok = recordCheck(straightOk && upOk);
        if (ok) {
          fingerStatus.thumb = 'ok';
        } else if (!straightOk) {
          fingerStatus.thumb = 'extend';
          actions.push('coloca el pulgar estirado hacia arriba al costado del índice');
        } else {
          fingerStatus.thumb = 'adjust';
          actions.push('apunta el pulgar hacia arriba junto al índice');
        }
      } else if (expected === 'tucked' && key === 'thumb') {
        // Letra T / Trabajo: thumb tucked between index and middle
        const tD = states.details?.thumb;
        const tuckedOk =
          !states.thumb &&
          (tD?.toIndexMcp ?? 1) <= 0.72 &&
          (tD?.toMiddleMcp ?? 1) <= 0.76 &&
          (tD?.toWrist ?? 0) >= 0.45;
        const ok = recordCheck(tuckedOk);
        if (ok) {
          fingerStatus.thumb = 'ok';
        } else {
          fingerStatus.thumb = 'adjust';
          actions.push('guarda el pulgar asomándolo entre el índice y el dedo medio');
        }
      }
    }
  }

  // 2. Special anatomical shapes
  // 2a. Zero / O / Más / Comer (closed oval meeting thumb tip)
  if (profile.zeroOval) {
    const iD = states.details?.index;
    const mD = states.details?.middle;
    const hasStraightLong = Boolean(states.index || states.middle || states.ring || states.pinky);
    const tipDistOk =
      (states.thumbIndexTipDist ?? 1) < 0.42 && (states.thumbMiddleTipDist ?? 1) < 0.48;
    const archOk =
      (iD?.tipToMcpRatio ?? 0) >= 1.08 &&
      (mD?.tipToMcpRatio ?? 0) >= 1.08 &&
      (iD?.pipAngle ?? 0) >= 68 &&
      (mD?.pipAngle ?? 0) >= 68;

    recordCheck(!hasStraightLong);
    recordCheck(tipDistOk && archOk);

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

  // 2b. Letra C / Buenas noches (open C-arc with visible gap between thumb and index)
  if (profile.cArc) {
    const iD = states.details?.index;
    const mD = states.details?.middle;
    const allStraight = Boolean(states.index && states.middle && states.ring && states.pinky);
    const archOk =
      !allStraight &&
      (iD?.tipToMcpRatio ?? 0) >= 0.98 &&
      (mD?.tipToMcpRatio ?? 0) >= 0.98 &&
      (iD?.pipAngle ?? 0) >= 58 &&
      (iD?.pipAngle ?? 180) <= 168 &&
      (mD?.pipAngle ?? 0) >= 58;
    const gap = states.thumbIndexTipDist ?? 0;
    const gapOk = gap >= 0.28 && gap <= 1.38;

    recordCheck(archOk);
    recordCheck(gapOk);

    if (allStraight) {
      for (const k of ['index', 'middle', 'ring', 'pinky']) fingerStatus[k] = 'adjust';
      actions.push('curva los dedos en forma de arco (como una C) sin estirarlos rectos');
    } else if (!archOk) {
      for (const k of ['index', 'middle', 'ring', 'pinky']) fingerStatus[k] = 'adjust';
      actions.push('abre un poco más el puño curvando tus dedos en forma de C');
    }
    if (!gapOk) {
      fingerStatus.thumb = 'adjust';
      fingerStatus.index = 'adjust';
      if (gap < 0.28) {
        actions.push('abre un poco el espacio entre el pulgar y el índice sin cerrar una O');
      } else {
        actions.push('acerca un poco más el pulgar y los dedos formando un arco en C');
      }
    }
  }

  // 2c. Letra E / Escuela (4 fingers clawed over upper palm, thumb folded underneath)
  if (profile.clawShape) {
    const anyLongExtended = Boolean(states.index || states.middle || states.ring || states.pinky);
    const thumbFolded = isThumbCurledForTarget(states);
    const iD = states.details?.index;
    const mD = states.details?.middle;
    const clawBent =
      !anyLongExtended &&
      (iD?.pipAngle ?? 180) <= 145 &&
      (mD?.pipAngle ?? 180) <= 145;

    recordCheck(clawBent);
    recordCheck(thumbFolded);

    if (anyLongExtended) {
      for (const k of ['index', 'middle', 'ring', 'pinky']) {
        if (states[k]) fingerStatus[k] = 'curl';
      }
      actions.push('dobla los cuatro dedos largos en forma de garra hacia la palma');
    }
    if (!thumbFolded) {
      fingerStatus.thumb = 'curl';
      actions.push('dobla el pulgar hacia la palma debajo de tus dedos');
    }
  }

  // 2d. Letra X / Letra Q (index hooked, middle/ring/pinky closed)
  if (profile.hookIndex) {
    const iD = states.details?.index;
    const indexHooked =
      !states.index &&
      (iD?.pipAngle ?? 0) >= 52 &&
      (iD?.pipAngle ?? 180) <= 154 &&
      ((iD?.tipToMcpRatio ?? 0) >= 0.92 || (iD?.tipToWrist ?? 0) >= 1.04);

    recordCheck(indexHooked);
    if (!indexHooked) {
      fingerStatus.index = 'adjust';
      if (states.index) {
        actions.push('dobla la punta del dedo índice en forma de gancho');
      } else {
        actions.push('levanta ligeramente el índice curvándolo en forma de gancho');
      }
    }

    if (profile.fingers.thumb === 'hook') {
      const tD = states.details?.thumb;
      const thumbHookOk =
        (states.thumbIndexTipDist ?? 2) <= 1.05 && (tD?.toWrist ?? 0) >= 0.62;
      recordCheck(thumbHookOk);
      if (!thumbHookOk) {
        fingerStatus.thumb = 'adjust';
        actions.push('acerca el pulgar en pinza o gancho frente al índice');
      }
    }
  }

  // 2e. Letra D / Disculpa (index up + middle/ring/pinky meeting thumb circle)
  if (profile.dCircle) {
    const circleOk =
      (states.thumbMiddleTipDist ?? 1) <= 0.65 ||
      anatomy.thumbTipToMiddlePip <= 0.65 ||
      !states.thumb;
    recordCheck(circleOk);
    if (!circleOk) {
      fingerStatus.thumb = 'adjust';
      actions.push('junta el pulgar con los dedos cerrados formando un círculo');
    }
  }

  // 2f. Letra F vs OK / Pinza (thumb + index tips/pads joined, middle/ring/pinky up)
  if (profile.fPinch) {
    const fTouchOk =
      !states.index &&
      ((states.thumbIndexTipDist ?? 1) <= 0.48 ||
        anatomy.thumbTipToIndexPip <= 0.48 ||
        anatomy.thumbTipToIndexDip <= 0.48);
    recordCheck(fTouchOk);
    fingerStatus.thumb = fTouchOk ? 'ok' : 'adjust';
    fingerStatus.index = fTouchOk ? 'ok' : 'adjust';
    if (!fTouchOk) {
      actions.push('dobla el índice y apoya el pulgar sobre él formando una pinza');
    }
  } else if (profile.pinch) {
    const pinchOk = Boolean(states.isPinching) && !states.index;
    recordCheck(pinchOk);
    fingerStatus.thumb = pinchOk ? 'ok' : 'adjust';
    fingerStatus.index = pinchOk ? 'ok' : 'adjust';
    if (!pinchOk) {
      actions.push('une las puntas del pulgar y el índice formando un círculo');
    }
  }

  // 2g. Letra K / Letra P / Con permiso (thumb resting between index & middle)
  if (profile.kpShape) {
    const tD = states.details?.thumb;
    const kpThumbOk =
      anatomy.thumbTipToMiddlePip <= 0.88 ||
      anatomy.thumbTipToIndexPip <= 0.88 ||
      (tD?.toMiddleMcp ?? 1) <= 0.85 ||
      Boolean(states.thumb);
    recordCheck(kpThumbOk);
    if (!kpThumbOk) {
      fingerStatus.thumb = 'adjust';
      actions.push('coloca el pulgar apoyado entre el índice y el dedo medio');
    } else {
      fingerStatus.thumb = 'ok';
    }
  }

  // 3. Collect concrete finger extend / curl instructions
  if (toExtend.length > 0 && !specialWholeHand) {
    const verb = alreadyExtendedTargetCount > 0 ? 'extiende también' : 'extiende';
    actions.push(`${verb} ${formatFingerList(toExtend)}`);
  }

  if (toCurl.length > 0 && !specialWholeHand) {
    if (toCurl.length === 1 && toCurl[0] === 'thumb') {
      actions.push('dobla el pulgar hacia la palma');
    } else {
      actions.push(`cierra ${formatFingerList(toCurl)}`);
    }
  }

  // 4. Inter-finger spread (U/B/H/M/N/Ñ together vs V/W apart vs R crossed)
  if (profile.fingerSpread && toExtend.length === 0 && !specialWholeHand) {
    const spread = states.indexMiddleSpread ?? 0.35;
    if (profile.fingerSpread === 'crossed') {
      const crossedOk =
        anatomy.tipOrderProj <= 0.08 || (spread <= 0.2 && anatomy.indexMiddleDipDist <= 0.24);
      recordCheck(crossedOk);
      if (!crossedOk) {
        fingerStatus.index = 'adjust';
        fingerStatus.middle = 'adjust';
        actions.push('cruza el dedo medio sobre el índice manteniendo ambos arriba');
      }
    } else if (profile.fingerSpread === 'together') {
      const maxSpread = profile.fingers.ring === true && profile.fingers.pinky === true ? 0.45 : 0.38;
      const notCrossed = anatomy.tipOrderProj > 0.04;
      const togetherOk = spread <= maxSpread && notCrossed;
      recordCheck(togetherOk);
      if (!togetherOk) {
        fingerStatus.index = 'adjust';
        fingerStatus.middle = 'adjust';
        actions.push(
          notCrossed
            ? 'junta los dedos extendidos sin separarlos'
            : 'mantén los dedos índice y medio juntos sin cruzarlos'
        );
      }
    } else if (profile.fingerSpread === 'apart') {
      const apartOk = spread >= 0.3;
      recordCheck(apartOk);
      if (!apartOk) {
        fingerStatus.index = 'adjust';
        fingerStatus.middle = 'adjust';
        actions.push(
          profile.fingers.ring === true
            ? 'separa los dedos índice, medio y anular formando una W'
            : 'separa los dedos índice y medio formando una V'
        );
      }
    }
  }

  // 5. Thumb upward constraint (Bien, Seis)
  if (profile.thumbUp && profile.fingers.thumb === true && states.thumb) {
    const upOk = (states.thumbUpScore ?? 0) >= 0.05;
    recordCheck(upOk);
    if (!upOk) {
      fingerStatus.thumb = 'adjust';
      actions.push('apunta el pulgar hacia arriba');
    }
  }

  // 6. Thumb-Index angle constraint (Letra L, Siete, Listo)
  if (profile.thumbIndexAngleRange && states.thumb && states.index) {
    const [minDeg, maxDeg] = profile.thumbIndexAngleRange;
    const angle = states.thumbIndexAngleDeg ?? 90;
    const angleOk = angle >= minDeg && angle <= maxDeg;
    recordCheck(angleOk);
    if (!angleOk) {
      fingerStatus.thumb = 'adjust';
      fingerStatus.index = 'adjust';
      actions.push("abre un poco más el ángulo entre el pulgar y el índice formando una 'L'");
    }
  }

  // 7. Palm orientation constraint (FRONT vs BACK vs SIDE)
  let orientationIssue = null;
  const signedZ = states.signedFrontZ ?? 0;
  if (profile.orientation === 'BACK') {
    const ok = recordCheck(signedZ <= -0.3);
    if (!ok) {
      orientationIssue = 'need_back';
      actions.push('gira tu mano mostrando el dorso hacia la cámara');
    }
  } else if (profile.orientation === 'FRONT') {
    const ok = recordCheck(signedZ >= -0.2);
    if (!ok) {
      orientationIssue = 'need_front';
      actions.push('gira tu mano mostrando la palma hacia la cámara');
    }
  } else if (profile.orientation === 'SIDE') {
    const ok = recordCheck(Math.abs(signedZ) <= 0.72);
    if (!ok) {
      orientationIssue = 'need_side';
      actions.push('coloca tu mano ligeramente de perfil');
    }
  }

  // 8. Hand / primary fingers direction in camera space (UP / DOWN / HORIZONTAL / TILTED)
  let directionIssue = null;
  if (profile.handDirection === 'UP') {
    const ok = recordCheck(anatomy.palmDirY >= 0.2 || anatomy.indexDirY >= 0.2);
    if (!ok) {
      directionIssue = 'need_up';
      actions.push('apunta tu mano y dedos hacia arriba');
    }
  } else if (profile.handDirection === 'DOWN') {
    const ok = recordCheck(anatomy.indexDirY <= -0.3 || anatomy.palmDirY <= -0.25);
    if (!ok) {
      directionIssue = 'need_down';
      actions.push('gira tu mano apuntando los dedos hacia abajo');
    }
  } else if (profile.handDirection === 'HORIZONTAL') {
    const horizontalIdx =
      Math.abs(anatomy.indexDirX) >= 0.5 && Math.abs(anatomy.indexDirY) <= 0.75;
    const horizontalPalm =
      Math.abs(anatomy.palmDirX) >= 0.5 && Math.abs(anatomy.palmDirY) <= 0.75;
    const ok = recordCheck(horizontalIdx || horizontalPalm);
    if (!ok) {
      directionIssue = 'need_horizontal';
      actions.push('apunta los dedos horizontalmente hacia un lado');
    }
  } else if (profile.handDirection === 'TILTED') {
    const tiltedPalm =
      Math.abs(anatomy.palmDirX) >= 0.22 &&
      Math.abs(anatomy.palmDirX) <= 0.94 &&
      anatomy.palmDirY >= 0.14;
    const tiltedIdx =
      Math.abs(anatomy.indexDirX) >= 0.22 &&
      Math.abs(anatomy.indexDirX) <= 0.94 &&
      anatomy.indexDirY >= 0.14;
    const ok = recordCheck(tiltedPalm || tiltedIdx);
    if (!ok) {
      directionIssue = 'need_tilted';
      actions.push('inclina tu mano plana en diagonal formando un techo');
    }
  }

  const postureMatched = actions.length === 0;
  const postureScore = totalChecks > 0 ? passedChecks / totalChecks : postureMatched ? 1 : 0;

  return {
    postureMatched,
    postureScore,
    fingerStatus,
    actions,
    orientationIssue,
    directionIssue,
  };
}

/**
 * Normalizes heterogeneous `historyMs` samples into a clean time-sorted array of motion features.
 */
function buildMotionSamples(historyMs, currentSample, windowMs, handId, aspectRatio) {
  const rawList = Array.isArray(historyMs) ? historyMs : [];
  const samples = [];

  const pushSample = (entry) => {
    if (!entry) return;
    if (Array.isArray(entry)) {
      if (!hasAllValidPoints(entry)) return;
      const iso = Math.abs(aspectRatio - 1.0) > 1e-6 ? projectIsotropic(entry, aspectRatio) : entry;
      const scale = palmScale(iso);
      if (!Number.isFinite(scale) || scale < 1e-4) return;
      const normal = computePalmNormal(iso);
      samples.push({
        tMs: null,
        wristX: iso[HAND_LANDMARKS.WRIST].x,
        wristY: iso[HAND_LANDMARKS.WRIST].y,
        indexX: iso[HAND_LANDMARKS.INDEX_TIP].x,
        indexY: iso[HAND_LANDMARKS.INDEX_TIP].y,
        pinkyX: iso[HAND_LANDMARKS.PINKY_TIP].x,
        pinkyY: iso[HAND_LANDMARKS.PINKY_TIP].y,
        scale,
        signedFrontZ: computeSignedFrontZ(normal, handId),
        landmarks: entry,
        aspectRatio,
        handId,
      });
      return;
    }

    if (typeof entry !== 'object') return;
    // Skip entries explicitly tagged for the opposite anatomical hand
    if (handId && entry.handId && entry.handId !== handId) return;

    const tMs = extractTimestampMs(entry);
    const entryAspect = entry.aspectRatio ?? aspectRatio;
    const entryHandId = entry.handId ?? handId;

    if (Array.isArray(entry.landmarks) && hasAllValidPoints(entry.landmarks)) {
      const iso =
        Math.abs(entryAspect - 1.0) > 1e-6
          ? projectIsotropic(entry.landmarks, entryAspect)
          : entry.landmarks;
      const scale = palmScale(iso);
      if (!Number.isFinite(scale) || scale < 1e-4) return;
      const normal = computePalmNormal(iso);
      samples.push({
        tMs,
        wristX: iso[HAND_LANDMARKS.WRIST].x,
        wristY: iso[HAND_LANDMARKS.WRIST].y,
        indexX: iso[HAND_LANDMARKS.INDEX_TIP].x,
        indexY: iso[HAND_LANDMARKS.INDEX_TIP].y,
        pinkyX: iso[HAND_LANDMARKS.PINKY_TIP].x,
        pinkyY: iso[HAND_LANDMARKS.PINKY_TIP].y,
        scale,
        signedFrontZ:
          typeof entry.signedFrontZ === 'number'
            ? entry.signedFrontZ
            : computeSignedFrontZ(normal, entryHandId),
        landmarks: entry.landmarks,
        aspectRatio: entryAspect,
        handId: entryHandId,
      });
      return;
    }

    if (typeof entry.wristX === 'number' && typeof entry.scale === 'number' && entry.scale > 0) {
      samples.push({
        tMs,
        wristX: entry.wristX,
        wristY: entry.wristY ?? 0.5,
        indexX: entry.indexX ?? entry.wristX,
        indexY: entry.indexY ?? entry.wristY ?? 0.5,
        pinkyX: entry.pinkyX ?? entry.wristX,
        pinkyY: entry.pinkyY ?? entry.wristY ?? 0.5,
        scale: entry.scale,
        signedFrontZ: entry.signedFrontZ ?? 0,
        landmarks: null,
        aspectRatio: entryAspect,
        handId: entryHandId,
      });
    }
  };

  for (let i = 0; i < rawList.length; i++) {
    pushSample(rawList[i]);
  }

  // Append current frame if not already the final sample in `historyMs`
  if (currentSample) {
    const last = samples[samples.length - 1];
    const isDuplicate =
      last &&
      currentSample.tMs !== null &&
      last.tMs !== null &&
      Math.abs(last.tMs - currentSample.tMs) < 1e-3;
    if (!isDuplicate) {
      samples.push(currentSample);
    }
  }

  const hasTimestamps = samples.some((s) => s.tMs !== null);
  if (!hasTimestamps) return { samples, hasTimestamps: false };

  const latestT = samples[samples.length - 1]?.tMs;
  if (latestT === null || latestT === undefined) {
    return { samples, hasTimestamps: false };
  }

  const active = samples.filter((s) => s.tMs === null || latestT - s.tMs <= windowMs);
  return { samples: active, hasTimestamps: true, latestT };
}

/**
 * Computes 1D span, path travel, turning-point reversals, and recency along a coordinate getter.
 */
function analyzeAxisSeries(samples, coordKey, avgScale, minHalfAmpRatio = 0.14) {
  const minHalfAmp = minHalfAmpRatio * avgScale;
  const motionEps = 0.04 * avgScale;

  let minVal = Infinity;
  let maxVal = -Infinity;
  let totalTravel = 0;
  let reversals = 0;
  let trend = 0;
  let anchor = samples[0][coordKey];
  let ext = anchor;
  let lastMotionVal = anchor;
  let lastMotionT = samples[0].tMs;

  for (let i = 0; i < samples.length; i++) {
    const v = samples[i][coordKey];
    const tMs = samples[i].tMs;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;

    if (i > 0) {
      totalTravel += Math.abs(v - samples[i - 1][coordKey]);
      if (Math.abs(v - lastMotionVal) >= motionEps) {
        lastMotionVal = v;
        lastMotionT = tMs;
      }

      if (trend === 0) {
        if (v - anchor >= minHalfAmp) {
          trend = 1;
          ext = v;
        } else if (anchor - v >= minHalfAmp) {
          trend = -1;
          ext = v;
        }
      } else if (trend === 1) {
        if (v > ext) {
          ext = v;
        } else if (ext - v >= minHalfAmp) {
          reversals++;
          anchor = ext;
          trend = -1;
          ext = v;
        }
      } else if (v < ext) {
        ext = v;
      } else if (v - ext >= minHalfAmp) {
        reversals++;
        anchor = ext;
        trend = 1;
        ext = v;
      }
    }
  }

  return {
    minVal,
    maxVal,
    span: Math.max(0, maxVal - minVal),
    totalTravel,
    reversals,
    lastMotionT,
  };
}

/**
 * Evaluates a dynamic sign's temporal trajectory over real `t_ms` timestamps.
 * Strictly FPS-independent and scale-normalized by average `palmScale`.
 */
export function evaluateDynamicMotion(
  historyMs,
  { motionType, windowMs = 900, handId = null, aspectRatio = 1.0, currentSample = null } = {}
) {
  if (!motionType) {
    return { matched: true, motionType: null, metrics: {} };
  }

  const { samples, hasTimestamps, latestT } = buildMotionSamples(
    historyMs,
    currentSample,
    windowMs,
    handId,
    aspectRatio
  );

  if (samples.length < 3) {
    return { matched: false, motionType, metrics: { sampleCount: samples.length } };
  }

  let scaleSum = 0;
  let minScale = Infinity;
  let maxScale = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    scaleSum += samples[i].scale;
    if (samples[i].scale < minScale) minScale = samples[i].scale;
    if (samples[i].scale > maxScale) maxScale = samples[i].scale;
  }
  const avgScale = scaleSum / samples.length;
  if (!Number.isFinite(avgScale) || avgScale < 1e-5) {
    return { matched: false, motionType, metrics: { avgScale: 0 } };
  }

  const isRecent = (refT, maxIdleTailMs = 450) => {
    if (!hasTimestamps || latestT === null || refT === null || refT === undefined) return true;
    return latestT - refT <= maxIdleTailMs;
  };

  if (motionType === 'wave') {
    const wave = detectWaveMotion(samples, {
      waveWindowMs: windowMs,
      minHalfAmpRatio: 0.18,
      minReversals: 2,
      maxIdleTailMs: 340,
      aspectRatio,
    });
    return { matched: wave.isWaving, motionType, metrics: wave };
  }

  if (motionType === 'rotation') {
    const rot = detectPalmRotation(samples, {
      rotationWindowMs: windowMs,
      minFlips: 1,
      minSpan: 0.85,
      maxIdleTailMs: 380,
      aspectRatio,
      handId,
    });
    return { matched: rot.isRotating, motionType, metrics: rot };
  }

  if (motionType === 'wrist_twist') {
    const rot = detectPalmRotation(samples, {
      rotationWindowMs: windowMs,
      frontThreshold: 0.2,
      backThreshold: -0.2,
      minFlips: 1,
      minSpan: 0.45,
      maxIdleTailMs: 420,
      aspectRatio,
      handId,
    });
    const xStats = analyzeAxisSeries(samples, 'indexX', avgScale, 0.12);
    const twistOk =
      rot.isRotating ||
      rot.zSpan >= 0.45 ||
      (xStats.reversals >= 1 && xStats.span >= 0.2 * avgScale && isRecent(xStats.lastMotionT, 440));
    return {
      matched: twistOk,
      motionType,
      metrics: { zSpan: rot.zSpan, xSpan: xStats.span / avgScale, reversals: xStats.reversals },
    };
  }

  if (motionType === 'lateral_shake') {
    const wX = analyzeAxisSeries(samples, 'wristX', avgScale, 0.12);
    const iX = analyzeAxisSeries(samples, 'indexX', avgScale, 0.12);
    const best = iX.span >= wX.span ? iX : wX;
    const matched =
      isRecent(best.lastMotionT, 440) &&
      ((best.reversals >= 1 && best.span >= 0.2 * avgScale) ||
        (best.totalTravel >= 0.34 * avgScale && best.span >= 0.24 * avgScale));
    return {
      matched,
      motionType,
      metrics: {
        xSpanRatio: Number((best.span / avgScale).toFixed(3)),
        reversals: best.reversals,
      },
    };
  }

  if (motionType === 'vertical_nod') {
    const wY = analyzeAxisSeries(samples, 'wristY', avgScale, 0.11);
    const iY = analyzeAxisSeries(samples, 'indexY', avgScale, 0.11);
    const best = iY.span >= wY.span ? iY : wY;
    const matched =
      isRecent(best.lastMotionT, 440) &&
      ((best.reversals >= 1 && best.span >= 0.18 * avgScale) ||
        (best.totalTravel >= 0.32 * avgScale && best.span >= 0.22 * avgScale));
    return {
      matched,
      motionType,
      metrics: {
        ySpanRatio: Number((best.span / avgScale).toFixed(3)),
        reversals: best.reversals,
      },
    };
  }

  if (motionType === 'upward') {
    // In camera coordinates, moving UP decreases Y (`maxYBeforeEnd - endY > 0`)
    const end = samples[samples.length - 1];
    let maxY = -Infinity;
    let lastUpT = null;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].wristY > maxY) maxY = samples[i].wristY;
      if (i > 0 && samples[i - 1].wristY - samples[i].wristY >= 0.03 * avgScale) {
        lastUpT = samples[i].tMs;
      }
    }
    const upwardDrop = maxY - end.wristY;
    const matched = upwardDrop >= 0.22 * avgScale && isRecent(lastUpT, 450);
    return {
      matched,
      motionType,
      metrics: { upwardRatio: Number((upwardDrop / avgScale).toFixed(3)) },
    };
  }

  if (motionType === 'downward') {
    // In camera coordinates, moving DOWN increases Y (`endY - minYBeforeEnd > 0`)
    const end = samples[samples.length - 1];
    let minY = Infinity;
    let lastDownT = null;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].wristY < minY) minY = samples[i].wristY;
      if (i > 0 && samples[i].wristY - samples[i - 1].wristY >= 0.03 * avgScale) {
        lastDownT = samples[i].tMs;
      }
    }
    const downwardDrop = end.wristY - minY;
    const matched = downwardDrop >= 0.22 * avgScale && isRecent(lastDownT, 450);
    return {
      matched,
      motionType,
      metrics: { downwardRatio: Number((downwardDrop / avgScale).toFixed(3)) },
    };
  }

  if (motionType === 'j_curve') {
    // Pinky tip traces downward drop + lateral curve
    const first = samples[0];
    const pX = analyzeAxisSeries(samples, 'pinkyX', avgScale, 0.1);
    const pY = analyzeAxisSeries(samples, 'pinkyY', avgScale, 0.1);
    const dropFromStart = pY.maxVal - first.pinkyY;
    const latestMotionT = Math.max(pX.lastMotionT ?? -Infinity, pY.lastMotionT ?? -Infinity);
    const refT = Number.isFinite(latestMotionT) ? latestMotionT : null;
    const matched =
      dropFromStart >= 0.2 * avgScale &&
      pX.span >= 0.16 * avgScale &&
      isRecent(refT, 480);
    return {
      matched,
      motionType,
      metrics: {
        dropRatio: Number((dropFromStart / avgScale).toFixed(3)),
        xSpanRatio: Number((pX.span / avgScale).toFixed(3)),
      },
    };
  }

  if (motionType === 'z_trace') {
    // Index tip traces horizontal + diagonal down + horizontal (requires >= 1 X reversal + Y drop)
    const iX = analyzeAxisSeries(samples, 'indexX', avgScale, 0.14);
    const iY = analyzeAxisSeries(samples, 'indexY', avgScale, 0.1);
    const latestMotionT = Math.max(iX.lastMotionT ?? -Infinity, iY.lastMotionT ?? -Infinity);
    const refT = Number.isFinite(latestMotionT) ? latestMotionT : null;
    const matched =
      iX.span >= 0.26 * avgScale &&
      iY.span >= 0.18 * avgScale &&
      iX.reversals >= 1 &&
      isRecent(refT, 520);
    return {
      matched,
      motionType,
      metrics: {
        xSpanRatio: Number((iX.span / avgScale).toFixed(3)),
        ySpanRatio: Number((iY.span / avgScale).toFixed(3)),
        reversalsX: iX.reversals,
      },
    };
  }

  if (motionType === 'pull_back') {
    // Short purposeful pull/glide in 2D or Z (scale change)
    let path2D = 0;
    let lastMoveT = null;
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].wristX - samples[i - 1].wristX;
      const dy = samples[i].wristY - samples[i - 1].wristY;
      const step = Math.sqrt(dx * dx + dy * dy);
      path2D += step;
      if (step >= 0.03 * avgScale || Math.abs(samples[i].scale - samples[i - 1].scale) >= 0.02 * avgScale) {
        lastMoveT = samples[i].tMs;
      }
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    const netDisp2D = Math.sqrt(
      (last.wristX - first.wristX) ** 2 + (last.wristY - first.wristY) ** 2
    );
    const scaleSpan = maxScale - minScale;
    const matched =
      isRecent(lastMoveT, 450) &&
      (netDisp2D >= 0.2 * avgScale || path2D >= 0.34 * avgScale || scaleSpan >= 0.12 * avgScale);
    return {
      matched,
      motionType,
      metrics: {
        netDispRatio: Number((netDisp2D / avgScale).toFixed(3)),
        pathRatio: Number((path2D / avgScale).toFixed(3)),
        scaleSpanRatio: Number((scaleSpan / avgScale).toFixed(3)),
      },
    };
  }

  if (motionType === 'circle') {
    // Smooth orbital motion in XY plane
    const wX = analyzeAxisSeries(samples, 'wristX', avgScale, 0.1);
    const wY = analyzeAxisSeries(samples, 'wristY', avgScale, 0.1);
    let path2D = 0;
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].wristX - samples[i - 1].wristX;
      const dy = samples[i].wristY - samples[i - 1].wristY;
      path2D += Math.sqrt(dx * dx + dy * dy);
    }
    const latestMotionT = Math.max(wX.lastMotionT ?? -Infinity, wY.lastMotionT ?? -Infinity);
    const refT = Number.isFinite(latestMotionT) ? latestMotionT : null;
    const matched =
      wX.span >= 0.18 * avgScale &&
      wY.span >= 0.18 * avgScale &&
      path2D >= 0.68 * avgScale &&
      (wX.reversals >= 1 || wY.reversals >= 1) &&
      isRecent(refT, 480);
    return {
      matched,
      motionType,
      metrics: {
        xSpanRatio: Number((wX.span / avgScale).toFixed(3)),
        ySpanRatio: Number((wY.span / avgScale).toFixed(3)),
        pathRatio: Number((path2D / avgScale).toFixed(3)),
      },
    };
  }

  return { matched: false, motionType, metrics: { unknownMotion: true } };
}

function evaluateSingleCandidate(candidate, sign, historyMs, { aspectRatio, timestampMs, detectedLabel }) {
  const { handId, landmarks } = candidate;

  if (!hasAllValidPoints(landmarks)) {
    return {
      matched: false,
      postureMatched: false,
      motionMatched: false,
      confidence: 0,
      status: 'no_hand',
      message: 'Coloca tu mano frente a la cámara con los dedos bien visibles.',
      actions: ['Coloca tu mano frente a la cámara'],
      fingerStatus: buildFingerStatus('idle'),
      handId: null,
      targetId: sign.id,
      targetLabel: sign.label,
      detectedLabel: null,
      orientationIssue: null,
      directionIssue: null,
      motionIssue: null,
      distanceIssue: null,
      states: null,
      motion: null,
      _rankScore: -1,
    };
  }

  const iso = Math.abs(aspectRatio - 1.0) > 1e-6 ? projectIsotropic(landmarks, aspectRatio) : landmarks;
  const scale = palmScale(iso);

  if (scale < MIN_PRACTICE_PALM_SCALE) {
    return {
      matched: false,
      postureMatched: false,
      motionMatched: false,
      confidence: 0,
      status: 'distance_adjust',
      message: 'Acerca un poco más tu mano a la cámara para ver mejor tus dedos.',
      actions: ['Acerca un poco más tu mano'],
      fingerStatus: buildFingerStatus('idle'),
      handId,
      targetId: sign.id,
      targetLabel: sign.label,
      detectedLabel: null,
      orientationIssue: null,
      directionIssue: null,
      motionIssue: null,
      distanceIssue: 'too_far',
      states: null,
      motion: null,
      _rankScore: 0.05,
    };
  }

  if (scale > MAX_PRACTICE_PALM_SCALE) {
    return {
      matched: false,
      postureMatched: false,
      motionMatched: false,
      confidence: 0,
      status: 'distance_adjust',
      message: 'Aleja un poco tu mano para que quepa completa en la cámara.',
      actions: ['Aleja un poco tu mano'],
      fingerStatus: buildFingerStatus('idle'),
      handId,
      targetId: sign.id,
      targetLabel: sign.label,
      detectedLabel: null,
      orientationIssue: null,
      directionIssue: null,
      motionIssue: null,
      distanceIssue: 'too_close',
      states: null,
      motion: null,
      _rankScore: 0.05,
    };
  }

  if (!isValidHandLandmarks(landmarks, { aspectRatio })) {
    return {
      matched: false,
      postureMatched: false,
      motionMatched: false,
      confidence: 0,
      status: 'adjust_posture',
      message: 'Mantén tu mano completa y clara frente a la cámara.',
      actions: ['Mantén tu mano visible frente a la cámara'],
      fingerStatus: buildFingerStatus('idle'),
      handId,
      targetId: sign.id,
      targetLabel: sign.label,
      detectedLabel: null,
      orientationIssue: null,
      directionIssue: null,
      motionIssue: null,
      distanceIssue: null,
      states: null,
      motion: null,
      _rankScore: 0.02,
    };
  }

  const anatomy = computeExtendedAnatomy(landmarks, aspectRatio, handId);
  if (!anatomy) {
    return {
      matched: false,
      postureMatched: false,
      motionMatched: false,
      confidence: 0,
      status: 'adjust_posture',
      message: 'Ajusta tu mano frente a la cámara para detectarla mejor.',
      actions: ['Ajusta tu mano frente a la cámara'],
      fingerStatus: buildFingerStatus('idle'),
      handId,
      targetId: sign.id,
      targetLabel: sign.label,
      detectedLabel: null,
      orientationIssue: null,
      directionIssue: null,
      motionIssue: null,
      distanceIssue: null,
      states: null,
      motion: null,
      _rankScore: 0.02,
    };
  }

  const posture = evaluateStaticPosture(anatomy, sign);
  const currentSample = {
    tMs: timestampMs,
    wristX: anatomy.iso[HAND_LANDMARKS.WRIST].x,
    wristY: anatomy.iso[HAND_LANDMARKS.WRIST].y,
    indexX: anatomy.iso[HAND_LANDMARKS.INDEX_TIP].x,
    indexY: anatomy.iso[HAND_LANDMARKS.INDEX_TIP].y,
    pinkyX: anatomy.iso[HAND_LANDMARKS.PINKY_TIP].x,
    pinkyY: anatomy.iso[HAND_LANDMARKS.PINKY_TIP].y,
    scale,
    signedFrontZ: anatomy.states.signedFrontZ,
    landmarks,
    aspectRatio,
    handId,
  };

  const motion = sign.profile.dynamicMotion
    ? evaluateDynamicMotion(historyMs, {
        motionType: sign.profile.dynamicMotion,
        windowMs: sign.profile.motionWindowMs || 900,
        handId,
        aspectRatio,
        currentSample,
      })
    : { matched: true, motionType: null, metrics: {} };

  const matched = posture.postureMatched && motion.matched;

  if (matched) {
    const confidence = Number(
      Math.min(0.98, 0.78 + 0.18 * clamp01(posture.postureScore)).toFixed(4)
    );
    const message = sign.profile.dynamicMotion
      ? `¡Excelente movimiento! Seña '${sign.displayName}' detectada.`
      : `¡Muy bien! Mantén '${sign.displayName}' firme un momento.`;

    return {
      matched: true,
      postureMatched: true,
      motionMatched: true,
      confidence,
      status: 'match',
      message,
      actions: [],
      fingerStatus: buildFingerStatus('ok'),
      handId,
      targetId: sign.id,
      targetLabel: sign.label,
      detectedLabel: sign.label,
      orientationIssue: null,
      directionIssue: null,
      motionIssue: null,
      distanceIssue: null,
      states: anatomy.states,
      motion,
      _rankScore: 2.0 + confidence,
    };
  }

  // Posture is right, only dynamic trajectory is missing -> coach specifically on the motion!
  if (posture.postureMatched && !motion.matched) {
    const motionAction =
      sign.profile.motionHint || 'realiza el movimiento indicado para completar esta seña';
    return {
      matched: false,
      postureMatched: true,
      motionMatched: false,
      confidence: Number((0.55 * posture.postureScore).toFixed(4)),
      status: 'adjust_posture',
      message: `¡Buena postura! Ahora ${motionAction}.`,
      actions: [motionAction],
      fingerStatus: buildFingerStatus('ok'),
      handId,
      targetId: sign.id,
      targetLabel: sign.label,
      detectedLabel: null,
      orientationIssue: null,
      directionIssue: null,
      motionIssue: `need_${sign.profile.dynamicMotion}`,
      distanceIssue: null,
      states: anatomy.states,
      motion,
      _rankScore: 1.5,
    };
  }

  // Posture needs anatomical correction
  const actions = posture.actions;
  const actionText =
    actions.length === 0
      ? `ajusta ligeramente tus dedos para formar '${sign.displayName}'`
      : actions.length === 1
        ? actions[0]
        : `${actions[0]} y ${actions[1]}`;

  const isTargetAlias =
    detectedLabel &&
    (detectedLabel === sign.label ||
      (Array.isArray(sign.aliases) && sign.aliases.includes(detectedLabel)));
  const isWrongSign = Boolean(detectedLabel && !isTargetAlias);

  const message = isWrongSign
    ? `Estás haciendo '${detectedLabel}', ${actionText}.`
    : `${capitalize(actionText)}.`;

  return {
    matched: false,
    postureMatched: false,
    motionMatched: motion.matched,
    confidence: Number((0.45 * posture.postureScore).toFixed(4)),
    status: isWrongSign ? 'wrong_sign' : 'adjust_posture',
    message,
    actions,
    fingerStatus: posture.fingerStatus,
    handId,
    targetId: sign.id,
    targetLabel: sign.label,
    detectedLabel: isWrongSign ? detectedLabel : null,
    orientationIssue: posture.orientationIssue,
    directionIssue: posture.directionIssue,
    motionIssue: null,
    distanceIssue: null,
    states: anatomy.states,
    motion,
    _rankScore: 0.2 + posture.postureScore,
  };
}

/**
 * Evaluates a user's live hand frame against the exact anatomical and temporal (`t_ms`)
 * criteria of a target sign from the LSM learning catalog.
 *
 * @param {Array|Object|null} handData Raw frame from `SignEngine`, `{ landmarks, handId }`, or 21-point array
 * @param {Object|string} targetSign Sign object from `ALL_LEARNING_SIGNS`, sign `id`, or canonical `label`
 * @param {Array<Object>} [historyMs=[]] Time-stamped recent hand samples (`t_ms` / `tMs` / `timestamp`)
 * @param {Object} [options]
 * @param {number} [options.aspectRatio]
 * @param {number|null} [options.timestampMs]
 * @param {string|null} [options.preferredHandId]
 * @param {string|null} [options.detectedLabel] Optional free-classifier label for extra coaching context
 */
export function evaluateTargetSign(handData, targetSign, historyMs = [], options = {}) {
  const sign = resolveTargetSign(targetSign);
  if (!sign) {
    return {
      matched: false,
      postureMatched: false,
      motionMatched: false,
      confidence: 0,
      status: 'no_hand',
      message: 'Selecciona una seña del catálogo para comenzar a practicar.',
      actions: [],
      fingerStatus: buildFingerStatus('idle'),
      handId: null,
      targetId: null,
      targetLabel: null,
      detectedLabel: null,
      orientationIssue: null,
      directionIssue: null,
      motionIssue: null,
      distanceIssue: null,
      states: null,
      motion: null,
    };
  }

  const candidates = extractCandidates(handData);
  if (candidates.length === 0) {
    return {
      matched: false,
      postureMatched: false,
      motionMatched: false,
      confidence: 0,
      status: 'no_hand',
      message: 'Coloca tu mano frente a la cámara con los dedos bien visibles.',
      actions: ['Coloca tu mano frente a la cámara'],
      fingerStatus: buildFingerStatus('idle'),
      handId: null,
      targetId: sign.id,
      targetLabel: sign.label,
      detectedLabel: null,
      orientationIssue: null,
      directionIssue: null,
      motionIssue: null,
      distanceIssue: null,
      states: null,
      motion: null,
    };
  }

  const aspectRatio =
    options.aspectRatio ??
    (handData && !Array.isArray(handData) ? resolveAspectRatio(handData) : 1.0);
  const timestampMs = options.timestampMs ?? extractTimestampMs(handData);
  const preferredHandId = options.preferredHandId ?? null;
  const detectedLabel = options.detectedLabel ?? null;

  const results = candidates.map((cand) =>
    evaluateSingleCandidate(cand, sign, historyMs, {
      aspectRatio,
      timestampMs,
      detectedLabel,
    })
  );

  // Choose the best matching hand (honoring preferredHandId when both hands match)
  let chosen = results[0];
  if (results.length > 1) {
    const matchedOnes = results.filter((r) => r.matched);
    if (matchedOnes.length > 0) {
      const preferredMatch = preferredHandId
        ? matchedOnes.find((r) => r.handId === preferredHandId)
        : null;
      chosen = preferredMatch || matchedOnes[0];
    } else {
      const preferred = preferredHandId
        ? results.find((r) => r.handId === preferredHandId && r.states !== null)
        : null;
      results.sort((a, b) => b._rankScore - a._rankScore);
      chosen =
        preferred && results[0]._rankScore - preferred._rankScore < 0.25 ? preferred : results[0];
    }
  }

  const { _rankScore: _ignored, ...cleanResult } = chosen;
  return cleanResult;
}

/**
 * Stateful live-practice controller wrapping `evaluateTargetSign`:
 * - Maintains per-hand time-bounded `historyMs` buffers (in real `t_ms`)
 * - Applies brief temporal stabilization (`staticMinStableMs`) so 1-frame glitches never count
 * - Confirms dynamic trajectories immediately once verified in `t_ms`
 * - Outputs `stabilityProgress` (`0..1`) for the live camera progress bar
 */
export class TargetedPracticeEvaluator {
  constructor(targetSign, { staticMinStableMs = 220, maxHistoryMs = HISTORY_RETENTION_MS } = {}) {
    this.targetSign = resolveTargetSign(targetSign);
    this.staticMinStableMs = Math.max(0, staticMinStableMs);
    this.maxHistoryMs = Math.max(600, maxHistoryMs);
    this._resetInternal();
  }

  _resetInternal() {
    this._historyByHand = new Map();
    this._matchSinceByHand = new Map();
    this._lastTimestampMs = null;
  }

  reset(newTargetSign = this.targetSign) {
    this.targetSign = resolveTargetSign(newTargetSign);
    this._resetInternal();
  }

  _recordHands(frameData, timestampMs, aspectRatio) {
    const candidates = extractCandidates(frameData);
    for (let i = 0; i < candidates.length; i++) {
      const { handId, landmarks } = candidates[i];
      if (!hasAllValidPoints(landmarks)) continue;
      const iso =
        Math.abs(aspectRatio - 1.0) > 1e-6 ? projectIsotropic(landmarks, aspectRatio) : landmarks;
      const scale = palmScale(iso);
      if (!Number.isFinite(scale) || scale < 1e-4) continue;
      const normal = computePalmNormal(iso);
      const entry = {
        t_ms: timestampMs,
        tMs: timestampMs,
        handId,
        aspectRatio,
        scale,
        wristX: iso[HAND_LANDMARKS.WRIST].x,
        wristY: iso[HAND_LANDMARKS.WRIST].y,
        indexX: iso[HAND_LANDMARKS.INDEX_TIP].x,
        indexY: iso[HAND_LANDMARKS.INDEX_TIP].y,
        pinkyX: iso[HAND_LANDMARKS.PINKY_TIP].x,
        pinkyY: iso[HAND_LANDMARKS.PINKY_TIP].y,
        signedFrontZ: computeSignedFrontZ(normal, handId),
        landmarks,
      };
      let buf = this._historyByHand.get(handId);
      if (!buf) {
        buf = [];
        this._historyByHand.set(handId, buf);
      }
      buf.push(entry);
      while (buf.length > 1 && timestampMs - buf[0].tMs > this.maxHistoryMs) {
        buf.shift();
      }
      while (buf.length > MAX_HISTORY_SAMPLES) {
        buf.shift();
      }
    }
  }

  /**
   * Evaluates one camera frame and updates internal `t_ms` buffers & hold stabilization.
   *
   * @param {Object|Array|null} frameData
   * @param {Object} [options]
   * @param {number} [options.timestampMs]
   * @param {string|null} [options.preferredHandId]
   * @param {string|null} [options.detectedLabel]
   */
  evaluate(frameData, options = {}) {
    const timestampMs =
      typeof options.timestampMs === 'number' && Number.isFinite(options.timestampMs)
        ? options.timestampMs
        : extractTimestampMs(frameData) ?? Date.now();

    if (this._lastTimestampMs !== null && timestampMs < this._lastTimestampMs) {
      this._resetInternal();
    }
    this._lastTimestampMs = timestampMs;

    const aspectRatio =
      options.aspectRatio ??
      (frameData && !Array.isArray(frameData) ? resolveAspectRatio(frameData) : 1.0);

    this._recordHands(frameData, timestampMs, aspectRatio);

    // Build flattened recent history across tracked hands (evaluateTargetSign isolates by handId)
    const combinedHistory = [];
    for (const buf of this._historyByHand.values()) {
      for (let i = 0; i < buf.length; i++) {
        combinedHistory.push(buf[i]);
      }
    }

    const evaluation = evaluateTargetSign(frameData, this.targetSign, combinedHistory, {
      aspectRatio,
      timestampMs,
      preferredHandId: options.preferredHandId ?? null,
      detectedLabel: options.detectedLabel ?? null,
    });

    const isDynamic = Boolean(this.targetSign?.profile?.dynamicMotion);
    const activeHandId = evaluation.handId || 'hand_0';

    if (!evaluation.matched) {
      // Clear hold timer for hands not currently matching
      if (evaluation.handId) {
        this._matchSinceByHand.delete(evaluation.handId);
      } else {
        this._matchSinceByHand.clear();
      }
      return {
        confirmed: false,
        matched: false,
        stabilityProgress: 0,
        evaluation,
      };
    }

    if (isDynamic || this.staticMinStableMs <= 0) {
      return {
        confirmed: true,
        matched: true,
        stabilityProgress: 1,
        evaluation,
      };
    }

    let since = this._matchSinceByHand.get(activeHandId);
    if (since === undefined) {
      since = timestampMs;
      this._matchSinceByHand.set(activeHandId, since);
    }

    const heldMs = Math.max(0, timestampMs - since);
    const stabilityProgress = clamp01(heldMs / this.staticMinStableMs);
    const confirmed = heldMs >= this.staticMinStableMs;

    return {
      confirmed,
      matched: true,
      stabilityProgress: Number(stabilityProgress.toFixed(3)),
      evaluation,
    };
  }
}
