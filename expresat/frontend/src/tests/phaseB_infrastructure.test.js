import { describe, it, expect } from 'vitest';
import {
  fingerStates,
  getSignCatalog,
  isValidSignEntry,
  matchCatalog,
  buildTrajectoryContext,
  TRAJECTORY_TEMPLATES,
  matchTrajectoryTemplate,
  buildSyntheticHand,
  SYNTHETIC_PRESETS,
  GeometricClassifier,
} from '../recognition/index.js';

describe('Fase B — Infraestructura declarativa, orientación, quiralidad y ventanas en ms', () => {
  it('valida todas las entradas declarativas del catálogo con isValidSignEntry', () => {
    const catalog = getSignCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(9);
    for (const entry of catalog) {
      expect(isValidSignEntry(entry)).toBe(true);
    }
  });

  it('extrae correctamente la orientación 2D (UP, DOWN, HORIZONTAL) y cara de palma (FRONT, BACK)', () => {
    // UP (-90° en imagen, rotateDeg = 0)
    const handUpFront = SYNTHETIC_PRESETS.UNO({ rotateDeg: 0, palmFacing: 'FRONT', handedness: 'Right' });
    const stUp = fingerStates(handUpFront);
    expect(stUp.orientation.direction).toBe('UP');
    expect(stUp.orientation.palmFacing).toBe('FRONT');

    // DOWN (+90° en imagen, rotateDeg = 180)
    const handDownBack = SYNTHETIC_PRESETS.UNO({
      rotateDeg: 180,
      palmFacing: 'BACK',
      handedness: 'Right',
    });
    const stDown = fingerStates(handDownBack);
    expect(stDown.orientation.direction).toBe('DOWN');
    expect(stDown.orientation.palmFacing).toBe('BACK');

    // HORIZONTAL (rotateDeg = 90)
    const handHorizBack = SYNTHETIC_PRESETS.LUNES({
      rotateDeg: 90,
      palmFacing: 'BACK',
      handedness: 'Right',
    });
    const stHoriz = fingerStates(handHorizBack);
    expect(stHoriz.orientation.direction).toBe('HORIZONTAL');
    expect(stHoriz.orientation.palmFacing).toBe('BACK');
  });

  it('produce las mismas coordenadas canónicas para mano derecha e izquierda (con o sin espejo)', () => {
    const rightHand = SYNTHETIC_PRESETS.LUNES({ handedness: 'Right', palmFacing: 'FRONT' });
    const leftHand = SYNTHETIC_PRESETS.LUNES({ handedness: 'Left', palmFacing: 'FRONT' });

    const stRight = fingerStates(rightHand, { handedness: 'Right' });
    const stLeft = fingerStates(leftHand, { handedness: 'Left' });

    expect(stRight.orientation.palmFacing).toBe('FRONT');
    expect(stLeft.orientation.palmFacing).toBe('FRONT');

    // En el sistema canónico, INDEX_MCP (5) siempre está en -X y PINKY_MCP (17) siempre en +X
    expect(stRight.canonicalLandmarks[5].x).toBeCloseTo(stLeft.canonicalLandmarks[5].x, 4);
    expect(stRight.canonicalLandmarks[17].x).toBeCloseTo(stLeft.canonicalLandmarks[17].x, 4);
    expect(stRight.canonicalLandmarks[4].x).toBeCloseTo(stLeft.canonicalLandmarks[4].x, 4);
  });

  it('devuelve label: null y reason: LOW_CONFIDENCE cuando ningún candidato supera el umbral', () => {
    // Postura no catalogada: solo dedo anular extendido
    const unknownHand = buildSyntheticHand({
      thumb: false,
      index: false,
      middle: false,
      ring: true,
      pinky: false,
    });
    const st = fingerStates(unknownHand);
    const res = matchCatalog(getSignCatalog(), st, null, { minConfidence: 0.72, minMargin: 0.05 });
    expect(res.label).toBeNull();
    expect(res.details.reason).toBe('LOW_CONFIDENCE');
  });

  it('soporta ventanas temporales en milisegundos tanto a 15 FPS como a 30 FPS', () => {
    for (const fps of [15, 30]) {
      const stepMs = 1000 / fps;
      const totalDurationMs = 700;
      const count = Math.ceil(totalDurationMs / stepMs);
      const frames = [];

      for (let i = 0; i < count; i++) {
        const t = i * stepMs;
        const phase = (i / (count - 1)) * Math.PI * 2.5;
        const offsetX = 0.5 + 0.08 * Math.sin(phase);
        frames.push(
          SYNTHETIC_PRESETS.MANO_ABIERTA({
            offsetX,
            timestampMs: t,
          })
        );
      }

      const ctx = buildTrajectoryContext(frames, 750);
      expect(ctx.oscillationX.isOscillating).toBe(true);
      expect(ctx.oscillationX.directionChanges).toBeGreaterThanOrEqual(2);

      const clf = new GeometricClassifier({ windowMs: 750 });
      const pred = clf.predict(frames);
      expect(pred.label).toBe('Hola');
      expect(pred.category).toBe('basica');
    }
  });

  it('compara trayectorias 2D remuestreadas contra plantillas Z y J en ambas manos', () => {
    // Escalar plantilla Z a unidades de palmScale (~0.8x) y probar directa y espejada
    const zDirect = TRAJECTORY_TEMPLATES.Z.map((p) => ({ x: p.x * 0.8, y: p.y * 0.8 }));
    const zMirror = TRAJECTORY_TEMPLATES.Z.map((p) => ({ x: -p.x * 0.8, y: p.y * 0.8 }));

    expect(matchTrajectoryTemplate(zDirect, TRAJECTORY_TEMPLATES.Z).matched).toBe(true);
    expect(matchTrajectoryTemplate(zMirror, TRAJECTORY_TEMPLATES.Z).matched).toBe(true);
    expect(matchTrajectoryTemplate(zDirect, TRAJECTORY_TEMPLATES.J).matched).toBe(false);
  });
});
