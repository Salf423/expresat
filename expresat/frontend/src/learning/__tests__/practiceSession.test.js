import { describe, it, expect } from 'vitest';
import { SIGN_LABELS } from '../../recognition/index.js';
import {
  REPS_PER_HAND,
  normalizeHandSide,
  PracticeSessionMachine,
} from '../practiceSession.js';

describe('learning/practiceSession — Protocolo 5 derecha + 5 izquierda con anti-rebote', () => {
  it('normaliza correctamente la lateralidad de SignEngine y MediaPipe', () => {
    expect(normalizeHandSide('rightHand')).toBe('right');
    expect(normalizeHandSide('Right')).toBe('right');
    expect(normalizeHandSide('leftHand')).toBe('left');
    expect(normalizeHandSide('Left')).toBe('left');
    expect(normalizeHandSide('hand_0')).toBeNull();
    expect(normalizeHandSide(null)).toBeNull();
  });

  it('NO cuenta múltiples veces al mantener la mano quieta (exige bajar/liberar mano entre repeticiones)', () => {
    const session = new PracticeSessionMachine({
      targetLabel: SIGN_LABELS.UNO,
      repsPerHand: REPS_PER_HAND,
      releaseMs: 350,
      cooldownMs: 700,
    });

    // Mantener "Uno" con mano derecha de forma continua durante 3 segundos (cada 100ms)
    let snap = null;
    for (let t = 0; t <= 3000; t += 100) {
      snap = session.update({
        detectedLabel: SIGN_LABELS.UNO,
        handId: 'rightHand',
        timestampMs: t,
      });
    }

    expect(snap.rightCount).toBe(1);
    expect(snap.leftCount).toBe(0);
    expect(snap.awaitingRelease).toBe(true);
    expect(snap.completed).toBe(false);

    // Parpadeo corto de 150ms (< releaseMs=350ms) NO debe desbloquear nueva repetición
    session.update({ detectedLabel: null, handId: null, timestampMs: 3100 });
    session.update({ detectedLabel: null, handId: null, timestampMs: 3200 });
    snap = session.update({
      detectedLabel: SIGN_LABELS.UNO,
      handId: 'rightHand',
      timestampMs: 3250,
    });
    expect(snap.rightCount).toBe(1);

    // Liberar la mano durante >= 350ms sí desbloquea la siguiente repetición
    session.update({ detectedLabel: null, handId: null, timestampMs: 3400 });
    session.update({ detectedLabel: null, handId: null, timestampMs: 3800 });
    snap = session.update({
      detectedLabel: SIGN_LABELS.UNO,
      handId: 'rightHand',
      timestampMs: 3900,
    });
    expect(snap.rightCount).toBe(2);
    expect(snap.lastEvent?.type).toBe('rep_counted');
  });

  it('respeta cooldown mínimo por mano incluso tras liberación rápida', () => {
    const session = new PracticeSessionMachine({
      targetLabel: SIGN_LABELS.DOS,
      repsPerHand: 5,
      releaseMs: 200,
      cooldownMs: 800,
    });

    // Rep 1 a t=0
    let snap = session.update({
      detectedLabel: SIGN_LABELS.DOS,
      handId: 'leftHand',
      timestampMs: 0,
    });
    expect(snap.leftCount).toBe(1);

    // Libera 250ms (>= releaseMs), pero intenta repetir en t=500 (< cooldownMs=800)
    session.update({ detectedLabel: null, handId: null, timestampMs: 100 });
    session.update({ detectedLabel: null, handId: null, timestampMs: 350 });
    snap = session.update({
      detectedLabel: SIGN_LABELS.DOS,
      handId: 'leftHand',
      timestampMs: 500,
    });
    expect(snap.leftCount).toBe(1);

    // Al superar cooldown (t=900) cuenta rep 2
    snap = session.update({
      detectedLabel: SIGN_LABELS.DOS,
      handId: 'leftHand',
      timestampMs: 900,
    });
    expect(snap.leftCount).toBe(2);
  });

  it('completa 5 derecha -> pide cambiar a la otra mano -> completa 5 izquierda -> 10/10 completado', () => {
    const session = new PracticeSessionMachine({
      targetLabel: SIGN_LABELS.TRES,
      repsPerHand: 5,
      releaseMs: 300,
      cooldownMs: 600,
    });

    let t = 0;
    const performRep = (handId) => {
      const hit = session.update({
        detectedLabel: SIGN_LABELS.TRES,
        handId,
        timestampMs: t,
      });
      t += 200;
      session.update({ detectedLabel: null, handId: null, timestampMs: t });
      t += 400; // >= releaseMs (300) and total delta = 600 >= cooldownMs
      session.update({ detectedLabel: null, handId: null, timestampMs: t });
      t += 100;
      return hit;
    };

    // 5 repeticiones con la mano derecha
    let snap = null;
    for (let i = 1; i <= 5; i++) {
      snap = performRep('rightHand');
      expect(snap.rightCount).toBe(i);
      expect(snap.leftCount).toBe(0);
    }

    expect(snap.phase).toBe('switch_hand');
    expect(snap.completed).toBe(false);
    expect(snap.lastEvent?.type).toBe('hand_completed');
    expect(snap.promptMessage).toContain('¡Excelente! Ahora repite la seña 5 veces con tu otra mano');

    // Intentar una 6ta con la mano derecha NO sube de 5 ni completa la seña
    const extraRight = performRep('rightHand');
    expect(extraRight.rightCount).toBe(5);
    expect(extraRight.leftCount).toBe(0);
    expect(extraRight.completed).toBe(false);
    expect(extraRight.lastEvent?.type).toBe('hand_already_done');

    // 5 repeticiones con la mano izquierda
    for (let i = 1; i <= 5; i++) {
      snap = performRep('leftHand');
      expect(snap.leftCount).toBe(i);
    }

    expect(snap.rightCount).toBe(5);
    expect(snap.leftCount).toBe(5);
    expect(snap.totalCount).toBe(10);
    expect(snap.completed).toBe(true);
    expect(snap.phase).toBe('completed');
    expect(snap.lastEvent?.type).toBe('session_completed');
  });

  it('ignora señas incorrectas y reinicia limpiamente con reset()', () => {
    const session = new PracticeSessionMachine({ targetLabel: SIGN_LABELS.CINCO });

    const wrong = session.update({
      detectedLabel: SIGN_LABELS.UNO,
      handId: 'rightHand',
      timestampMs: 100,
    });
    expect(wrong.rightCount).toBe(0);
    expect(wrong.leftCount).toBe(0);

    const hit = session.update({
      detectedLabel: SIGN_LABELS.CINCO,
      handId: 'Left',
      timestampMs: 500,
    });
    expect(hit.leftCount).toBe(1);

    const afterReset = session.reset(SIGN_LABELS.HOLA);
    expect(afterReset.targetLabel).toBe(SIGN_LABELS.HOLA);
    expect(afterReset.rightCount).toBe(0);
    expect(afterReset.leftCount).toBe(0);
    expect(afterReset.completed).toBe(false);
    expect(afterReset.phase).toBe('practicing');
  });
});
