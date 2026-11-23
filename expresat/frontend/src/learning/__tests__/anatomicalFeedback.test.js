import { describe, it, expect } from 'vitest';
import {
  SIGN_LABELS,
  SYNTHETIC_PRESETS,
  classifyStaticHand,
  fingerStates,
} from '../../recognition/index.js';
import { generateAnatomicalCorrection } from '../anatomicalFeedback.js';

describe('learning/anatomicalFeedback — Corrección anatómica en vivo (Seña X vs Seña Y)', () => {
  it('indica colocar la mano frente a la cámara cuando no hay landmarks visibles', () => {
    const fb = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.DOS,
      detectedLabel: null,
      states: null,
    });
    expect(fb.status).toBe('no_hand');
    expect(fb.message.toLowerCase()).toContain('coloca tu mano frente a la cámara');
    expect(fb.fingerStatus.index).toBe('idle');
  });

  it('felicita y pide mantener firme cuando la seña detectada coincide con la seña objetivo', () => {
    const hand = SYNTHETIC_PRESETS.DOS({ handedness: 'Right' });
    const res = classifyStaticHand({ rightHand: hand });
    const fb = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.DOS,
      detectedLabel: res.label,
      states: res.states,
    });
    expect(fb.status).toBe('match');
    expect(fb.message).toContain('Dos');
    expect(fb.fingerStatus.index).toBe('ok');
    expect(fb.fingerStatus.middle).toBe('ok');
  });

  it("indica extender el dedo medio cuando el usuario hace 'Uno' en lugar de 'Dos'", () => {
    const hand = SYNTHETIC_PRESETS.UNO({ handedness: 'Right' });
    const res = classifyStaticHand({ rightHand: hand });
    expect(res.label).toBe(SIGN_LABELS.UNO);

    const fb = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.DOS,
      detectedLabel: res.label,
      states: res.states,
    });
    expect(fb.status).toBe('wrong_sign');
    expect(fb.message).toContain("Estás haciendo 'Uno'");
    expect(fb.message.toLowerCase()).toContain('extiende');
    expect(fb.message.toLowerCase()).toContain('medio');
    expect(fb.fingerStatus.index).toBe('ok');
    expect(fb.fingerStatus.middle).toBe('extend');
  });

  it("indica cerrar el dedo meñique cuando el usuario hace 'Cuernos' en lugar de 'Uno'", () => {
    const hand = SYNTHETIC_PRESETS.CUERNOS({ handedness: 'Left' });
    const res = classifyStaticHand({ leftHand: hand });
    expect(res.label).toBe(SIGN_LABELS.CUERNOS);

    const fb = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.UNO,
      detectedLabel: res.label,
      states: res.states,
    });
    expect(fb.status).toBe('wrong_sign');
    expect(fb.message).toContain("Estás haciendo 'Cuernos'");
    expect(fb.message.toLowerCase()).toContain('cierra');
    expect(fb.message.toLowerCase()).toContain('meñique');
    expect(fb.fingerStatus.pinky).toBe('curl');
  });

  it('corrige orientación palma vs dorso entre Cuatro y Nueve (y Bien vs Seis)', () => {
    // Objetivo Nueve (BACK), usuario hace Cuatro (FRONT)
    const handCuatro = SYNTHETIC_PRESETS.CUATRO({ handedness: 'Right' });
    const resCuatro = classifyStaticHand({ rightHand: handCuatro });
    const fbNueve = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.NUEVE,
      detectedLabel: resCuatro.label,
      states: resCuatro.states,
    });
    expect(fbNueve.status).toBe('wrong_sign');
    expect(fbNueve.orientationIssue).toBe('need_back');
    expect(fbNueve.message).toContain("Estás haciendo 'Cuatro'");
    expect(fbNueve.message.toLowerCase()).toContain('dorso');

    // Objetivo Bien (FRONT), usuario hace Seis (BACK)
    const handSeis = SYNTHETIC_PRESETS.SEIS({ handedness: 'Left' });
    const resSeis = classifyStaticHand({ leftHand: handSeis });
    const fbBien = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.BIEN,
      detectedLabel: resSeis.label,
      states: resSeis.states,
    });
    expect(fbBien.status).toBe('wrong_sign');
    expect(fbBien.orientationIssue).toBe('need_front');
    expect(fbBien.message).toContain("Estás haciendo 'Seis'");
    expect(fbBien.message.toLowerCase()).toContain('palma');
  });

  it('corrige señas especiales (OK/Pinza, Cero) y dinámicas (Hola, Diez)', () => {
    const handCinco = SYNTHETIC_PRESETS.CINCO({ handedness: 'Right' });
    const resCinco = classifyStaticHand({ rightHand: handCinco });

    // Objetivo OK / Pinza mientras hace Cinco
    const fbOk = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.OK,
      detectedLabel: resCinco.label,
      states: resCinco.states,
    });
    expect(fbOk.message.toLowerCase()).toContain('círculo');
    expect(fbOk.fingerStatus.thumb).toBe('adjust');
    expect(fbOk.fingerStatus.index).toBe('adjust');

    // Objetivo Hola mientras sostiene Cinco quieto
    const fbHola = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.HOLA,
      detectedLabel: resCinco.label,
      states: resCinco.states,
      wave: { isWaving: false, directionChanges: 0, totalAmplitude: 0 },
    });
    expect(fbHola.motionIssue).toBe('need_wave');
    expect(fbHola.message.toLowerCase()).toContain('lado a lado');

    // Objetivo Diez mientras sostiene Cinco quieto
    const fbDiez = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.DIEZ,
      detectedLabel: resCinco.label,
      states: resCinco.states,
      palmRotation: { isRotating: false, flipCount: 0, zSpan: 0 },
    });
    expect(fbDiez.motionIssue).toBe('need_rotation');
    expect(fbDiez.message.toLowerCase()).toContain('muñeca');

    // Objetivo Cero mientras hace Puño
    const handPuno = SYNTHETIC_PRESETS.PUNO({ handedness: 'Right' });
    const resPuno = classifyStaticHand({ rightHand: handPuno });
    const fbCero = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.CERO,
      detectedLabel: resPuno.label,
      states: resPuno.states,
    });
    expect(fbCero.status).toBe('wrong_sign');
    expect(fbCero.message.toLowerCase()).toMatch(/óvalo|pulgar/);
  });

  it('guía posturas incompletas (detectedLabel=null) como pulgar hacia abajo para Bien', () => {
    const thumbsDown = SYNTHETIC_PRESETS.BIEN({ handedness: 'Left', rotateDeg: 180 });
    const states = fingerStates(thumbsDown, { handId: 'leftHand' });
    const fb = generateAnatomicalCorrection({
      targetLabel: SIGN_LABELS.BIEN,
      detectedLabel: null,
      states,
      reason: 'THUMB_NOT_UPWARD',
    });
    expect(fb.status).toBe('adjust_posture');
    expect(fb.message.toLowerCase()).toContain('pulgar hacia arriba');
  });
});
