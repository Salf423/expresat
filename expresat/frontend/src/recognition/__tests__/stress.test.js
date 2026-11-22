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

function mirrorHandX(hand) {
  return hand.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0 }));
}

function transform3DTo43(
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
  const h = SYNTHETIC_PRESETS.MANO_ABIERTA({ offsetX, offsetY });
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
  const fist = SYNTHETIC_PRESETS.PUNO({ offsetX, offsetY });
  for (let i = 1; i <= 4; i++) h[i] = fist[i];
  return h;
}

const STATIC_PRESETS = [
  ['MANO_ABIERTA', SIGN_LABELS.MANO_ABIERTA],
  ['PUNO', SIGN_LABELS.PUNO],
  ['UNO', SIGN_LABELS.UNO],
  ['DOS', SIGN_LABELS.DOS],
  ['OK', SIGN_LABELS.OK],
  ['BIEN', SIGN_LABELS.BIEN],
  ['TE_QUIERO', SIGN_LABELS.TE_QUIERO],
  ['LUNES', SIGN_LABELS.LUNES],
];

describe('recognition/stress — Suite de estrés (Izq/Der, ruido gaussiano, ±25°, cero colisiones, 10 vs 30 FPS)', () => {
  it('mantiene simetría exacta entre mano izquierda y derecha en las 8 señas estáticas y en saludo Hola', () => {
    for (const [key, expected] of STATIC_PRESETS) {
      const right = SYNTHETIC_PRESETS[key]({ offsetX: 0.3 });
      const left = mirrorHandX(right);

      const resRight = classifyStaticHand({
        rightHand: right,
        leftHand: null,
        videoWidth: 640,
        videoHeight: 480,
      });
      const resLeft = classifyStaticHand({
        rightHand: null,
        leftHand: left,
        videoWidth: 640,
        videoHeight: 480,
      });

      expect(resRight.label).toBe(expected);
      expect(resLeft.label).toBe(expected);
      expect(Math.abs(resRight.confidence - resLeft.confidence)).toBeLessThan(0.01);
    }

    // Saludo dinámico "Hola" simétrico en mano izquierda (leftHand) y derecha (rightHand)
    for (const slot of ['rightHand', 'leftHand']) {
      const clf = new GeometricClassifier();
      let sawHola = false;
      for (let i = 0; i < 24; i++) {
        const tMs = i * 67;
        const offsetX = 0.5 + 0.7 * 0.15 * Math.sin(2 * Math.PI * 1.8 * (tMs / 1000));
        const base = SYNTHETIC_PRESETS.MANO_ABIERTA({ offsetX });
        const hand = slot === 'leftHand' ? mirrorHandX(base) : base;
        const res = clf.predict({
          [slot]: hand,
          timestamp: tMs,
        });
        if (res.label === SIGN_LABELS.HOLA) {
          sawHola = true;
          break;
        }
      }
      expect(sawHola).toBe(true);
    }
  });

  it('resiste ruido gaussiano realista (sigma = 1.5 px en 640x480) con >= 96% de acierto y cero colisiones entre señas', () => {
    const rand = mulberry32(20261121);
    const sigX = 1.5 / 640;
    const sigY = 1.5 / 480;
    const sigZ = 1.5 / 640;

    for (const [key, expected] of STATIC_PRESETS) {
      const base43 = transform3DTo43(SYNTHETIC_PRESETS[key]({ scale: 0.75 }), {
        aspect: 4 / 3,
      });
      let correct = 0;
      let falseCollision = 0;
      const trials = 120;

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
        });
        if (res.label === expected) correct++;
        else if (res.label !== null) falseCollision++;
      }

      expect(correct / trials).toBeGreaterThanOrEqual(0.96);
      expect(falseCollision).toBe(0);
    }
  });

  it('mantiene invariancia bajo rotaciones ±25° (roll, pitch y yaw) en relación de aspecto 4:3', () => {
    const angles = [-25, -15, 0, 15, 25];
    for (const [key, expected] of STATIC_PRESETS) {
      const base = SYNTHETIC_PRESETS[key]({ offsetX: 0.5, offsetY: 0.5 });
      for (const deg of angles) {
        for (const axis of ['rollDeg', 'pitchDeg', 'yawDeg']) {
          const rotated = transform3DTo43(base, {
            [axis]: deg,
            zScale: 0.6,
            aspect: 4 / 3,
          });
          const res = classifyStaticHand({
            rightHand: rotated,
            videoWidth: 640,
            videoHeight: 480,
          });
          expect(res.label).toBe(expected);
        }
      }
    }
  });

  it('garantiza cero colisiones entre pares críticos y reposo/transiciones', () => {
    const bp = 0.15;

    // 1. Puño natural (pulgar apoyado sobre el índice flexionado) != OK/Pinza
    const naturalFist = SYNTHETIC_PRESETS.PUNO();
    naturalFist[3] = { x: 0.5 - 0.28 * bp, y: 0.7 - 0.64 * bp, z: -0.04 * bp };
    naturalFist[4] = { x: 0.5 - 0.18 * bp, y: 0.7 - 0.78 * bp, z: -0.05 * bp };
    expect(classifyStaticHand(naturalFist).label).toBe(SIGN_LABELS.PUNO);

    // 2. OK clásico != Dos y != Puño
    expect(classifyStaticHand(SYNTHETIC_PRESETS.OK()).label).toBe(SIGN_LABELS.OK);
    expect(classifyStaticHand(SYNTHETIC_PRESETS.DOS()).label).toBe(SIGN_LABELS.DOS);

    // 3. Letra A != Puño, != Bien, != OK/Pinza
    const letraA = SYNTHETIC_PRESETS.PUNO();
    letraA[1] = { x: 0.5 - 0.25 * bp, y: 0.7 - 0.3 * bp, z: 0 };
    letraA[2] = { x: 0.5 - 0.38 * bp, y: 0.7 - 0.6 * bp, z: 0 };
    letraA[3] = { x: 0.5 - 0.44 * bp, y: 0.7 - 0.9 * bp, z: 0 };
    letraA[4] = { x: 0.5 - 0.46 * bp, y: 0.7 - 1.2 * bp, z: 0 };
    expect(classifyStaticHand(letraA).label).toBeNull();

    // 4. Reposo relajado / Letra C != Puño y != Bien
    expect(classifyStaticHand(buildRelaxedNeutralHand()).label).toBeNull();

    // 5. Pulgar abajo != Bien
    expect(classifyStaticHand(SYNTHETIC_PRESETS.BIEN({ rotateDeg: 180 })).label).toBeNull();

    // 6. Uno con pulgar estrecho (~20°) != Lunes
    const narrowThumbUno = SYNTHETIC_PRESETS.UNO();
    narrowThumbUno[1] = { x: 0.5 - 0.28 * bp, y: 0.7 - 0.25 * bp, z: 0 };
    narrowThumbUno[2] = { x: 0.5 - 0.48 * bp, y: 0.7 - 0.58 * bp, z: 0 };
    narrowThumbUno[3] = { x: 0.5 - 0.64 * bp, y: 0.7 - 0.92 * bp, z: 0 };
    narrowThumbUno[4] = { x: 0.5 - 0.78 * bp, y: 0.7 - 1.25 * bp, z: 0 };
    expect(classifyStaticHand(narrowThumbUno).label).not.toBe(SIGN_LABELS.LUNES);

    // 7. Catálogo único contiene únicamente las 9 señas verificadas sin duplicados
    expect(new Set(SIGN_CATALOG.map((s) => s.label)).size).toBe(SIGN_CATALOG.length);
  });

  it('mantiene comportamiento temporal equivalente entre 10 FPS y 30 FPS (con EMA 0.5) sin emisiones duplicadas', () => {
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

      // 0..1.5s: mantener "Dos"
      const holdFrames = Math.round(fps * 1.5);
      for (let i = 0; i < holdFrames; i++) {
        const tMs = Math.round(i * dt);
        const hand = ema.smooth('rightHand', SYNTHETIC_PRESETS.DOS());
        const r = clf.predict({ rightHand: hand, timestamp: tMs });
        if (r.label === SIGN_LABELS.DOS && firstConfirmMs === null) firstConfirmMs = tMs;
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

      // 2.5..4.0s: hacer "Uno"
      const unoStartMs = restStartMs + Math.round(restFrames * dt);
      for (let i = 0; i < holdFrames; i++) {
        const tMs = unoStartMs + Math.round(i * dt);
        const hand = ema.smooth('rightHand', SYNTHETIC_PRESETS.UNO());
        const r = clf.predict({ rightHand: hand, timestamp: tMs });
        if (r.committed) commits.push({ label: r.committedLabel, tMs });
      }

      return { commits, firstConfirmMs, expiredAfterRestMs };
    };

    const r10 = runSession(10);
    const r30 = runSession(30);

    expect(r10.commits.map((c) => c.label)).toEqual([SIGN_LABELS.DOS, SIGN_LABELS.UNO]);
    expect(r30.commits.map((c) => c.label)).toEqual([SIGN_LABELS.DOS, SIGN_LABELS.UNO]);
    expect(Math.abs(r10.firstConfirmMs - r30.firstConfirmMs)).toBeLessThanOrEqual(100);
    expect(r10.expiredAfterRestMs).toBeLessThanOrEqual(550);
    expect(r30.expiredAfterRestMs).toBeLessThanOrEqual(550);
  });

  it('reproduce grabaciones reales del repositorio sin falsos positivos de Hola por cambio de mano', () => {
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

    // Antes de la corrección, los saltos entre Left y Right disparaban 8/15 falsos "Hola"
    expect(votedLabels).not.toContain(SIGN_LABELS.HOLA);
  });
});
