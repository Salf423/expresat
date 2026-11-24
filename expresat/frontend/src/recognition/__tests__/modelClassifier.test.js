import { describe, it, expect, vi } from 'vitest';
import {
  ModelClassifier,
  validateModelMetadata,
  softmaxWithTemperature,
  evaluateRejectionGates,
  probeNeuralModelAvailability,
  DEFAULT_MODEL_URL,
  DEFAULT_METADATA_URL,
} from '../modelClassifier.js';
import {
  FEATURE_SPEC_VERSION,
  SEQUENCE_LENGTH,
  TOTAL_FEATURES,
  computeConfigHash,
} from '../../engine/featureExtractor.js';
import { SYNTHETIC_PRESETS } from '../syntheticHand.js';
import { CLASSIFIER_ENGINES, resolveEnablePose } from '../../ui/useSignEngine.js';

function buildValidPose() {
  const pose = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0.0,
    visibility: 0.98,
  }));
  pose[0] = { x: 0.5, y: 0.25, z: -0.05, visibility: 0.99 };
  pose[11] = { x: 0.35, y: 0.45, z: 0.0, visibility: 0.99 };
  pose[12] = { x: 0.65, y: 0.45, z: 0.0, visibility: 0.99 };
  pose[13] = { x: 0.28, y: 0.62, z: 0.0, visibility: 0.95 };
  pose[14] = { x: 0.72, y: 0.62, z: 0.0, visibility: 0.95 };
  pose[15] = { x: 0.32, y: 0.72, z: 0.0, visibility: 0.95 };
  pose[16] = { x: 0.68, y: 0.72, z: 0.0, visibility: 0.95 };
  return pose;
}

function buildValidRawWindow(numFrames = 16, stepMs = 66.67) {
  const pose = buildValidPose();
  const rightHand = SYNTHETIC_PRESETS.HOLA
    ? SYNTHETIC_PRESETS.CINCO({ handedness: 'Right', palmFacing: 'FRONT' })
    : SYNTHETIC_PRESETS.UNO({ handedness: 'Right', palmFacing: 'FRONT' });

  return Array.from({ length: numFrames }, (_, idx) => ({
    t_ms: 1000 + idx * stepMs,
    pose,
    hands: [rightHand],
    handedness: [[{ categoryName: 'Right', score: 0.98 }]],
    leftHand: null,
    rightHand,
  }));
}

async function buildProductionMetadata(overrides = {}) {
  const delegate = overrides.delegate ?? 'GPU';
  const poseCadence = overrides.pose_cadence ?? 1;
  const configHash =
    overrides.config_hash !== undefined
      ? overrides.config_hash
      : await computeConfigHash({ delegate, poseCadence });

  return {
    architecture: 'DS-TCN-1D',
    feature_spec_version: FEATURE_SPEC_VERSION,
    sequence_length: SEQUENCE_LENGTH,
    num_features: TOTAL_FEATURES,
    delegate,
    pose_cadence: poseCadence,
    config_hash: configHash,
    production_ready: true,
    is_smoke_test: false,
    labels: ['reposo', 'hola', 'gracias', 'por_favor'],
    num_classes: 4,
    temperature: 1.0,
    rejection_policy: {
      min_confidence: 0.65,
      min_margin: 0.2,
      max_normalized_entropy: 0.55,
      fallback_label: 'reposo',
    },
    model_files: {
      int8: 'expresat_dstcn_int8.onnx',
    },
    ...overrides,
  };
}

describe('recognition/modelClassifier — Motor neuronal ONNX Runtime Web (DS-TCN-1D v1.4.0)', () => {
  it('rechaza estrictamente artefactos is_smoke_test=true, production_ready!=true, spec desalineado o config_hash inválido', async () => {
    const smokeMeta = await buildProductionMetadata({ is_smoke_test: true });
    const smokeRes = await validateModelMetadata(smokeMeta);
    expect(smokeRes.valid).toBe(false);
    expect(smokeRes.code).toBe('SMOKE_TEST_BLOCKED');

    const unreadyMeta = await buildProductionMetadata({ production_ready: false });
    const unreadyRes = await validateModelMetadata(unreadyMeta);
    expect(unreadyRes.valid).toBe(false);
    expect(unreadyRes.code).toBe('NOT_PRODUCTION_READY');

    const oldSpecMeta = await buildProductionMetadata({ feature_spec_version: '1.3.0' });
    const oldSpecRes = await validateModelMetadata(oldSpecMeta);
    expect(oldSpecRes.valid).toBe(false);
    expect(oldSpecRes.code).toBe('INCOMPATIBLE_FEATURE_SPEC');

    const badHashMeta = await buildProductionMetadata({ config_hash: '0'.repeat(64) });
    const badHashRes = await validateModelMetadata(badHashMeta);
    expect(badHashRes.valid).toBe(false);
    expect(badHashRes.code).toBe('CONFIG_HASH_MISMATCH');

    const validMeta = await buildProductionMetadata();
    const okRes = await validateModelMetadata(validMeta);
    expect(okRes.valid).toBe(true);
    expect(okRes.normalized.featureSpecVersion).toBe('1.4.0');
    expect(okRes.normalized.productionReady).toBe(true);
  });

  it('aplica Temperature Scaling (logits / T) con softmax numéricamente estable', () => {
    const logits = [4.0, 2.0, 0.0];
    const pCold = softmaxWithTemperature(logits, 0.5);
    const pUnit = softmaxWithTemperature(logits, 1.0);
    const pWarm = softmaxWithTemperature(logits, 2.5);

    const sumUnit = pUnit[0] + pUnit[1] + pUnit[2];
    expect(sumUnit).toBeCloseTo(1.0, 8);
    // Lower temperature sharpens confidence; higher temperature softens it
    expect(pCold[0]).toBeGreaterThan(pUnit[0]);
    expect(pUnit[0]).toBeGreaterThan(pWarm[0]);

    // Large logits must not overflow to NaN/Infinity
    const huge = softmaxWithTemperature([1000, 999, 990], 1.0);
    expect(Number.isFinite(huge[0])).toBe(true);
    expect(huge[0] + huge[1] + huge[2]).toBeCloseTo(1.0, 8);
  });

  it('aplica las 3 compuertas de rechazo (confianza mínima, margen top1-top2 y entropía máxima -> reposo / null)', () => {
    const labels4 = ['reposo', 'hola', 'gracias', 'por_favor'];

    // Compuerta 1: confianza baja (< 0.65)
    const g1 = evaluateRejectionGates([0.1, 0.55, 0.25, 0.1], labels4, {
      minConfidence: 0.65,
      minMargin: 0.2,
      maxNormalizedEntropy: 0.55,
      fallbackLabel: 'reposo',
    });
    expect(g1.rejected).toBe(true);
    expect(g1.rejectionReason).toBe('low_confidence');
    expect(g1.label).toBeNull();
    expect(g1.safeLabel).toBe('reposo');

    // Compuerta 2: margen top1 - top2 bajo (< 0.20) aun pasando confianza mínima
    const g2 = evaluateRejectionGates([0.04, 0.52, 0.4, 0.04], labels4, {
      minConfidence: 0.45,
      minMargin: 0.2,
      maxNormalizedEntropy: 0.9,
      fallbackLabel: 'reposo',
    });
    expect(g2.rejected).toBe(true);
    expect(g2.rejectionReason).toBe('low_margin');
    expect(g2.label).toBeNull();
    expect(g2.safeLabel).toBe('reposo');

    // Compuerta 3: entropía normalizada excesiva (> 0.55) pasando confianza y margen
    const labels10 = ['reposo', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const g3 = evaluateRejectionGates(
      [0.06, 0.46, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06],
      labels10,
      {
        minConfidence: 0.4,
        minMargin: 0.15,
        maxNormalizedEntropy: 0.55,
        fallbackLabel: 'reposo',
      }
    );
    expect(g3.rejected).toBe(true);
    expect(g3.rejectionReason).toBe('high_entropy');
    expect(g3.normalizedEntropy).toBeGreaterThan(0.55);
    expect(g3.label).toBeNull();
    expect(g3.safeLabel).toBe('reposo');

    // Predicción limpia que pasa las 3 compuertas
    const pass = evaluateRejectionGates([0.02, 0.91, 0.04, 0.03], labels4, {
      minConfidence: 0.65,
      minMargin: 0.2,
      maxNormalizedEntropy: 0.55,
      fallbackLabel: 'reposo',
    });
    expect(pass.rejected).toBe(false);
    expect(pass.label).toBe('hola');
    expect(pass.safeLabel).toBe('hola');
    expect(pass.confidence).toBeCloseTo(0.91, 4);
  });

  it('extrae tensor (1, 15, 178) float32 con extractWindow, invoca la sesión ONNX mockeada y aplica Temperature Scaling', async () => {
    const metadata = await buildProductionMetadata({ temperature: 1.5 });
    const mockSession = {
      inputNames: ['input_sequence'],
      outputNames: ['logits'],
      run: vi.fn().mockResolvedValue({
        logits: { data: new Float32Array([-2.0, 5.5, 0.2, -1.0]) },
      }),
    };

    const clf = new ModelClassifier();
    const loadRes = await clf.load({ metadata, session: mockSession });
    expect(loadRes.ready).toBe(true);
    expect(clf.isReady).toBe(true);

    const rawWindow = buildValidRawWindow(16, 66.67);
    const pred = await clf.predictAsync(rawWindow);

    expect(mockSession.run).toHaveBeenCalledTimes(1);
    const feeds = mockSession.run.mock.calls[0][0];
    expect(feeds.input_sequence).toBeTruthy();
    expect(feeds.input_sequence.type).toBe('float32');
    expect(feeds.input_sequence.dims).toEqual([1, 15, 178]);
    expect(feeds.input_sequence.data).toBeInstanceOf(Float32Array);
    expect(feeds.input_sequence.data.length).toBe(15 * 178);

    expect(pred.label).toBe('hola');
    expect(pred.state).toBe('confirmed');
    expect(pred.confidence).toBeGreaterThan(0.9);
    expect(pred.details.temperature).toBe(1.5);
    expect(pred.details.rejected).toBe(false);

    // When temperature is very high (softening logits below min_confidence), Gate 1 safely rejects -> null / reposo
    const warmMeta = await buildProductionMetadata({ temperature: 12.0 });
    const warmClf = new ModelClassifier();
    await warmClf.load({ metadata: warmMeta, session: mockSession });
    const warmPred = await warmClf.predictAsync(rawWindow);
    expect(warmPred.label).toBeNull();
    expect(warmPred.state).toBe('rejected');
    expect(warmPred.details.rejectionReason).toBe('low_confidence');
    expect(warmPred.details.safeLabel).toBe('reposo');
  });

  it('maneja limpiamente la ausencia de archivos .onnx o model_metadata.json (404 / HTML SPA fallback) sin lanzar errores', async () => {
    const fetch404 = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => 'text/plain' },
    });

    const probe404 = await probeNeuralModelAvailability({
      modelUrl: DEFAULT_MODEL_URL,
      metadataUrl: DEFAULT_METADATA_URL,
      fetchFn: fetch404,
    });
    expect(probe404.available).toBe(false);
    expect(probe404.status).toBe('unavailable');
    expect(probe404.message).toBe('Modelo neuronal en preparación');

    // SPA fallback returning 200 OK with text/html must also be detected cleanly as unavailable
    const fetchSpaHtml = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html; charset=utf-8' },
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
    });
    const clf = new ModelClassifier();
    const loadRes = await clf.load({ fetchFn: fetchSpaHtml });
    expect(loadRes.ready).toBe(false);
    expect(loadRes.status).toBe('unavailable');
    expect(clf.isReady).toBe(false);

    // Synchronous predict() before model is loaded never throws and returns idle null
    const syncPred = clf.predict({ pose: null, hands: [] });
    expect(syncPred.label).toBeNull();
    expect(syncPred.confidence).toBe(0);
    expect(syncPred.state).toBe('idle');
  });

  it('rechaza cargar un modelo smoke_test aunque exista en el servidor', async () => {
    const smokeMeta = await buildProductionMetadata({ is_smoke_test: true, production_ready: false });
    const fetchSmoke = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: vi.fn().mockResolvedValue(smokeMeta),
    });

    const clf = new ModelClassifier();
    const loadRes = await clf.load({ fetchFn: fetchSmoke });
    expect(loadRes.ready).toBe(false);
    expect(loadRes.status).toBe('invalid');
    expect(loadRes.reason).toBe('SMOKE_TEST_BLOCKED');
    expect(clf.isReady).toBe(false);
  });

  it('mapea la clase reposo a label=null (idle), ejecuta predict() síncrono sin bloquear y activa enablePose en modo neural', async () => {
    // resolveEnablePose enables PoseLandmarker ONLY when neural local mode is selected
    expect(resolveEnablePose({ classifierEngine: CLASSIFIER_ENGINES.GEOMETRIC })).toBe(false);
    expect(resolveEnablePose({ classifierEngine: CLASSIFIER_ENGINES.NEURAL_LOCAL })).toBe(true);

    const metadata = await buildProductionMetadata();
    const restSession = {
      inputNames: ['input'],
      outputNames: ['logits'],
      run: vi.fn().mockResolvedValue({
        logits: { data: new Float32Array([6.0, -1.0, -1.0, -1.0]) },
      }),
    };

    const restClf = new ModelClassifier();
    await restClf.load({ metadata, session: restSession });
    const rawWindow = buildValidRawWindow(16, 66.67);
    const restPred = await restClf.predictAsync(rawWindow);
    expect(restPred.label).toBeNull();
    expect(restPred.state).toBe('idle');
    expect(restPred.details.safeLabel).toBe('reposo');
    expect(restPred.details.reason).toBe('REST_CLASS');

    // Rolling synchronous predict() triggers background ONNX session and emits a single committed edge
    const signSession = {
      inputNames: ['input'],
      outputNames: ['logits'],
      run: vi.fn().mockResolvedValue({
        logits: { data: new Float32Array([-2.0, -1.0, 6.2, -1.0]) },
      }),
    };
    const streamClf = new ModelClassifier({ inferIntervalMs: 0 });
    await streamClf.load({ metadata, session: signSession });

    for (const fr of rawWindow) {
      streamClf.predict({ timestamp: fr.t_ms, raw: fr });
    }
    // Wait for background microtask promise to settle
    await new Promise((r) => setTimeout(r, 10));

    const committedPred = streamClf.predict({
      timestamp: rawWindow[rawWindow.length - 1].t_ms + 33,
      raw: rawWindow[rawWindow.length - 1],
    });
    expect(committedPred.label).toBe('gracias');
    expect(committedPred.committed).toBe(true);
    expect(committedPred.committedLabel).toBe('gracias');

    // Reset clears buffer and restores idle state
    streamClf.reset();
    const afterReset = streamClf.predict({ pose: null, hands: [] });
    expect(afterReset.label).toBeNull();
    expect(afterReset.state).toBe('idle');
  });
});
