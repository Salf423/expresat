import { describe, it, expect } from 'vitest';
import * as useSignEngineMod from '../useSignEngine.js';
import { extractWindow } from '../../engine/featureExtractor.js';
import { CONTEXT_MODES, CONTEXT_MODE_LIST, getModeCatalog } from '../../recognition/index.js';

const makePose = () => {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0.0, visibility: 0.95 }));
  pose[11] = { x: 0.65, y: 0.4, z: 0.0, visibility: 0.95 };
  pose[12] = { x: 0.35, y: 0.4, z: 0.0, visibility: 0.95 };
  pose[15] = { x: 0.7, y: 0.7, z: 0.0, visibility: 0.95 };
  pose[16] = { x: 0.3, y: 0.7, z: 0.0, visibility: 0.95 };
  return pose;
};

describe('ui/useSignEngine — Lote WebSocket crudo + t_ms monotónico y enablePose (v1.4.0)', () => {
  it('resolveEnablePose activa Pose siempre que enableRemoteTransport esté activo', () => {
    expect(typeof useSignEngineMod.resolveEnablePose).toBe('function');
    expect(
      useSignEngineMod.resolveEnablePose({
        enablePose: false,
        enableRemoteTransport: true,
        configEnablePose: false,
      })
    ).toBe(true);
    expect(
      useSignEngineMod.resolveEnablePose({
        enablePose: false,
        enableRemoteTransport: false,
        configEnablePose: false,
      })
    ).toBe(false);
    expect(
      useSignEngineMod.resolveEnablePose({
        enablePose: false,
        enableRemoteTransport: false,
        devRecorderActive: true,
        configEnablePose: false,
      })
    ).toBe(true);
  });

  it('expira la tarjeta activa al recibir label=null, evita carrera WS y acumula historial solo en committed', () => {
    expect(typeof useSignEngineMod.shouldApplyLocalPrediction).toBe('function');
    expect(typeof useSignEngineMod.applyGesturePrediction).toBe('function');
    expect(typeof useSignEngineMod.appendCommittedSign).toBe('function');

    // En modo demo local (sin WS) siempre aplica predicción local
    expect(
      useSignEngineMod.shouldApplyLocalPrediction({
        enableRemoteTransport: false,
        wsState: 'idle',
      })
    ).toBe(true);

    // Con WS OPEN en modo neural, el clasificador local NO sobrescribe al servidor
    expect(
      useSignEngineMod.shouldApplyLocalPrediction({
        enableRemoteTransport: true,
        wsState: 'open',
      })
    ).toBe(false);

    // Expiración automática en reposo (label=null limpia la tarjeta activa en lugar de congelarla)
    const active = {
      label: 'Mano Abierta',
      confidence: 0.96,
      source: 'local',
      state: 'confirmed',
      details: { states: { thumb: true, index: true, middle: true, ring: true, pinky: true } },
    };
    const expired = useSignEngineMod.applyGesturePrediction(active, {
      label: null,
      confidence: 0,
      state: 'idle',
      details: { reason: 'INVALID_OR_NOISY_LANDMARKS', states: null },
    });
    expect(expired.label).toBeNull();
    expect(expired.confidence).toBe(0);
    expect(expired.state).toBe('idle');

    // Historial solo agrega en flanco committed === true y adjunta speakText canónico del catálogo
    const h0 = [];
    const h1 = useSignEngineMod.appendCommittedSign(h0, {
      label: 'OK / Pinza',
      confidence: 0.92,
      committed: false,
      committedLabel: null,
    });
    expect(h1).toHaveLength(0);

    const h2 = useSignEngineMod.appendCommittedSign(h1, {
      label: 'OK / Pinza',
      confidence: 0.92,
      committed: true,
      committedLabel: 'OK / Pinza',
    });
    expect(h2).toHaveLength(1);
    expect(h2[0].label).toBe('OK / Pinza');
    expect(h2[0].speakText).toBe('OK');
  });

  it('buildWsInferenceFrame extrae frameData.raw (sin doble EMA) con t_ms real y ventana válida para extractWindow v1.4.0', () => {
    expect(typeof useSignEngineMod.buildWsInferenceFrame).toBe('function');
    expect(typeof useSignEngineMod.updateWsRollingBuffer).toBe('function');

    const rawPose = makePose();
    const smoothedPose = makePose();
    smoothedPose[0].x = 0.999; // marker to prove raw is used, NOT smoothed!
    const rawHand = Array.from({ length: 21 }, () => ({ x: 0.7, y: 0.7, z: 0.0 }));

    const buffer = [];
    for (let i = 0; i < 20; i++) {
      const frameData = {
        timestamp: 1000 + i * 55, // ~18 FPS, span = 1045ms >= 933.33ms
        pose: smoothedPose,
        hands: [],
        handedness: [],
        raw: {
          pose: rawPose,
          hands: [rawHand],
          handedness: [[{ categoryName: 'Left', score: 0.96 }]],
          leftHand: rawHand,
          rightHand: null,
        },
      };
      useSignEngineMod.updateWsRollingBuffer(buffer, frameData);
    }

    expect(buffer.length).toBeGreaterThanOrEqual(15);
    expect(buffer[0].t_ms).toBe(1000);
    expect(buffer[buffer.length - 1].t_ms).toBe(1000 + 19 * 55);
    expect(buffer[0].pose[0].x).toBeCloseTo(0.5, 6); // raw, NOT smoothedPose's 0.999
    expect(buffer[0].hands.length).toBe(1);

    const { tensor, valid, error } = extractWindow(buffer, { targetFps: 15, durationMs: 1000 });
    expect(valid, `extractWindow error=${error}`).toBe(true);
    expect(tensor.length).toBe(15 * 178);
  });

  it('resolveStrictAspectRatio desactiva el bloqueo 4:3 en Modo Demo Local y syncCanvasToVideo adapta canvas a portrait 480x640', () => {
    expect(typeof useSignEngineMod.resolveStrictAspectRatio).toBe('function');
    expect(typeof useSignEngineMod.syncCanvasToVideo).toBe('function');

    expect(
      useSignEngineMod.resolveStrictAspectRatio({
        enableRemoteTransport: false,
        devRecorderActive: false,
      })
    ).toBe(false);
    expect(
      useSignEngineMod.resolveStrictAspectRatio({
        enableRemoteTransport: true,
        devRecorderActive: false,
      })
    ).toBe(true);
    expect(
      useSignEngineMod.resolveStrictAspectRatio({
        enableRemoteTransport: false,
        devRecorderActive: true,
      })
    ).toBe(true);

    const fakeCanvas = { width: 640, height: 480 };
    const fakePortraitVideo = { videoWidth: 480, videoHeight: 640 };
    useSignEngineMod.syncCanvasToVideo(fakeCanvas, fakePortraitVideo);
    expect(fakeCanvas.width).toBe(480);
    expect(fakeCanvas.height).toBe(640);
  });

  it('applyGesturePrediction actualiza estado al cambiar lateralidad (handId) u orientación palmar', () => {
    const rightUno = {
      label: 'Uno',
      confidence: 0.94,
      source: 'local',
      state: 'confirmed',
      details: {
        handId: 'rightHand',
        rawLabel: 'Uno',
        reason: 'ok',
        states: {
          thumb: false,
          index: true,
          middle: false,
          ring: false,
          pinky: false,
          palmFacing: 'FRONT',
          isPinching: false,
        },
      },
    };
    const leftUno = useSignEngineMod.applyGesturePrediction(rightUno, {
      ...rightUno,
      details: { ...rightUno.details, handId: 'leftHand' },
    });
    expect(leftUno).not.toBe(rightUno);
    expect(leftUno.details.handId).toBe('leftHand');

    const backCuatro = useSignEngineMod.applyGesturePrediction(rightUno, {
      ...rightUno,
      details: {
        ...rightUno.details,
        states: { ...rightUno.details.states, palmFacing: 'BACK' },
      },
    });
    expect(backCuatro).not.toBe(rightUno);
    expect(backCuatro.details.states.palmFacing).toBe('BACK');
  });

  it('conserva la oración acumulada al combinar señas de distintos modos y resuelve speakText TTS para todo el catálogo', () => {
    expect(CONTEXT_MODE_LIST.map((m) => m.title)).toEqual([
      'General',
      'Abecedario',
      'Números',
      'Frases y Modales',
    ]);
    expect(getModeCatalog(CONTEXT_MODES.GENERAL)).toHaveLength(20);
    expect(getModeCatalog(CONTEXT_MODES.ALPHABET)).toHaveLength(27);
    expect(getModeCatalog(CONTEXT_MODES.NUMBERS)).toHaveLength(11);
    expect(getModeCatalog(CONTEXT_MODES.PHRASES)).toHaveLength(32);

    // Deletrear en Abecedario, cambiar a Frases y Modales y continuar la misma oración
    let sentence = [];
    sentence = useSignEngineMod.appendCommittedSign(sentence, {
      committed: true,
      committedLabel: 'Letra A',
      confidence: 0.92,
    });
    sentence = useSignEngineMod.appendCommittedSign(sentence, {
      committed: true,
      committedLabel: 'Letra Ñ',
      confidence: 0.89,
    });
    sentence = useSignEngineMod.appendCommittedSign(sentence, {
      committed: true,
      committedLabel: 'Gracias',
      confidence: 0.91,
    });
    sentence = useSignEngineMod.appendCommittedSign(sentence, {
      committed: true,
      committedLabel: 'Buenos días',
      confidence: 0.88,
    });

    expect(sentence.map((item) => item.label)).toEqual([
      'Letra A',
      'Letra Ñ',
      'Gracias',
      'Buenos días',
    ]);
    expect(sentence.map((item) => item.speakText)).toEqual([
      'Letra A',
      'Letra eñe',
      'Gracias',
      'Buenos días',
    ]);
  });
});
