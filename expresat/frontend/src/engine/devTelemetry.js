/**
 * src/engine/devTelemetry.js — Instrumentación diagnóstica exclusiva de desarrollo (import.meta.env.DEV)
 *
 * Registra métricas sin alterar el flujo de captura, inferencia o renderizado:
 * - Frames únicos de cámara (vía rVFC pasivo / presentedFrames) vs frames vistos por el loop vs inferidos
 * - Contador de inferencias duplicadas (mismo video.currentTime) y frames saltados
 * - Tiempo de espera de frame (inter-frame cámara, espera de tick, edad del frame, ciclo)
 * - performance.mark / performance.measure por etapa: hand, pose, dibujo, UI (dispatch y commit)
 * - Negociación getUserMedia (getSettings, getCapabilities, videoWidth/Height, experimento exact15)
 * - Comparativa separada Reposo (grabador inactivo) vs Grabando (grabador activo) con p50/p95/p99/máx
 */

export const IS_DEV = Boolean(import.meta.env?.DEV);

const MAX_PERF_ENTRIES_BEFORE_TRIM = 400;

export function computePercentiles(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { count: 0, mean: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }
  const clean = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      clean.push(v);
    }
  }
  if (clean.length === 0) {
    return { count: 0, mean: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }
  clean.sort((a, b) => a - b);
  const n = clean.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += clean[i];
  const round2 = (x) => Number(x.toFixed(2));
  return {
    count: n,
    mean: round2(sum / n),
    min: round2(clean[0]),
    p50: round2(clean[Math.min(n - 1, Math.floor(n * 0.5))]),
    p95: round2(clean[Math.min(n - 1, Math.floor(n * 0.95))]),
    p99: round2(clean[Math.min(n - 1, Math.floor(n * 0.99))]),
    max: round2(clean[n - 1]),
  };
}

export class BoundedRing {
  constructor(capacity = 1800) {
    this.capacity = Math.max(1, capacity);
    this._buf = new Array(this.capacity);
    this._count = 0;
    this._head = 0;
  }

  push(val) {
    if (typeof val !== 'number' || !Number.isFinite(val)) return;
    this._buf[this._head] = val;
    this._head = (this._head + 1) % this.capacity;
    if (this._count < this.capacity) {
      this._count++;
    }
  }

  toArray() {
    if (this._count === 0) return [];
    if (this._count < this.capacity) {
      return this._buf.slice(0, this._count);
    }
    const out = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      out[i] = this._buf[(this._head + i) % this.capacity];
    }
    return out;
  }

  clear() {
    this._count = 0;
    this._head = 0;
  }
}

function createPhaseBucket(maxSamples) {
  return {
    startedAtMs: null,
    accumulatedMs: 0,
    uniqueCameraFrames: 0,
    rvfcCallbacks: 0,
    loopObservedCameraFrames: 0,
    totalInferences: 0,
    uniqueInferredFrames: 0,
    duplicateInferences: 0,
    inferenceErrors: 0,
    skippedCameraFramesAtInference: 0,
    poseInvokedCount: 0,
    series: {
      cameraInterFrameMs: new BoundedRing(maxSamples),
      cameraMediaStepMs: new BoundedRing(maxSamples),
      rafTickIntervalMs: new BoundedRing(maxSamples),
      tickWaitMs: new BoundedRing(maxSamples),
      inferenceCycleMs: new BoundedRing(maxSamples),
      frameWaitForNewCameraMs: new BoundedRing(maxSamples),
      frameAgeSinceRvfcMs: new BoundedRing(maxSamples),
      handMs: new BoundedRing(maxSamples),
      poseInvokedMs: new BoundedRing(maxSamples),
      poseAllFramesMs: new BoundedRing(maxSamples),
      trackerMs: new BoundedRing(maxSamples),
      canvasDrawMs: new BoundedRing(maxSamples),
      dibujoMs: new BoundedRing(maxSamples),
      uiDispatchMs: new BoundedRing(maxSamples),
      recorderOnFrameMs: new BoundedRing(maxSamples),
      uiCommitTranslatorMs: new BoundedRing(maxSamples),
      uiCommitRecorderMs: new BoundedRing(maxSamples),
      uiCommitMs: new BoundedRing(maxSamples),
      totalFrameMs: new BoundedRing(maxSamples),
      overheadOtherMs: new BoundedRing(maxSamples),
    },
  };
}

function summarizeBucket(bucket, isActivePhase, nowMs) {
  let durationMs = bucket.accumulatedMs;
  if (isActivePhase && bucket.startedAtMs !== null) {
    durationMs += Math.max(0, nowMs - bucket.startedAtMs);
  }
  const durationSec = Number((durationMs / 1000).toFixed(2));
  const duplicateRatioPct =
    bucket.totalInferences > 0
      ? Number(((bucket.duplicateInferences / bucket.totalInferences) * 100).toFixed(1))
      : 0;

  return {
    durationSec,
    counts: {
      uniqueCameraFrames: bucket.uniqueCameraFrames,
      rvfcCallbacks: bucket.rvfcCallbacks,
      loopObservedCameraFrames: bucket.loopObservedCameraFrames,
      totalInferences: bucket.totalInferences,
      uniqueInferredFrames: bucket.uniqueInferredFrames,
      duplicateInferences: bucket.duplicateInferences,
      duplicateRatioPct,
      inferenceErrors: bucket.inferenceErrors,
      skippedCameraFramesAtInference: bucket.skippedCameraFramesAtInference,
      poseInvokedCount: bucket.poseInvokedCount,
      avgRealCameraFps:
        durationSec > 0 ? Number((bucket.uniqueCameraFrames / durationSec).toFixed(2)) : 0,
      avgInferenceFps:
        durationSec > 0 ? Number((bucket.totalInferences / durationSec).toFixed(2)) : 0,
      avgUniqueInferredFps:
        durationSec > 0 ? Number((bucket.uniqueInferredFrames / durationSec).toFixed(2)) : 0,
    },
    stages: {
      cameraInterFrameMs: computePercentiles(bucket.series.cameraInterFrameMs.toArray()),
      cameraMediaStepMs: computePercentiles(bucket.series.cameraMediaStepMs.toArray()),
      rafTickIntervalMs: computePercentiles(bucket.series.rafTickIntervalMs.toArray()),
      tickWaitMs: computePercentiles(bucket.series.tickWaitMs.toArray()),
      inferenceCycleMs: computePercentiles(bucket.series.inferenceCycleMs.toArray()),
      frameWaitForNewCameraMs: computePercentiles(bucket.series.frameWaitForNewCameraMs.toArray()),
      frameAgeSinceRvfcMs: computePercentiles(bucket.series.frameAgeSinceRvfcMs.toArray()),
      handMs: computePercentiles(bucket.series.handMs.toArray()),
      poseInvokedMs: computePercentiles(bucket.series.poseInvokedMs.toArray()),
      poseAllFramesMs: computePercentiles(bucket.series.poseAllFramesMs.toArray()),
      trackerMs: computePercentiles(bucket.series.trackerMs.toArray()),
      canvasDrawMs: computePercentiles(bucket.series.canvasDrawMs.toArray()),
      dibujoMs: computePercentiles(bucket.series.dibujoMs.toArray()),
      uiDispatchMs: computePercentiles(bucket.series.uiDispatchMs.toArray()),
      recorderOnFrameMs: computePercentiles(bucket.series.recorderOnFrameMs.toArray()),
      uiCommitTranslatorMs: computePercentiles(bucket.series.uiCommitTranslatorMs.toArray()),
      uiCommitRecorderMs: computePercentiles(bucket.series.uiCommitRecorderMs.toArray()),
      uiCommitMs: computePercentiles(bucket.series.uiCommitMs.toArray()),
      totalFrameMs: computePercentiles(bucket.series.totalFrameMs.toArray()),
      overheadOtherMs: computePercentiles(bucket.series.overheadOtherMs.toArray()),
    },
  };
}

let activeCollector = null;

export function setActiveDevCollector(collector) {
  activeCollector = collector || null;
}

export function getActiveDevCollector() {
  return activeCollector;
}

export function onDevProfilerRender(id, _phase, actualDuration, _baseDuration, startTime) {
  if (!import.meta.env.DEV || !activeCollector?.enabled) return;
  if (typeof actualDuration === 'number' && Number.isFinite(actualDuration)) {
    activeCollector.recordUiCommit(id, actualDuration);
    if (typeof performance?.measure === 'function' && typeof startTime === 'number') {
      try {
        performance.measure(`expresat:stage:ui_commit:${id}`, {
          start: startTime,
          duration: Math.max(0, actualDuration),
        });
        activeCollector._maybeTrimPerfTimeline();
      } catch {
        // Fallback si el navegador rechaza start/duration en measure()
      }
    }
  }
}

export class DevTelemetryCollector {
  constructor({ enabled = IS_DEV, maxSamples = 1800 } = {}) {
    this.enabled = Boolean(enabled);
    this.maxSamples = maxSamples;
    this.phase = 'reposo';
    this._buckets = {
      reposo: createPhaseBucket(maxSamples),
      grabando: createPhaseBucket(maxSamples),
    };
    this._resetState();
  }

  _resetState() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this._buckets.reposo = createPhaseBucket(this.maxSamples);
    this._buckets.grabando = createPhaseBucket(this.maxSamples);
    this._buckets[this.phase].startedAtMs = now;

    this._rvfcSupported = null;
    this._prevRvfcNowMs = null;
    this._prevRvfcMediaTime = null;
    this._prevPresentedFrames = null;
    this._lastRealCameraFrameAtPerf = null;

    this._prevRafTickNowMs = null;
    this._lastInferredVideoTime = -1;
    this._prevInferStartPerf = null;
    this._prevInferEndPerf = null;
    this._lastUniqueInferPerf = null;
    this._prevPresentedAtInfer = null;
    this._lastPlaybackTotalFrames = null;

    this._secCounters = {
      realCameraFrames: 0,
      rvfcCallbacks: 0,
      loopCameraFrames: 0,
      totalInferences: 0,
      uniqueInferredFrames: 0,
      duplicateInferences: 0,
      skippedCameraFrames: 0,
    };

    this._live = {
      realCameraFps: 0,
      rvfcCallbacksPerSec: 0,
      loopCameraFps: 0,
      inferenceFps: 0,
      uniqueInferredFps: 0,
      duplicateInferenceFps: 0,
      skippedCameraFramesPerSec: 0,
      playbackTotalFramesPerSec: null,
      playbackDroppedTotal: null,
    };

    this._measureOpCount = 0;
    this._currentFrameStages = null;
  }

  reset() {
    if (!this.enabled) return;
    this._resetState();
  }

  setPhase(nextPhase) {
    if (!this.enabled) return;
    const normalized = nextPhase === 'grabando' ? 'grabando' : 'reposo';
    if (normalized === this.phase) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const curBucket = this._buckets[this.phase];
    if (curBucket.startedAtMs !== null) {
      curBucket.accumulatedMs += Math.max(0, now - curBucket.startedAtMs);
      curBucket.startedAtMs = null;
    }
    this.phase = normalized;
    this._buckets[this.phase].startedAtMs = now;
  }

  setRuntimeConfig(cfg) {
    if (!this.enabled) return;
    this._runtimeConfig = { ...cfg };
  }

  setCameraNegotiation(info) {
    if (!this.enabled) return;
    this._cameraNegotiation = {
      ...(this._cameraNegotiation || {}),
      ...info,
    };
  }

  setRvfcSupported(supported) {
    if (!this.enabled) return;
    this._rvfcSupported = Boolean(supported);
  }

  mark(name) {
    if (!this.enabled || typeof performance?.mark !== 'function') return false;
    try {
      performance.mark(name);
      return true;
    } catch {
      return false;
    }
  }

  endAndMeasure(measureName, startMark, endMark) {
    if (
      !this.enabled ||
      typeof performance?.mark !== 'function' ||
      typeof performance?.measure !== 'function'
    ) {
      return null;
    }
    try {
      performance.mark(endMark);
      const entry = performance.measure(measureName, startMark, endMark);
      let duration = entry?.duration;
      if (typeof duration !== 'number' && typeof performance.getEntriesByName === 'function') {
        const list = performance.getEntriesByName(measureName, 'measure');
        duration = list.length > 0 ? list[list.length - 1].duration : null;
      }
      this._maybeTrimPerfTimeline();
      return typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
        ? duration
        : null;
    } catch {
      return null;
    }
  }

  _maybeTrimPerfTimeline() {
    this._measureOpCount++;
    if (this._measureOpCount % 60 !== 0) return;
    try {
      if (typeof performance.getEntriesByType !== 'function') return;
      if (performance.getEntriesByType('measure').length > MAX_PERF_ENTRIES_BEFORE_TRIM) {
        performance.clearMeasures?.();
      }
      if (performance.getEntriesByType('mark').length > MAX_PERF_ENTRIES_BEFORE_TRIM * 2) {
        performance.clearMarks?.();
      }
    } catch {
      // ignore
    }
  }

  recordRealCameraFrame(nowMs, metadata = {}) {
    if (!this.enabled) return;
    const bucket = this._buckets[this.phase];
    const perfNow = typeof performance !== 'undefined' ? performance.now() : nowMs;
    this._lastRealCameraFrameAtPerf = perfNow;

    let frameDelta = 1;
    if (typeof metadata.presentedFrames === 'number' && Number.isFinite(metadata.presentedFrames)) {
      if (this._prevPresentedFrames !== null) {
        const diff = metadata.presentedFrames - this._prevPresentedFrames;
        frameDelta = diff > 0 ? diff : 0;
      }
      this._prevPresentedFrames = metadata.presentedFrames;
    } else if (typeof metadata.mediaTime === 'number' && this._prevRvfcMediaTime !== null) {
      frameDelta = metadata.mediaTime !== this._prevRvfcMediaTime ? 1 : 0;
    }

    bucket.rvfcCallbacks++;
    this._secCounters.rvfcCallbacks++;

    if (frameDelta > 0) {
      bucket.uniqueCameraFrames += frameDelta;
      this._secCounters.realCameraFrames += frameDelta;
    }

    if (this._prevRvfcNowMs !== null && frameDelta === 1) {
      const dtCam = nowMs - this._prevRvfcNowMs;
      if (Number.isFinite(dtCam) && dtCam >= 0) {
        bucket.series.cameraInterFrameMs.push(dtCam);
      }
    }
    this._prevRvfcNowMs = nowMs;

    if (
      typeof metadata.mediaTime === 'number' &&
      Number.isFinite(metadata.mediaTime) &&
      this._prevRvfcMediaTime !== null &&
      frameDelta > 0
    ) {
      const mediaDtMs = ((metadata.mediaTime - this._prevRvfcMediaTime) * 1000) / frameDelta;
      if (Number.isFinite(mediaDtMs) && mediaDtMs > 0) {
        bucket.series.cameraMediaStepMs.push(mediaDtMs);
      }
    }
    if (typeof metadata.mediaTime === 'number' && Number.isFinite(metadata.mediaTime)) {
      this._prevRvfcMediaTime = metadata.mediaTime;
    }
  }

  recordRafTick(nowMs, videoTimeAdvanced) {
    if (!this.enabled) return;
    const bucket = this._buckets[this.phase];
    if (this._prevRafTickNowMs !== null) {
      const dt = nowMs - this._prevRafTickNowMs;
      if (Number.isFinite(dt) && dt >= 0) {
        bucket.series.rafTickIntervalMs.push(dt);
      }
    }
    this._prevRafTickNowMs = nowMs;

    if (videoTimeAdvanced) {
      bucket.loopObservedCameraFrames++;
      this._secCounters.loopCameraFrames++;
    }
  }

  beginInferenceStep(videoCurrentTime, startPerf) {
    if (!this.enabled) return;
    const isNewFrame =
      this._lastInferredVideoTime === -1 || videoCurrentTime !== this._lastInferredVideoTime;

    this._currentFrameStages = {
      startPerf,
      videoCurrentTime,
      isNewFrame,
      handMs: 0,
      poseMs: 0,
      poseRan: false,
      trackerMs: 0,
      canvasDrawMs: 0,
      uiDispatchMs: 0,
      recorderOnFrameMs: 0,
    };
    this.mark('expresat:frame:start');
  }

  recordStageDuration(stageName, durationMs) {
    if (!this.enabled || !this._currentFrameStages) return;
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return;

    if (stageName === 'hand') {
      this._currentFrameStages.handMs = durationMs;
    } else if (stageName === 'pose') {
      this._currentFrameStages.poseMs = durationMs;
      this._currentFrameStages.poseRan = true;
    } else if (stageName === 'tracker') {
      this._currentFrameStages.trackerMs = durationMs;
    } else if (stageName === 'canvas') {
      this._currentFrameStages.canvasDrawMs = durationMs;
    } else if (stageName === 'ui_dispatch') {
      this._currentFrameStages.uiDispatchMs += durationMs;
    } else if (stageName === 'recorder_onframe') {
      this._currentFrameStages.recorderOnFrameMs = durationMs;
      this._currentFrameStages.uiDispatchMs += durationMs;
    }
  }

  recordUiCommit(componentKey, durationMs) {
    if (!this.enabled || typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return;
    const bucket = this._buckets[this.phase];
    if (componentKey === 'dev_recorder') {
      bucket.series.uiCommitRecorderMs.push(durationMs);
    } else {
      bucket.series.uiCommitTranslatorMs.push(durationMs);
      bucket.series.uiCommitMs.push(durationMs);
    }
  }

  endInferenceStep(endPerf, completed = true) {
    if (!this.enabled || !this._currentFrameStages) return;
    const st = this._currentFrameStages;
    const startPerf = st.startPerf;
    const measuredTotal = this.endAndMeasure(
      'expresat:stage:total_frame',
      'expresat:frame:start',
      'expresat:frame:end'
    );
    const totalMs =
      measuredTotal !== null
        ? measuredTotal
        : typeof startPerf === 'number'
          ? Math.max(0, endPerf - startPerf)
          : 0;

    const bucket = this._buckets[this.phase];
    if (!completed) {
      bucket.inferenceErrors++;
      this._prevInferEndPerf = endPerf;
      this._currentFrameStages = null;
      return;
    }

    bucket.totalInferences++;
    this._secCounters.totalInferences++;

    if (st.isNewFrame) {
      bucket.uniqueInferredFrames++;
      this._secCounters.uniqueInferredFrames++;
      if (this._lastUniqueInferPerf !== null) {
        bucket.series.frameWaitForNewCameraMs.push(startPerf - this._lastUniqueInferPerf);
      }
      this._lastUniqueInferPerf = startPerf;
    } else {
      bucket.duplicateInferences++;
      this._secCounters.duplicateInferences++;
      if (this._lastUniqueInferPerf !== null) {
        bucket.series.frameWaitForNewCameraMs.push(startPerf - this._lastUniqueInferPerf);
      }
    }
    this._lastInferredVideoTime = st.videoCurrentTime;

    if (this._prevInferStartPerf !== null) {
      bucket.series.inferenceCycleMs.push(startPerf - this._prevInferStartPerf);
    }
    this._prevInferStartPerf = startPerf;

    if (this._prevInferEndPerf !== null) {
      bucket.series.tickWaitMs.push(Math.max(0, startPerf - this._prevInferEndPerf));
    }

    if (this._lastRealCameraFrameAtPerf !== null) {
      bucket.series.frameAgeSinceRvfcMs.push(
        Math.max(0, startPerf - this._lastRealCameraFrameAtPerf)
      );
    }

    if (this._prevPresentedFrames !== null) {
      if (this._prevPresentedAtInfer !== null) {
        const deltaPres = this._prevPresentedFrames - this._prevPresentedAtInfer;
        if (deltaPres > 1) {
          const skipped = deltaPres - 1;
          bucket.skippedCameraFramesAtInference += skipped;
          this._secCounters.skippedCameraFrames += skipped;
        }
      }
      this._prevPresentedAtInfer = this._prevPresentedFrames;
    }

    const dibujoMs = st.trackerMs + st.canvasDrawMs;

    bucket.series.handMs.push(st.handMs);
    bucket.series.poseAllFramesMs.push(st.poseMs);
    if (st.poseRan) {
      bucket.poseInvokedCount++;
      bucket.series.poseInvokedMs.push(st.poseMs);
    }
    bucket.series.trackerMs.push(st.trackerMs);
    bucket.series.canvasDrawMs.push(st.canvasDrawMs);
    bucket.series.dibujoMs.push(dibujoMs);
    bucket.series.uiDispatchMs.push(st.uiDispatchMs);
    if (st.recorderOnFrameMs > 0) {
      bucket.series.recorderOnFrameMs.push(st.recorderOnFrameMs);
    }
    bucket.series.totalFrameMs.push(totalMs);

    const accounted = st.handMs + st.poseMs + dibujoMs + st.uiDispatchMs;
    bucket.series.overheadOtherMs.push(Math.max(0, totalMs - accounted));

    this._prevInferEndPerf = endPerf;
    this._currentFrameStages = null;
  }

  flushSecondMetrics(playbackQuality = null) {
    if (!this.enabled) return null;

    let playbackTotalFramesPerSec = null;
    let playbackDroppedTotal = null;
    if (playbackQuality && typeof playbackQuality.totalVideoFrames === 'number') {
      if (this._lastPlaybackTotalFrames !== null) {
        playbackTotalFramesPerSec = Math.max(
          0,
          playbackQuality.totalVideoFrames - this._lastPlaybackTotalFrames
        );
      }
      this._lastPlaybackTotalFrames = playbackQuality.totalVideoFrames;
      if (typeof playbackQuality.droppedVideoFrames === 'number') {
        playbackDroppedTotal = playbackQuality.droppedVideoFrames;
      }
    }

    this._live = {
      realCameraFps: this._secCounters.realCameraFrames,
      rvfcCallbacksPerSec: this._secCounters.rvfcCallbacks,
      loopCameraFps: this._secCounters.loopCameraFrames,
      inferenceFps: this._secCounters.totalInferences,
      uniqueInferredFps: this._secCounters.uniqueInferredFrames,
      duplicateInferenceFps: this._secCounters.duplicateInferences,
      skippedCameraFramesPerSec: this._secCounters.skippedCameraFrames,
      playbackTotalFramesPerSec,
      playbackDroppedTotal,
    };

    this._secCounters = {
      realCameraFrames: 0,
      rvfcCallbacks: 0,
      loopCameraFrames: 0,
      totalInferences: 0,
      uniqueInferredFrames: 0,
      duplicateInferences: 0,
      skippedCameraFrames: 0,
    };

    // Durante la grabación activa NO ejecutar getSnapshot()/summarizeBucket()/sort() cada 1s:
    // solo acumular en memoria O(1) para cero interferencia con la captura.
    if (this.phase === 'grabando') {
      return {
        phase: this.phase,
        rvfcSupported: this._rvfcSupported,
        runtimeConfig: this._runtimeConfig || null,
        cameraNegotiation: this._cameraNegotiation || null,
        live: { ...this._live },
        phases: null,
        skippedHeavySnapshot: true,
      };
    }

    return this.getSnapshot();
  }

  getSnapshot() {
    if (!this.enabled) return null;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
      phase: this.phase,
      rvfcSupported: this._rvfcSupported,
      runtimeConfig: this._runtimeConfig || null,
      cameraNegotiation: this._cameraNegotiation || null,
      live: { ...this._live },
      phases: {
        reposo: summarizeBucket(this._buckets.reposo, this.phase === 'reposo', now),
        grabando: summarizeBucket(this._buckets.grabando, this.phase === 'grabando', now),
      },
    };
  }

  buildComparisonReport() {
    const snap = this.getSnapshot();
    if (!snap) return null;
    const rep = snap.phases.reposo;
    const grab = snap.phases.grabando;

    const deltaStage = (key) => ({
      reposo_p50: rep.stages[key].p50,
      grabando_p50: grab.stages[key].p50,
      delta_p50_ms: Number((grab.stages[key].p50 - rep.stages[key].p50).toFixed(2)),
      reposo_p95: rep.stages[key].p95,
      grabando_p95: grab.stages[key].p95,
      delta_p95_ms: Number((grab.stages[key].p95 - rep.stages[key].p95).toFixed(2)),
      reposo_p99: rep.stages[key].p99,
      grabando_p99: grab.stages[key].p99,
      reposo_max: rep.stages[key].max,
      grabando_max: grab.stages[key].max,
    });

    return {
      reportType: 'expresat_dev_instrumentation_comparison',
      generatedAt: new Date().toISOString(),
      rvfcSupported: snap.rvfcSupported,
      runtimeConfig: snap.runtimeConfig,
      cameraNegotiation: snap.cameraNegotiation,
      liveLastSecond: snap.live,
      phases: snap.phases,
      comparison_reposo_vs_grabando: {
        avgRealCameraFps: {
          reposo: rep.counts.avgRealCameraFps,
          grabando: grab.counts.avgRealCameraFps,
        },
        avgInferenceFps: {
          reposo: rep.counts.avgInferenceFps,
          grabando: grab.counts.avgInferenceFps,
        },
        avgUniqueInferredFps: {
          reposo: rep.counts.avgUniqueInferredFps,
          grabando: grab.counts.avgUniqueInferredFps,
        },
        duplicateRatioPct: {
          reposo: rep.counts.duplicateRatioPct,
          grabando: grab.counts.duplicateRatioPct,
        },
        handMs: deltaStage('handMs'),
        poseInvokedMs: deltaStage('poseInvokedMs'),
        dibujoMs: deltaStage('dibujoMs'),
        uiDispatchMs: deltaStage('uiDispatchMs'),
        uiCommitMs: deltaStage('uiCommitMs'),
        totalFrameMs: deltaStage('totalFrameMs'),
        frameWaitForNewCameraMs: deltaStage('frameWaitForNewCameraMs'),
        tickWaitMs: deltaStage('tickWaitMs'),
      },
    };
  }
}

export function formatReportMarkdown(report) {
  if (!report) return '';
  const rep = report.phases?.reposo;
  const grab = report.phases?.grabando;
  const cfg = report.runtimeConfig || {};
  const cam = report.cameraNegotiation || {};
  const settings = cam.settings || {};

  const fmtStage = (label, key) => {
    const r = rep?.stages?.[key] || {};
    const g = grab?.stages?.[key] || {};
    return `| ${label} | ${r.p50 ?? 0} / ${r.p95 ?? 0} / ${r.p99 ?? 0} / ${r.max ?? 0} | ${g.p50 ?? 0} / ${g.p95 ?? 0} / ${g.p99 ?? 0} / ${g.max ?? 0} |`;
  };

  return [
    `# Informe de Instrumentación Dev — Reposo vs Grabando`,
    `- **Generado:** ${report.generatedAt}`,
    `- **Configuración:** targetFps=${cfg.targetFps ?? '—'} (frameInterval=${cfg.frameIntervalMs ?? '—'} ms), delegate=${cfg.delegate ?? '—'}, enablePose=${cfg.enablePose ?? '—'}, poseCadence=${cfg.poseCadence ?? '—'}, crossOriginIsolated=${cfg.crossOriginIsolated ?? '—'}`,
    `- **Experimento cámara:** \`${cam.experimentMode ?? 'default'}\` (fallback=${cam.usedFallback ?? false}${cam.error ? `, error=${cam.error.name}: ${cam.error.constraint || cam.error.message}` : ''})`,
    `- **getUserMedia getSettings():** ${settings.width ?? '—'}x${settings.height ?? '—'} @ ${settings.frameRate ?? '—'} fps (aspectRatio=${settings.aspectRatio ?? '—'}, label="${cam.trackLabel ?? '—'}")`,
    `- **videoElement:** ${cam.videoWidth ?? '—'}x${cam.videoHeight ?? '—'} | rVFC soportado: ${report.rvfcSupported}`,
    ``,
    `## Conteos: Cámara Única vs Inferencias`,
    `| Métrica | Reposo (${rep?.durationSec ?? 0}s) | Grabando (${grab?.durationSec ?? 0}s) |`,
    `|---|---|---|`,
    `| Frames únicos cámara (rVFC) | ${rep?.counts?.uniqueCameraFrames ?? 0} (${rep?.counts?.avgRealCameraFps ?? 0} FPS) | ${grab?.counts?.uniqueCameraFrames ?? 0} (${grab?.counts?.avgRealCameraFps ?? 0} FPS) |`,
    `| Frames vistos por loop \`_tick\` | ${rep?.counts?.loopObservedCameraFrames ?? 0} | ${grab?.counts?.loopObservedCameraFrames ?? 0} |`,
    `| Inferencias totales | ${rep?.counts?.totalInferences ?? 0} (${rep?.counts?.avgInferenceFps ?? 0} FPS) | ${grab?.counts?.totalInferences ?? 0} (${grab?.counts?.avgInferenceFps ?? 0} FPS) |`,
    `| Inferencias únicas | ${rep?.counts?.uniqueInferredFrames ?? 0} (${rep?.counts?.avgUniqueInferredFps ?? 0} FPS) | ${grab?.counts?.uniqueInferredFrames ?? 0} (${grab?.counts?.avgUniqueInferredFps ?? 0} FPS) |`,
    `| Inferencias duplicadas | ${rep?.counts?.duplicateInferences ?? 0} (${rep?.counts?.duplicateRatioPct ?? 0}%) | ${grab?.counts?.duplicateInferences ?? 0} (${grab?.counts?.duplicateRatioPct ?? 0}%) |`,
    `| Frames cámara saltados | ${rep?.counts?.skippedCameraFramesAtInference ?? 0} | ${grab?.counts?.skippedCameraFramesAtInference ?? 0} |`,
    ``,
    `## Latencias por Etapa (ms: p50 / p95 / p99 / máx)`,
    `| Etapa / Espera | Reposo | Grabando |`,
    `|---|---|---|`,
    fmtStage('Espera inter-frame cámara (rVFC)', 'cameraInterFrameMs'),
    fmtStage('Espera de frame nuevo', 'frameWaitForNewCameraMs'),
    fmtStage('Espera fuera de inferencia (tickWait)', 'tickWaitMs'),
    fmtStage('Edad del frame al inferir (rVFC)', 'frameAgeSinceRvfcMs'),
    fmtStage('hand (HandLandmarker)', 'handMs'),
    fmtStage('pose (PoseLandmarker)', 'poseInvokedMs'),
    fmtStage('dibujo (tracker + canvas)', 'dibujoMs'),
    fmtStage('UI dispatch (onFrame + setState)', 'uiDispatchMs'),
    fmtStage('UI commit (React render + DOM)', 'uiCommitMs'),
    fmtStage('Total _runInferenceStep', 'totalFrameMs'),
  ].join('\n');
}
