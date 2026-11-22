import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  SIGN_LABELS,
  SIGN_CATALOG,
  classifyStaticHand,
  GeometricClassifier,
  SYNTHETIC_PRESETS,
} from '../index.js';
import { LandmarkEMAFilter } from '../../services/landmarkFilter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../../..');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u1 = Math.max(1e-9, rand());
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function transform3DToAspect(
  hand,
  { rollDeg = 0, pitchDeg = 0, yawDeg = 0, zScale = 1.0, aspect = 4 / 3 } = {}
) {
  const w = hand[0];
  const rx = (pitchDeg * Math.PI) / 180;
  const ry = (yawDeg * Math.PI) / 180;
  const rz = (rollDeg * Math.PI) / 180;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  return hand.map((p) => {
    const x = p.x - w.x;
    const y = p.y - w.y;
    const z = (p.z ?? 0) - (w.z ?? 0);

    const x1 = x * cz - y * sz;
    const y1 = x * sz + y * cz;
    const z1 = z;

    const x2 = x1;
    const y2 = y1 * cx - z1 * sx;
    const z2 = y1 * sx + z1 * cx;

    const x3 = x2 * cy + z2 * sy;
    const y3 = y2;
    const z3 = -x2 * sy + z2 * cy;

    return {
      x: 0.5 + x3,
      y: 0.5 + y3 * aspect,
      z: z3 * zScale,
    };
  });
}

function buildRelaxedNeutralHand(offsetX = 0.5, offsetY = 0.7) {
  const bp = 0.15;
  const h = SYNTHETIC_PRESETS.CINCO({ handedness: 'Left', offsetX, offsetY });
  for (const mcpIdx of [5, 9, 13, 17]) {
    const m = h[mcpIdx];
    const a1 = (20 * Math.PI) / 180;
    const a2 = (70 * Math.PI) / 180;
    const a3 = (105 * Math.PI) / 180;
    const p1 = { x: m.x, y: m.y - 0.45 * bp * Math.cos(a1), z: m.z - 0.45 * bp * Math.sin(a1) };
    const p2 = { x: p1.x, y: p1.y - 0.35 * bp * Math.cos(a2), z: p1.z - 0.35 * bp * Math.sin(a2) };
    const p3 = { x: p2.x, y: p2.y - 0.32 * bp * Math.cos(a3), z: p2.z - 0.32 * bp * Math.sin(a3) };
    h[mcpIdx + 1] = p1;
    h[mcpIdx + 2] = p2;
    h[mcpIdx + 3] = p3;
  }
  const fist = SYNTHETIC_PRESETS.PUNO({ handedness: 'Left', offsetX, offsetY });
  for (let i = 1; i <= 4; i++) h[i] = fist[i];
  return h;
}

const ALL_STATIC_PRESETS = [
  ['CERO', SIGN_LABELS.CERO],
  ['UNO', SIGN_LABELS.UNO],
  ['DOS', SIGN_LABELS.DOS],
  ['TRES', SIGN_LABELS.TRES],
  ['CUATRO', SIGN_LABELS.CUATRO],
  ['CINCO', SIGN_LABELS.CINCO],
  ['SEIS', SIGN_LABELS.SEIS],
  ['SIETE', SIGN_LABELS.SIETE],
  ['OCHO', SIGN_LABELS.OCHO],
  ['NUEVE', SIGN_LABELS.NUEVE],
  ['PUNO', SIGN_LABELS.PUNO],
  ['OK', SIGN_LABELS.OK],
  ['BIEN', SIGN_LABELS.BIEN],
  ['TE_QUIERO', SIGN_LABELS.TE_QUIERO],
  ['LUNES', SIGN_LABELS.LUNES],
  ['LETRA_I', SIGN_LABELS.LETRA_I],
  ['LETRA_Y', SIGN_LABELS.LETRA_Y],
  ['CUERNOS', SIGN_LABELS.CUERNOS],
];

describe('recognition/stress — Matriz de confusión 0 colisiones, Izq/Der, móvil portrait 0.75 vs 1.33, ±25°, ruido y 10 vs 30 FPS', () => {
  it('matriz de confusión sintética 18x18 (todas las señas estáticas) con 0 colisiones en mano izquierda y derecha', () => {
    for (const handedness of ['Left', 'Right']) {
      const slot = handedness === 'Left' ? 'leftHand' : 'rightHand';
      let offDiagonalCollisions = 0;

      for (const [key, expected] of ALL_STATIC_PRESETS) {
        const hand = SYNTHETIC_PRESETS[key]({ handedness, offsetX: handedness === 'Left' ? 0.7 : 0.3 });
        const res = classifyStaticHand({
          [slot]: hand,
          videoWidth: 640,
          videoHeight: 480,
          aspectRatio: 4 / 3,
        });
        expect(res.label, `${key} (${handedness})`).toBe(expected);
        if (res.label !== expected) offDiagonalCollisions++;
      }

      expect(offDiagonalCollisions).toBe(0);
    }
  });

  it('mantiene simetría exacta izq/der en las 18 estáticas + Hola + Diez y prioriza la mano activa sobre la mano en reposo', () => {
    for (const [key, expected] of ALL_STATIC_PRESETS) {
      const left = SYNTHETIC_PRESETS[key]({ handedness: 'Left', offsetX: 0.7 });
      const right = SYNTHETIC_PRESETS[key]({ handedness: 'Right', offsetX: 0.3 });
      const rL = classifyStaticHand({ leftHand: left, rightHand: null });
      const rR = classifyStaticHand({ leftHand: null, rightHand: right });
      expect(rL.label).toBe(expected);
      expect(rR.label).toBe(expected);
      expect(Math.abs(rL.confidence - rR.confidence)).toBeLessThan(0.01);
    }

    // Usuario zurdo señando "Tres" en leftHand mientras rightHand está en reposo
    const leftSigning = classifyStaticHand({
      leftHand: SYNTHETIC_PRESETS.TRES({ handedness: 'Left', offsetX: 0.72 }),
      rightHand: buildRelaxedNeutralHand(0.28, 0.7),
    });
    expect(leftSigning.label).toBe(SIGN_LABELS.TRES);

    // Gestos dinámicos Hola y Diez simétricos en leftHand y rightHand
    for (const handedness of ['Left', 'Right']) {
      const slot = handedness === 'Left' ? 'leftHand' : 'rightHand';

      const clfHola = new GeometricClassifier();
      let sawHola = false;
      for (let i = 0; i < 24; i++) {
        const tMs = i * 67;
        const offsetX = 0.5 + 0.7 * 0.15 * Math.sin(2 * Math.PI * 1.8 * (tMs / 1000));
        const r = clfHola.predict({
          [slot]: SYNTHETIC_PRESETS.CINCO({ handedness, offsetX }),
          timestamp: tMs,
        });
        if (r.label === SIGN_LABELS.HOLA) {
          sawHola = true;
          break;
        }
      }
      expect(sawHola, `Hola (${handedness})`).toBe(true);

      const clfDiez = new GeometricClassifier();
      let sawDiez = false;
      for (let i = 0; i < 18; i++) {
        const tMs = i * 67;
        const palmFacing = i < 4 ? 'FRONT' : i < 10 ? 'BACK' : i < 14 ? 'FRONT' : 'BACK';
        const r = clfDiez.predict({
          [slot]: SYNTHETIC_PRESETS.CINCO({ handedness, palmFacing }),
          timestamp: tMs,
        });
        if (r.label === SIGN_LABELS.DIEZ) {
          sawDiez = true;
          break;
        }
      }
      expect(sawDiez, `Diez (${handedness})`).toBe(true);
    }
  });

  it('resiste ruido gaussiano realista (sigma = 1.5 px en 640x480) con >= 95% de acierto y 0 colisiones en todo el catálogo', () => {
    const rand = mulberry32(20261121);
    const sigX = 1.5 / 640;
    const sigY = 1.5 / 480;
    const sigZ = 1.5 / 640;

    for (const [key, expected] of ALL_STATIC_PRESETS) {
      const base43 = transform3DToAspect(
        SYNTHETIC_PRESETS[key]({ handedness: 'Right', scale: 0.75 }),
        { aspect: 4 / 3 }
      );
      let correct = 0;
      let falseCollision = 0;
      const trials = 100;

      for (let t = 0; t < trials; t++) {
        const noisy = base43.map((p) => ({
          x: p.x + gaussian(rand) * sigX,
          y: p.y + gaussian(rand) * sigY,
          z: p.z + gaussian(rand) * sigZ,
        }));
        const res = classifyStaticHand({
          rightHand: noisy,
          videoWidth: 640,
          videoHeight: 480,
          aspectRatio: 4 / 3,
        });
        if (res.label === expected) correct++;
        else if (res.label !== null) falseCollision++;
      }

      expect(correct / trials, `Acierto bajo ruido en ${key}`).toBeGreaterThanOrEqual(0.95);
      expect(falseCollision, `Colisión bajo ruido en ${key}`).toBe(0);
    }
  });

  it('mantiene invariancia bajo rotaciones ±25° (roll, pitch, yaw) en móvil portrait (0.75) y desktop landscape (1.33)', () => {
    const angles = [-25, -15, 0, 15, 25];
    const geometries = [
      { vw: 480, vh: 640, aspect: 0.75 },
      { vw: 640, vh: 480, aspect: 4 / 3 },
    ];

    for (const { vw, vh, aspect } of geometries) {
      for (const [key, expected] of ALL_STATIC_PRESETS) {
        const base = SYNTHETIC_PRESETS[key]({
          handedness: 'Right',
          offsetX: 0.5,
          offsetY: 0.5,
        });
        for (const deg of angles) {
          for (const axis of ['rollDeg', 'pitchDeg', 'yawDeg']) {
            const rotated = transform3DToAspect(base, {
              [axis]: deg,
              zScale: 0.65,
              aspect,
            });
            const res = classifyStaticHand({
              rightHand: rotated,
              videoWidth: vw,
              videoHeight: vh,
              aspectRatio: aspect,
            });
            expect(res.label, `${key} ${axis}=${deg}° (${vw}x${vh})`).toBe(expected);
          }
        }
      }
    }
  });

  it('mantiene comportamiento temporal equivalente entre 10 FPS y 30 FPS (estáticas, Diez, Hola, cooldown y expiración)', () => {
    const runSession = (fps) => {
      const clf = new GeometricClassifier({
        windowMs: 450,
        minStableMs: 260,
        sameSignCooldownMs: 1200,
        restResetMs: 400,
      });
      const ema = new LandmarkEMAFilter(0.5);
      const dt = 1000 / fps;
      const commits = [];
      let firstConfirmMs = null;
      let expiredAfterRestMs = null;

      // 0..1.5s: mantener "Tres"
      const holdFrames = Math.round(fps * 1.5);
      for (let i = 0; i < holdFrames; i++) {
        const tMs = Math.round(i * dt);
        const hand = ema.smooth('rightHand', SYNTHETIC_PRESETS.TRES({ handedness: 'Right' }));
        const r = clf.predict({ rightHand: hand, timestamp: tMs });
        if (r.label === SIGN_LABELS.TRES && firstConfirmMs === null) firstConfirmMs = tMs;
        if (r.committed) commits.push({ label: r.committedLabel, tMs });
      }

      // 1.5..2.5s: bajar mano (reposo)
      const restStartMs = Math.round(holdFrames * dt);
      const restFrames = Math.round(fps * 1.0);
      for (let i = 0; i < restFrames; i++) {
        const tMs = restStartMs + Math.round(i * dt);
        ema.smooth('rightHand', null);
        const r = clf.predict({ rightHand: null, leftHand: null, hands: [], timestamp: tMs });
        if (r.label === null && expiredAfterRestMs === null) {
          expiredAfterRestMs = tMs - restStartMs;
        }
      }

      // 2.5..4.0s: hacer "Ocho"
      const ochoStartMs = restStartMs + Math.round(restFrames * dt);
      for (let i = 0; i < holdFrames; i++) {
        const tMs = ochoStartMs + Math.round(i * dt);
        const hand = ema.smooth('rightHand', SYNTHETIC_PRESETS.OCHO({ handedness: 'Right' }));
        const r = clf.predict({ rightHand: hand, timestamp: tMs });
        if (r.committed) commits.push({ label: r.committedLabel, tMs });
      }

      return { commits, firstConfirmMs, expiredAfterRestMs };
    };

    const r10 = runSession(10);
    const r30 = runSession(30);

    expect(r10.commits.map((c) => c.label)).toEqual([SIGN_LABELS.TRES, SIGN_LABELS.OCHO]);
    expect(r30.commits.map((c) => c.label)).toEqual([SIGN_LABELS.TRES, SIGN_LABELS.OCHO]);
    expect(Math.abs(r10.firstConfirmMs - r30.firstConfirmMs)).toBeLessThanOrEqual(100);
    expect(r10.expiredAfterRestMs).toBeLessThanOrEqual(550);
    expect(r30.expiredAfterRestMs).toBeLessThanOrEqual(550);

    // Diez dinámico a 10 FPS y 30 FPS
    for (const fps of [10, 30]) {
      const clf = new GeometricClassifier();
      const dt = 1000 / fps;
      let sawDiez = false;
      for (let i = 0; i < Math.round(fps * 1.5); i++) {
        const tMs = Math.round(i * dt);
        const phase = Math.floor(tMs / 250) % 2;
        const hand = SYNTHETIC_PRESETS.CINCO({
          handedness: 'Right',
          palmFacing: phase === 0 ? 'FRONT' : 'BACK',
        });
        const r = clf.predict({ rightHand: hand, timestamp: tMs });
        if (r.label === SIGN_LABELS.DIEZ) {
          sawDiez = true;
          break;
        }
      }
      expect(sawDiez, `Diez @ ${fps} FPS`).toBe(true);
    }

    expect(new Set(SIGN_CATALOG.map((s) => s.label)).size).toBe(SIGN_CATALOG.length);
  });

  it('reproduce grabaciones reales del repositorio sin falsos positivos de Hola ni Diez por cambio de mano', () => {
    const latPath = path.join(REPO_ROOT, 'tests/fixtures/real_recording_laterality_15f.json');
    const raw = JSON.parse(fs.readFileSync(latPath, 'utf8'));
    const clf = new GeometricClassifier();

    const votedLabels = [];
    for (const fr of raw.frames) {
      let leftHand = null;
      let rightHand = null;
      for (const h of fr.hands || []) {
        if (h.categoryName === 'Left' && !leftHand) leftHand = h.landmarks;
        else if (h.categoryName === 'Right' && !rightHand) rightHand = h.landmarks;
      }
      const res = clf.predict({
        leftHand,
        rightHand,
        videoWidth: fr.videoWidth || 640,
        videoHeight: fr.videoHeight || 480,
        timestamp: fr.t_ms,
      });
      if (res.label) votedLabels.push(res.label);
    }

    expect(votedLabels).not.toContain(SIGN_LABELS.HOLA);
    expect(votedLabels).not.toContain(SIGN_LABELS.DIEZ);
    expect(votedLabels).toContain(SIGN_LABELS.CINCO);
  });
});
