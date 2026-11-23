/**
 * React hook integrating SignEngine, Classifier (GeometricClassifier), and optional WSClient.
 *
 * Documentation & Vault References:
 *   - Data Flow Diagram:   `Obsidian_exp/Flujo de datos.md`
 *   - Frontend Code Guide: `Obsidian_exp/Explicacion del codigo/Frontend/Vite_React.md`
 *   - Agent Playbook #5:   `Obsidian_exp/Agentes/02_PLAYBOOKS_POR_TAREA.md`
 *
 * Guarantees (FEATURE_SPEC v1.4.0):
 * - Local Demo Mode runs 100% in-browser (no backend, no PoseLandmarker overhead, zero WS race).
 * - Enables PoseLandmarker whenever neural remote transport, DevRecorder, or explicit pose mode is active.
 * - Active gesture card auto-expires cleanly when the hand lowers or enters rest.
 * - Accumulated history appends strictly on cooldown-gated `committed` rising edges.
 * - Idempotent cleanup under React 19 StrictMode (no leaked camera streams or AbortError).
 * - Separate real FPS counters (`cameraFps` and `inferenceFps`).
 * - Sends unsmoothed `frameData.raw` with real monotonic `t_ms` in a time-bounded window
 *   (>= 12 frames, span >= 933.33 ms) over WebSocket whenever remote transport is enabled.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { SignEngine } from '../engine/index.js';
import { GeometricClassifier, getSignCatalogEntry } from '../recognition/index.js';
import { WSClient, WS_STATES } from '../transport/index.js';
import { AuthService } from '../services/authService.js';
import { LandmarkTracker } from '../services/landmarkTracker.js';
import { CONFIG, getActiveEndpoints } from '../config.js';
import { renderCanvasFrame } from './drawLandmarks.js';

const WS_WINDOW_RETENTION_MS = 1100;
const WS_MIN_SPAN_MS = 1000 * (14 / 15); // 933.333... ms (zero tail extrapolation for v1.4.0)
const WS_MIN_FRAMES = 12;
const WS_MAX_BUFFER_FRAMES = 60;
const TELEMETRY_UI_INTERVAL_MS = 250; // <= 4 Hz UI refresh when telemetry drawer is open
const MAX_HISTORY_ITEMS = 40;

let _historyEntrySeq = 0;

export function resolveEnablePose({
  enablePose = false,
  enableRemoteTransport = false,
  devRecorderActive = false,
  configEnablePose = false,
} = {}) {
  return Boolean(enablePose || enableRemoteTransport || devRecorderActive || configEnablePose);
}

/**
 * Enforces strict 4:3 (±0.05) FEATURE_SPEC v1.4.0 aspect ratio ONLY when remote neural
 * inference or DevRecorder dataset capture is active. Local geometric demo mode accepts
 * any camera geometry (mobile portrait 3:4 / 9:16, square, or desktop 4:3 / 16:9).
 */
export function resolveStrictAspectRatio({
  enableRemoteTransport = false,
  devRecorderActive = false,
  strictAspectRatio,
} = {}) {
  if (typeof strictAspectRatio === 'boolean') return strictAspectRatio;
  return Boolean(enableRemoteTransport || devRecorderActive);
}

/**
 * Synchronizes canvas pixel dimensions with the active video stream's native orientation
 * (e.g. 480x640 on mobile portrait, 640x480 on desktop) so frames and landmarks never stretch.
 */
export function syncCanvasToVideo(canvas, video) {
  if (!canvas || !video) return false;
  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if (vw > 0 && vh > 0 && (canvas.width !== vw || canvas.height !== vh)) {
    canvas.width = vw;
    canvas.height = vh;
    return true;
  }
  return false;
}

/**
 * Determines whether local geometric predictions should update the active gesture state.
 * Prevents local-vs-remote overwrite races whenever WebSocket neural transport is OPEN.
 */
export function shouldApplyLocalPrediction({
  enableRemoteTransport = false,
  wsState = WS_STATES.IDLE,
} = {}) {
  return !(enableRemoteTransport && wsState === WS_STATES.OPEN);
}

/**
 * Build a raw unsmoothed frame for backend WebSocket inference (`FEATURE_SPEC v1.4.0`).
 * Preserves real monotonic `t_ms`, raw `pose`/`hands`/`handedness`, and direct `leftHand`/`rightHand`.
 */
export function buildWsInferenceFrame(frameData) {
  const raw = frameData?.raw || frameData;
  const tMs =
    typeof frameData?.timestamp === 'number' && Number.isFinite(frameData.timestamp)
      ? frameData.timestamp
      : performance.now();

  return {
    t_ms: tMs,
    pose: raw?.pose ?? null,
    hands: Array.isArray(raw?.hands) ? raw.hands : [],
    handedness: Array.isArray(raw?.handedness) ? raw.handedness : [],
    leftHand: raw?.leftHand ?? null,
    rightHand: raw?.rightHand ?? null,
  };
}

/**
 * Append a raw frame to the rolling WebSocket window buffer and prune stale entries.
 * Returns `{ ready, spanMs }` indicating whether the buffer satisfies v1.4.0 window coverage.
 */
export function updateWsRollingBuffer(
  buffer,
  frameData,
  windowRetentionMs = WS_WINDOW_RETENTION_MS,
  maxFrames = WS_MAX_BUFFER_FRAMES
) {
  const entry = buildWsInferenceFrame(frameData);
  buffer.push(entry);

  const latestTs = entry.t_ms;
  while (
    buffer.length > WS_MIN_FRAMES &&
    latestTs - buffer[0].t_ms > windowRetentionMs
  ) {
    buffer.shift();
  }
  while (buffer.length > maxFrames) {
    buffer.shift();
  }

  const spanMs = buffer.length >= 2 ? buffer[buffer.length - 1].t_ms - buffer[0].t_ms : 0;
  const ready = buffer.length >= WS_MIN_FRAMES && spanMs >= WS_MIN_SPAN_MS;
  return { ready, spanMs };
}

function isSameRenderedGesture(prev, next) {
  if (!prev || !next) return false;
  if (
    prev.label !== next.label ||
    prev.source !== next.source ||
    prev.state !== next.state ||
    prev.details?.handId !== next.details?.handId ||
    prev.details?.rawLabel !== next.details?.rawLabel ||
    prev.details?.reason !== next.details?.reason ||
    Math.round((prev.confidence || 0) * 20) !== Math.round((next.confidence || 0) * 20)
  ) {
    return false;
  }
  const prevStates = prev.details?.states;
  const nextStates = next.details?.states;
  if (Boolean(prevStates) !== Boolean(nextStates)) return false;
  if (prevStates && nextStates) {
    if (
      prevStates.thumb !== nextStates.thumb ||
      prevStates.index !== nextStates.index ||
      prevStates.middle !== nextStates.middle ||
      prevStates.ring !== nextStates.ring ||
      prevStates.pinky !== nextStates.pinky ||
      prevStates.palmFacing !== nextStates.palmFacing ||
      prevStates.isPinching !== nextStates.isPinching
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Pure reducer applying a classifier prediction to the active gesture UI state.
 * Auto-expires `label` and `confidence` when `prediction.label === null`.
 */
export function applyGesturePrediction(prev, prediction, source = 'local') {
  const hasLabel = Boolean(prediction?.label);
  const next = {
    label: hasLabel ? prediction.label : null,
    confidence: hasLabel ? (prediction.confidence ?? 0) : 0,
    source,
    state: prediction?.state || (hasLabel ? 'confirmed' : 'idle'),
    details: prediction?.details ?? null,
  };
  return isSameRenderedGesture(prev, next) ? prev : next;
}

/**
 * Pure reducer appending a newly committed sign (rising edge after cooldown) to the sentence history.
 */
export function appendCommittedSign(prevHistory, prediction, maxItems = MAX_HISTORY_ITEMS) {
  if (!prediction?.committed || !prediction?.committedLabel) {
    return prevHistory;
  }
  const label = prediction.committedLabel;
  const catalogEntry = getSignCatalogEntry(label);
  const entry = {
    id: `sign_${++_historyEntrySeq}_${Date.now()}`,
    label,
    speakText: catalogEntry?.speakText || label,
    confidence: prediction.confidence ?? 0,
    timestamp: Date.now(),
  };
  const next = [...prevHistory, entry];
  return next.length > maxItems ? next.slice(next.length - maxItems) : next;
}

export function useSignEngine({
  videoRef,
  canvasRef,
  trackingConfig = { enabled: true },
  classifierInstance = null,
  enableRemoteTransport = false,
  enablePose = false,
  devRecorderActive = false,
  telemetryDrawerOpen = false,
  showDiagnosticBadges = false,
  onSignCommitted = null,
  onPrediction = null,
} = {}) {
  const [fps, setFps] = useState({ cameraFps: 0, inferenceFps: 0 });
  const [engineStatus, setEngineStatus] = useState({
    state: 'starting',
    wasmReady: false,
    cameraReady: false,
    backendInfo: null,
  });
  const [engineError, setEngineError] = useState(null);

  const [gesture, setGesture] = useState({
    label: null,
    confidence: 0,
    source: 'local', // 'local' | 'remote'
    state: 'idle', // 'idle' | 'detecting' | 'confirmed' | 'rejected'
    details: null,
  });

  const [history, setHistory] = useState([]);

  const [wsSnapshot, setWsSnapshot] = useState({
    state: WS_STATES.IDLE,
    detail: 'Modo Demo Local 100% en navegador (sin backend)',
    retryCount: 0,
    serverDemoMode: null,
    latencyMs: 0,
    url: getActiveEndpoints().wsUrl,
  });

  const [landmarksCount, setLandmarksCount] = useState(0);
  const [telemetry, setTelemetry] = useState(null);
  const [devSnapshot, setDevSnapshot] = useState(null);

  const engineRef = useRef(null);
  const classifierRef = useRef(null);
  const wsClientRef = useRef(null);
  const trackerRef = useRef(null);
  const latestFrameRef = useRef(null);
  const trackingConfigRef = useRef(trackingConfig);
  const telemetryDrawerOpenRef = useRef(Boolean(telemetryDrawerOpen));
  const showDiagnosticBadgesRef = useRef(Boolean(showDiagnosticBadges));
  const enableRemoteTransportRef = useRef(Boolean(enableRemoteTransport));
  const onSignCommittedRef = useRef(onSignCommitted);
  const onPredictionRef = useRef(onPrediction);
  const lastLandmarksCountRef = useRef(0);
  const lastTelemetryUiMsRef = useRef(0);
  const wsBatchBufferRef = useRef([]);
  const lastWsSendTimeRef = useRef(0);

  useEffect(() => {
    trackingConfigRef.current = trackingConfig;
  }, [trackingConfig]);

  useEffect(() => {
    showDiagnosticBadgesRef.current = Boolean(showDiagnosticBadges);
  }, [showDiagnosticBadges]);

  useEffect(() => {
    enableRemoteTransportRef.current = Boolean(enableRemoteTransport);
  }, [enableRemoteTransport]);

  useEffect(() => {
    onSignCommittedRef.current = onSignCommitted;
  }, [onSignCommitted]);

  useEffect(() => {
    onPredictionRef.current = onPrediction;
  }, [onPrediction]);

  useEffect(() => {
    telemetryDrawerOpenRef.current = Boolean(telemetryDrawerOpen);
    if (!telemetryDrawerOpen) {
      setTelemetry(null);
    } else if (trackerRef.current?.lastTelemetry) {
      setTelemetry(trackerRef.current.lastTelemetry);
    }
  }, [telemetryDrawerOpen]);

  // 1. Initialize optional WebSocket transport (disabled by default in 100% Local Demo Mode)
  useEffect(() => {
    if (!enableRemoteTransport) {
      wsClientRef.current = null;
      setWsSnapshot((prev) =>
        prev.state === WS_STATES.IDLE
          ? prev
          : {
              ...prev,
              state: WS_STATES.IDLE,
              detail: 'Modo Demo Local 100% en navegador (sin backend)',
            }
      );
      return undefined;
    }

    let isMounted = true;
    const wsBatchBuffer = wsBatchBufferRef.current;
    const authService = new AuthService();
    const endpoints = getActiveEndpoints();
    const wsClient = new WSClient({ url: endpoints.wsUrl });
    wsClientRef.current = wsClient;

    const unsubState = wsClient.onStateChange((snap) => {
      if (isMounted) {
        setWsSnapshot(snap);
        if (snap.state !== WS_STATES.OPEN) {
          wsBatchBufferRef.current.length = 0;
        }
      }
    });

    const unsubMsg = wsClient.onMessage((msg) => {
      if (!isMounted || !msg || typeof msg !== 'object') return;
      if (msg.type === 'translation' && msg.payload?.label) {
        setGesture((prev) => ({
          label: msg.payload.label,
          confidence: msg.payload.confidence ?? prev.confidence,
          source: 'remote',
          state: 'confirmed',
          details: {
            ...prev.details,
            remoteDebug: msg.payload.debug || null,
          },
        }));
      } else if (msg.type === 'telemetry' && msg.payload?.debug) {
        setGesture((prev) => ({
          ...prev,
          details: {
            ...prev.details,
            remoteDebug: msg.payload.debug,
          },
        }));
      }
    });

    const connectWithCurrentEnv = async (envOverride = null) => {
      const active = getActiveEndpoints(envOverride);
      let token = null;
      try {
        token = await authService.getAccessToken();
      } catch (err) {
        console.warn('[useSignEngine] No se pudo obtener token de sesión:', err.message);
      }
      if (!token && typeof window !== 'undefined' && window.localStorage) {
        try {
          const legacyToken = window.localStorage.getItem('supabaseToken');
          if (
            legacyToken &&
            legacyToken !== 'demo_fallback_token' &&
            legacyToken !== 'mock_token'
          ) {
            token = legacyToken;
          }
        } catch (storageErr) {
          console.warn('[useSignEngine] Error leyendo localStorage:', storageErr.message);
        }
      }
      if (isMounted) {
        wsClient.connect({ token, url: active.wsUrl });
      }
    };

    connectWithCurrentEnv();

    const handleEnvChanged = (event) => {
      const newEnv = event?.detail;
      connectWithCurrentEnv(newEnv);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('environment-changed', handleEnvChanged);
    }

    return () => {
      isMounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('environment-changed', handleEnvChanged);
      }
      unsubState();
      unsubMsg();
      wsClient.disconnect();
      wsClientRef.current = null;
      wsBatchBuffer.length = 0;
    };
  }, [enableRemoteTransport]);

  // 2. Initialize SignEngine (camera + main-thread MediaPipe) and GeometricClassifier
  const resolvedEnablePose = resolveEnablePose({
    enablePose,
    enableRemoteTransport,
    devRecorderActive,
    configEnablePose: CONFIG.enablePose,
  });

  const resolvedStrictAspectRatio = resolveStrictAspectRatio({
    enableRemoteTransport,
    devRecorderActive,
  });

  const demoLocalTolerant = !enableRemoteTransport && !devRecorderActive && !resolvedEnablePose;

  useEffect(() => {
    const videoEl = videoRef?.current;
    if (!videoEl) return undefined;

    let isMounted = true;
    const classifier =
      classifierInstance ||
      new GeometricClassifier({
        windowMs: 450,
        minStableMs: 260,
        enterRatio: 0.55,
        exitRatio: 0.3,
        releaseMs: 360,
        waveWindowMs: 900,
        waveGapResetMs: 250,
        waveIdleTailMs: 280,
        sameSignCooldownMs: 1200,
        switchCooldownMs: 300,
        restResetMs: 400,
      });
    classifierRef.current = classifier;

    const tracker = new LandmarkTracker();
    trackerRef.current = tracker;

    const engine = new SignEngine({
      targetFps: CONFIG.targetFps,
      enablePose: resolvedEnablePose,
      strictAspectRatio: resolvedStrictAspectRatio,
      demoLocalTolerant,
      modelComplexity: CONFIG.modelComplexity,
      backend: CONFIG.mediapipeBackend,
    });
    engineRef.current = engine;

    const unsubStatus = engine.onStatus((st) => {
      if (isMounted) {
        setEngineStatus(st);
        if (import.meta.env.DEV && st?.state === 'running') {
          setDevSnapshot(engine.getDevSnapshot());
        }
      }
    });

    const unsubError = engine.onError((errObj) => {
      if (isMounted) {
        setEngineError(errObj);
        if (import.meta.env.DEV) {
          setDevSnapshot(engine.getDevSnapshot());
        }
      }
    });

    const unsubFps = engine.onFps((fpsMetrics) => {
      if (isMounted) {
        setFps(fpsMetrics);
      }
    });

    const unsubDevSnapshot = import.meta.env.DEV
      ? engine.onDevSnapshot((snap) => {
          if (isMounted && snap && snap.phase !== 'grabando') {
            setDevSnapshot(snap);
          }
        })
      : () => {};

    const devTel = import.meta.env.DEV ? engine._devTelemetry : null;

    const unsubFrame = engine.onFrame((frameData) => {
      if (!isMounted) return;
      latestFrameRef.current = frameData;

      if (import.meta.env.DEV) devTel?.mark('expresat:ui_dispatch:start');
      let handPts = 0;
      const handsArr = frameData.hands;
      if (Array.isArray(handsArr)) {
        for (let i = 0; i < handsArr.length; i++) {
          if (Array.isArray(handsArr[i])) handPts += handsArr[i].length;
        }
      }
      const posePts = Array.isArray(frameData.pose) ? frameData.pose.length : 0;
      const totalPts = handPts + posePts;
      if (totalPts !== lastLandmarksCountRef.current) {
        lastLandmarksCountRef.current = totalPts;
        setLandmarksCount(totalPts);
      }
      if (import.meta.env.DEV && devTel) {
        const countSetMs = devTel.endAndMeasure(
          'expresat:stage:ui_dispatch:count',
          'expresat:ui_dispatch:start',
          'expresat:ui_dispatch:count_end'
        );
        if (countSetMs !== null && countSetMs !== undefined) {
          devTel.recordStageDuration('ui_dispatch', countSetMs);
        }
      }

      if (canvasRef?.current && videoRef?.current) {
        syncCanvasToVideo(canvasRef.current, videoRef.current);
      }

      if (trackingConfigRef.current?.enabled && canvasRef?.current) {
        const drawerOpen = telemetryDrawerOpenRef.current;
        const showTrails = Boolean(trackingConfigRef.current?.showTrails);
        if (import.meta.env.DEV) devTel?.mark('expresat:tracker:start');
        const snap = tracker.update(
          frameData,
          canvasRef.current.width,
          canvasRef.current.height,
          {
            includeTelemetry: drawerOpen,
            trackHistory: showTrails,
          }
        );
        if (import.meta.env.DEV && devTel) {
          const trackerMs = devTel.endAndMeasure(
            'expresat:stage:tracker',
            'expresat:tracker:start',
            'expresat:tracker:end'
          );
          if (trackerMs !== null && trackerMs !== undefined) {
            devTel.recordStageDuration('tracker', trackerMs);
          }
          devTel.mark('expresat:ui_telemetry:start');
        }
        if (drawerOpen) {
          const nowUi = performance.now();
          if (nowUi - lastTelemetryUiMsRef.current >= TELEMETRY_UI_INTERVAL_MS) {
            lastTelemetryUiMsRef.current = nowUi;
            setTelemetry(snap);
          }
        }
        if (import.meta.env.DEV && devTel) {
          const telSetMs = devTel.endAndMeasure(
            'expresat:stage:ui_dispatch:telemetry',
            'expresat:ui_telemetry:start',
            'expresat:ui_telemetry:end'
          );
          if (telSetMs !== null && telSetMs !== undefined) {
            devTel.recordStageDuration('ui_dispatch', telSetMs);
          }
        }
      }

      // Render video frame and landmarks onto the Canvas
      if (canvasRef?.current && videoRef?.current) {
        if (import.meta.env.DEV) devTel?.mark('expresat:dibujo:start');
        renderCanvasFrame({
          canvas: canvasRef.current,
          video: videoRef.current,
          frameData,
          tracker,
          trackingConfig: trackingConfigRef.current,
          showDiagnosticBadges: showDiagnosticBadgesRef.current,
        });
        if (import.meta.env.DEV && devTel) {
          const canvasMs = devTel.endAndMeasure(
            'expresat:stage:dibujo',
            'expresat:dibujo:start',
            'expresat:dibujo:end'
          );
          if (canvasMs !== null && canvasMs !== undefined) {
            devTel.recordStageDuration('canvas', canvasMs);
          }
        }
      }

      // Local geometric classification (suppressed while an active remote WS session owns predictions)
      const wsState = wsClientRef.current?.state ?? WS_STATES.IDLE;
      if (
        shouldApplyLocalPrediction({
          enableRemoteTransport: enableRemoteTransportRef.current,
          wsState,
        })
      ) {
        if (import.meta.env.DEV) devTel?.mark('expresat:ui_gesture:start');
        const localPrediction = classifier.predict(frameData);
        setGesture((prev) => applyGesturePrediction(prev, localPrediction, 'local'));

        if (typeof onPredictionRef.current === 'function') {
          try {
            onPredictionRef.current(localPrediction, frameData);
          } catch (predErr) {
            console.warn('[useSignEngine] Error en onPrediction:', predErr);
          }
        }

        if (localPrediction.committed && localPrediction.committedLabel) {
          const catalogEntry = getSignCatalogEntry(localPrediction.committedLabel);
          const committedPayload = {
            label: localPrediction.committedLabel,
            speakText: catalogEntry?.speakText || localPrediction.committedLabel,
            confidence: localPrediction.confidence ?? 0,
            handId: localPrediction.details?.handId || null,
            timestamp: frameData?.timestamp ?? performance.now(),
          };
          setHistory((prev) => appendCommittedSign(prev, localPrediction));
          if (typeof onSignCommittedRef.current === 'function') {
            try {
              onSignCommittedRef.current(committedPayload);
            } catch (cbErr) {
              console.warn('[useSignEngine] Error en onSignCommitted:', cbErr);
            }
          }
        }

        if (import.meta.env.DEV && devTel) {
          const gestureUiMs = devTel.endAndMeasure(
            'expresat:stage:ui_dispatch',
            'expresat:ui_gesture:start',
            'expresat:ui_gesture:end'
          );
          if (gestureUiMs !== null && gestureUiMs !== undefined) {
            devTel.recordStageDuration('ui_dispatch', gestureUiMs);
          }
        }
      }

      // Buffer unsmoothed raw frames with real monotonic `t_ms` only when WS is OPEN
      if (
        enableRemoteTransportRef.current &&
        wsClientRef.current &&
        wsClientRef.current.state === WS_STATES.OPEN
      ) {
        const { ready } = updateWsRollingBuffer(wsBatchBufferRef.current, frameData);
        const now = performance.now();
        if (ready && now - lastWsSendTimeRef.current >= 500) {
          lastWsSendTimeRef.current = now;
          wsClientRef.current.sendLandmarks(wsBatchBufferRef.current.slice());
        }
      }
    });

    engine.start(videoEl);

    return () => {
      isMounted = false;
      unsubStatus();
      unsubError();
      unsubFps();
      unsubDevSnapshot();
      unsubFrame();
      engine.stop();
      classifier.reset();
      tracker.reset();
      engineRef.current = null;
    };
  }, [
    videoRef,
    canvasRef,
    classifierInstance,
    resolvedEnablePose,
    resolvedStrictAspectRatio,
    demoLocalTolerant,
  ]);

  const reconnectTransport = useCallback(() => {
    if (wsClientRef.current) {
      const active = getActiveEndpoints();
      wsClientRef.current.connect({ url: active.wsUrl });
    }
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const clearGesture = useCallback(() => {
    classifierRef.current?.reset();
    setGesture({
      label: null,
      confidence: 0,
      source: 'local',
      state: 'idle',
      details: null,
    });
    setHistory([]);
  }, []);

  const refreshDevSnapshot = useCallback(() => {
    if (import.meta.env.DEV && engineRef.current) {
      setDevSnapshot(engineRef.current.getDevSnapshot());
    }
  }, []);

  return {
    fps,
    engineStatus,
    engineError,
    gesture,
    history,
    wsSnapshot,
    landmarksCount,
    telemetry,
    devSnapshot,
    refreshDevSnapshot,
    reconnectTransport,
    clearHistory,
    clearGesture,
    engineRef,
  };
}

export default useSignEngine;
