import { describe, it, expect } from 'vitest';
import {
  SIGN_LABELS,
  SmoothingVoter,
  GeometricClassifier,
  detectWaveMotion,
  SYNTHETIC_PRESETS,
} from '../index.js';

describe('recognition/temporal — Estabilidad en t_ms, histéresis, onda dinámica y cooldown', () => {
  it('SmoothingVoter confirma en tiempo real equivalente (~260–350 ms) a 10 FPS, 15 FPS y 30 FPS', () => {
    const confirmTimes = {};
    for (const fps of [10, 15, 30]) {
      const voter = new SmoothingVoter({
        windowMs: 450,
        minStableMs: 260,
        enterRatio: 0.55,
        exitRatio: 0.3,
        minVotes: 2,
      });
      const dt = 1000 / fps;
      let confirmedAtMs = null;
      for (let i = 0; i < Math.ceil(fps * 1.5); i++) {
        const tMs = Math.round(i * dt);
        const res = voter.push({ label: SIGN_LABELS.UNO, confidence: 0.94 }, tMs);
        if (res.label === SIGN_LABELS.UNO && confirmedAtMs === null) {
          confirmedAtMs = tMs;
        }
      }
      confirmTimes[fps] = confirmedAtMs;
      expect(confirmedAtMs).not.toBeNull();
      expect(confirmedAtMs).toBeGreaterThanOrEqual(250);
      expect(confirmedAtMs).toBeLessThanOrEqual(350);
    }
    // Diferencia entre 10 FPS y 30 FPS acotada a <= 100 ms (no 3x)
    expect(Math.abs(confirmTimes[10] - confirmTimes[30])).toBeLessThanOrEqual(100);
  });

  it('SmoothingVoter aplica histéresis (tolera 1-2 frames ruidosos pero expira al volver a reposo)', () => {
    const voter = new SmoothingVoter({
      windowMs: 450,
      minStableMs: 260,
      enterRatio: 0.55,
      exitRatio: 0.3,
      releaseMs: 360,
      minVotes: 2,
    });

    // Estabilizar "Dos" durante 400 ms a 15 FPS
    let t = 0;
    let last = null;
    for (let i = 0; i <= 6; i++) {
      t = Math.round(i * 66.7);
      last = voter.push({ label: SIGN_LABELS.DOS, confidence: 0.95 }, t);
    }
    expect(last.label).toBe(SIGN_LABELS.DOS);

    // 2 frames aislados de ruido/null no rompen el consenso confirmado (histéresis)
    t += 67;
    expect(voter.push({ label: null, confidence: 0 }, t).label).toBe(SIGN_LABELS.DOS);
    t += 67;
    expect(voter.push({ label: SIGN_LABELS.UNO, confidence: 0.8 }, t).label).toBe(SIGN_LABELS.DOS);

    // Reposo sostenido >= 450 ms debe expirar limpiamente a null
    let releasedAt = null;
    for (let i = 1; i <= 10; i++) {
      t += 67;
      const res = voter.push({ label: null, confidence: 0 }, t);
      if (res.label === null && releasedAt === null) {
        releasedAt = i * 67;
      }
    }
    expect(releasedAt).not.toBeNull();
    expect(releasedAt).toBeLessThanOrEqual(550);
  });

  it('detectWaveMotion rechaza rebote de entrada (1 reversión) y detecta saludo genuino de forma consistente a 10 y 30 FPS', () => {
    // 1. Rebote de entrada (una sola reversión de 1.8 cm): NO debe disparar Hola (tanto con objetos {landmarks,tMs} como con arrays)
    const entryXs = [0.3, 0.36, 0.42, 0.47, 0.5, 0.485, 0.472, 0.472, 0.472];
    const entryHands = entryXs.map((offsetX) => SYNTHETIC_PRESETS.MANO_ABIERTA({ offsetX }));
    expect(detectWaveMotion(entryHands).isWaving).toBe(false);

    const entryEntries = entryHands.map((landmarks, i) => ({
      landmarks,
      tMs: i * 67,
    }));
    expect(detectWaveMotion(entryEntries).isWaving).toBe(false);

    // 2. Saludo genuino a 10 FPS y 30 FPS (1.8 Hz, A = 0.7 * palmScale)
    for (const fps of [10, 15, 30]) {
      const clf = new GeometricClassifier({
        windowMs: 450,
        minStableMs: 260,
        waveWindowMs: 900,
      });
      let holaDetectedAt = null;
      const dt = 1000 / fps;
      for (let i = 0; i < Math.round(fps * 2.0); i++) {
        const tMs = Math.round(i * dt);
        const offsetX = 0.5 + 0.7 * 0.15 * Math.sin(2 * Math.PI * 1.8 * (tMs / 1000));
        const res = clf.predict({
          rightHand: SYNTHETIC_PRESETS.MANO_ABIERTA({ offsetX }),
          timestamp: tMs,
        });
        if (res.label === SIGN_LABELS.HOLA && holaDetectedAt === null) {
          holaDetectedAt = tMs;
        }
      }
      expect(holaDetectedAt).not.toBeNull();
      expect(holaDetectedAt).toBeLessThanOrEqual(1100);
    }
  });

  it('elimina Phantom Hola tras ausencia de mano, Zombie Hola largo a 10 FPS y falsos Hola por cambio entre 2 manos', () => {
    // A) Phantom Hola tras retirar la mano 600 ms y volver completamente quieto
    const clfA = new GeometricClassifier();
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t = i * 67;
      const offsetX = 0.5 + 0.7 * 0.15 * Math.sin(2 * Math.PI * 1.8 * (t / 1000));
      clfA.predict({ rightHand: SYNTHETIC_PRESETS.MANO_ABIERTA({ offsetX }), timestamp: t });
    }
    // 600 ms sin manos
    for (let i = 1; i <= 9; i++) {
      t += 67;
      clfA.predict({ rightHand: null, leftHand: null, hands: [], timestamp: t });
    }
    // Reingreso 100% quieto durante 800 ms -> nunca debe emitir Hola
    const labelsAfterReturn = [];
    for (let i = 1; i <= 12; i++) {
      t += 67;
      const r = clfA.predict({
        rightHand: SYNTHETIC_PRESETS.MANO_ABIERTA({ offsetX: 0.5 }),
        timestamp: t,
      });
      if (r.label) labelsAfterReturn.push(r.label);
    }
    expect(labelsAfterReturn).not.toContain(SIGN_LABELS.HOLA);
    expect(labelsAfterReturn).toContain(SIGN_LABELS.CINCO);

    // B) Zombie Hola a 10 FPS: al detener el saludo, debe volver a Cinco en <= 700 ms (no 1300 ms)
    const clfB = new GeometricClassifier();
    let tb = 0;
    for (let i = 0; i < 16; i++) {
      tb = i * 100;
      const offsetX = 0.5 + 0.7 * 0.15 * Math.sin(2 * Math.PI * 1.8 * (tb / 1000));
      clfB.predict({ rightHand: SYNTHETIC_PRESETS.CINCO({ handedness: 'Right', offsetX }), timestamp: tb });
    }
    let clearedMs = null;
    for (let i = 1; i <= 12; i++) {
      tb += 100;
      const r = clfB.predict({
        rightHand: SYNTHETIC_PRESETS.CINCO({ handedness: 'Right', offsetX: 0.5 }),
        timestamp: tb,
      });
      if (r.label === SIGN_LABELS.CINCO && clearedMs === null) {
        clearedMs = i * 100;
      }
    }
    expect(clearedMs).not.toBeNull();
    expect(clearedMs).toBeLessThanOrEqual(700);

    // C) Dos manos quietas alternando en cuadro -> cero falsos positivos de Hola ni Diez
    const clfC = new GeometricClassifier();
    const mirrorX = (h) => h.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0 }));
    for (let i = 0; i < 20; i++) {
      const frame =
        i % 3 === 0
          ? {
              leftHand: mirrorX(SYNTHETIC_PRESETS.CINCO({ offsetX: 0.25 })),
              rightHand: SYNTHETIC_PRESETS.CINCO({ handedness: 'Right', offsetX: 0.25 }),
              timestamp: i * 67,
            }
          : {
              leftHand: mirrorX(SYNTHETIC_PRESETS.CINCO({ offsetX: 0.25 })),
              rightHand: null,
              timestamp: i * 67,
            };
      const r = clfC.predict(frame);
      expect(r.label).not.toBe(SIGN_LABELS.HOLA);
      expect(r.label).not.toBe(SIGN_LABELS.DIEZ);
    }

    // D) Zombie Diez a 10 FPS: al detener el giro de muñeca, vuelve a Cinco limpiamente en <= 900 ms
    const clfD = new GeometricClassifier();
    let td = 0;
    let sawDiezD = false;
    for (let i = 0; i < 12; i++) {
      td = i * 100;
      const facing = Math.floor(td / 250) % 2 === 0 ? 'FRONT' : 'BACK';
      const r = clfD.predict({
        rightHand: SYNTHETIC_PRESETS.CINCO({ handedness: 'Right', palmFacing: facing }),
        timestamp: td,
      });
      if (r.label === SIGN_LABELS.DIEZ) sawDiezD = true;
    }
    expect(sawDiezD).toBe(true);
    let diezClearedMs = null;
    for (let i = 1; i <= 12; i++) {
      td += 100;
      const r = clfD.predict({
        rightHand: SYNTHETIC_PRESETS.CINCO({ handedness: 'Right', palmFacing: 'FRONT' }),
        timestamp: td,
      });
      if (r.label === SIGN_LABELS.CINCO && diezClearedMs === null) {
        diezClearedMs = i * 100;
      }
    }
    expect(diezClearedMs).not.toBeNull();
    expect(diezClearedMs).toBeLessThanOrEqual(900);
  });

  it('aplica cooldown inteligente anti-repetición al mantener una seña arriba y permite repetir tras pausa en reposo', () => {
    const clf = new GeometricClassifier({
      minStableMs: 260,
      sameSignCooldownMs: 1200,
      restResetMs: 400,
    });
    const commits = [];

    // 1. Mantener "Uno" arriba durante 3 segundos a 15 FPS -> debe emitir committed EXACTAMENTE 1 vez
    let t = 0;
    for (let i = 0; i < 45; i++) {
      t = i * 67;
      const r = clf.predict({ rightHand: SYNTHETIC_PRESETS.UNO(), timestamp: t });
      if (r.committed) commits.push({ label: r.committedLabel, t });
    }
    expect(commits.map((c) => c.label)).toEqual([SIGN_LABELS.UNO]);

    // 2. Cambiar directamente a "Dos" y mantener 1.5s -> emite "Dos" 1 vez
    for (let i = 1; i <= 22; i++) {
      t += 67;
      const r = clf.predict({ rightHand: SYNTHETIC_PRESETS.DOS(), timestamp: t });
      if (r.committed) commits.push({ label: r.committedLabel, t });
    }
    expect(commits.map((c) => c.label)).toEqual([SIGN_LABELS.UNO, SIGN_LABELS.DOS]);

    // 3. Pausa breve en reposo (500 ms) y volver a hacer "Dos" antes de superar cooldown -> si pasó < 1200ms no repite; tras esperar >= 1200ms sí repite
    for (let i = 1; i <= 9; i++) {
      t += 67; // 603 ms en reposo
      clf.predict({ rightHand: null, leftHand: null, hands: [], timestamp: t });
    }
    for (let i = 1; i <= 10; i++) {
      t += 67;
      const r = clf.predict({ rightHand: SYNTHETIC_PRESETS.DOS(), timestamp: t });
      if (r.committed) commits.push({ label: r.committedLabel, t });
    }
    expect(commits.map((c) => c.label)).toEqual([
      SIGN_LABELS.UNO,
      SIGN_LABELS.DOS,
      SIGN_LABELS.DOS,
    ]);
  });
});
