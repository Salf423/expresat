/**
 * src/ui/useSignEngine.js — Hook React que integra SignEngine, Classifier (GeometricClassifier) y WSClient
 *
 * Garantías:
 * - El tracking y reconocimiento geométrico funcionan 100% en el navegador sin requerir backend ni login.
 * - Cleanup idempotente bajo React 19 StrictMode (sin streams de cámara abiertos ni AbortError).
 * - Contadores separados de FPS reales (`cameraFps` e `inferenceFps`).
 * - Estado explícito del transporte WebSocket (`idle | connecting | open | auth_error | failed`).
 * - Sin `setState` síncrono durante el cuerpo del render.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { SignEngine } from '../engine/index.js';
import { GeometricClassifier } from '../recognition/index.js';
import { WSClient, WS_STATES } from '../transport/index.js';
import { AuthService } from '../services/authService.js';
import { LandmarkTracker } from '../services/landmarkTracker.js';
import { CONFIG, getActiveEndpoints } from '../config.js';
import { renderCanvasFrame } from './drawLandmarks.js';

export function useSignEngine({
  videoRef,
  canvasRef,
  trackingConfig = { enabled: true },
  classifierInstance = null,
  enableRemoteTransport = true,
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
    details: null,
  });

  const [wsSnapshot, setWsSnapshot] = useState({
    state: WS_STATES.IDLE,
    detail: 'Modo Demo en navegador activo (backend opcional)',
    retryCount: 0,
    serverDemoMode: null,
    latencyMs: 0,
    url: getActiveEndpoints().wsUrl,
  });

  const [landmarksCount, setLandmarksCount] = useState(0);
  const [telemetry, setTelemetry] = useState(null);

  const engineRef = useRef(null);
  const classifierRef = useRef(null);
  const wsClientRef = useRef(null);
  const trackerRef = useRef(null);
  const latestFrameRef = useRef(null);
  const trackingConfigRef = useRef(trackingConfig);
  const wsBatchBufferRef = useRef([]);
  const lastWsSendTimeRef = useRef(0);

  useEffect(() => {
    trackingConfigRef.current = trackingConfig;
  }, [trackingConfig]);

  // 1. Inicializar Transporte WebSocket Opcional (desacoplado del motor de visión)
  useEffect(() => {
    if (!enableRemoteTransport) {
      return undefined;
    }

    let isMounted = true;
    const authService = new AuthService();
    const endpoints = getActiveEndpoints();
    const wsClient = new WSClient({ url: endpoints.wsUrl });
    wsClientRef.current = wsClient;

    const unsubState = wsClient.onStateChange((snap) => {
      if (isMounted) {
        setWsSnapshot(snap);
      }
    });

    const unsubMsg = wsClient.onMessage((msg) => {
      if (!isMounted || !msg || typeof msg !== 'object') return;
      if (msg.type === 'translation' && msg.payload?.label) {
        setGesture((prev) => ({
          label: msg.payload.label,
          confidence: msg.payload.confidence ?? prev.confidence,
          source: 'remote',
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
    };
  }, [enableRemoteTransport]);

  // 2. Inicializar SignEngine (cámara + MediaPipe en hilo principal) y GeometricClassifier
  useEffect(() => {
    const videoEl = videoRef?.current;
    if (!videoEl) return undefined;

    let isMounted = true;
    const classifier =
      classifierInstance ||
      new GeometricClassifier({
        bufferSize: 15,
        smoothingWindow: 5,
        minVotes: 3,
      });
    classifierRef.current = classifier;

    const tracker = new LandmarkTracker();
    trackerRef.current = tracker;

    const engine = new SignEngine({
      targetFps: CONFIG.targetFps,
      enablePose: CONFIG.enablePose,
      modelComplexity: CONFIG.modelComplexity,
      backend: CONFIG.mediapipeBackend,
    });
    engineRef.current = engine;

    const unsubStatus = engine.onStatus((st) => {
      if (isMounted) {
        setEngineStatus(st);
      }
    });

    const unsubError = engine.onError((errObj) => {
      if (isMounted) {
        setEngineError(errObj);
      }
    });

    const unsubFps = engine.onFps((fpsMetrics) => {
      if (isMounted) {
        setFps(fpsMetrics);
      }
    });

    const unsubFrame = engine.onFrame((frameData) => {
      if (!isMounted) return;
      latestFrameRef.current = frameData;

      // Contar landmarks detectados (21 por cada mano + 33 si hay pose)
      const handPts = (frameData.hands || []).reduce(
        (acc, h) => acc + (Array.isArray(h) ? h.length : 0),
        0
      );
      const posePts = Array.isArray(frameData.pose) ? frameData.pose.length : 0;
      const totalPts = handPts + posePts;
      setLandmarksCount(totalPts);

      // Actualizar LandmarkTracker si está habilitado
      if (trackingConfigRef.current?.enabled && canvasRef?.current) {
        const snap = tracker.update(
          frameData,
          canvasRef.current.width,
          canvasRef.current.height
        );
        setTelemetry(snap);
      }

      // Renderizar frame y landmarks en el Canvas
      if (canvasRef?.current && videoRef?.current) {
        renderCanvasFrame({
          canvas: canvasRef.current,
          video: videoRef.current,
          frameData,
          tracker,
          trackingConfig: trackingConfigRef.current,
        });
      }

      // Clasificación geométrica local en navegador (100% independiente del backend)
      const localPrediction = classifier.predict(frameData);
      if (localPrediction.label) {
        setGesture({
          label: localPrediction.label,
          confidence: localPrediction.confidence,
          source: 'local',
          details: localPrediction.details,
        });
      } else if (frameData.hands.length === 0) {
        // Actualizar detalles de dedos cuando no hay mano sin borrar la última palabra traducida
        setGesture((prev) => ({
          ...prev,
          details: localPrediction.details,
        }));
      } else {
        setGesture((prev) => ({
          ...prev,
          details: localPrediction.details,
        }));
      }

      // Acumular ventana de 15 frames y enviar opcionalmente por WebSocket si está OPEN
      wsBatchBufferRef.current.push({
        pose: frameData.pose,
        leftHand: frameData.leftHand,
        rightHand: frameData.rightHand,
      });
      if (wsBatchBufferRef.current.length > 15) {
        wsBatchBufferRef.current.shift();
      }

      const now = performance.now();
      if (
        wsClientRef.current &&
        wsClientRef.current.state === WS_STATES.OPEN &&
        wsBatchBufferRef.current.length === 15 &&
        now - lastWsSendTimeRef.current >= 500
      ) {
        lastWsSendTimeRef.current = now;
        wsClientRef.current.sendLandmarks([...wsBatchBufferRef.current]);
      }
    });

    engine.start(videoEl);

    return () => {
      isMounted = false;
      unsubStatus();
      unsubError();
      unsubFps();
      unsubFrame();
      engine.stop();
      classifier.reset();
      tracker.reset();
      engineRef.current = null;
    };
  }, [videoRef, canvasRef, classifierInstance]);

  const reconnectTransport = useCallback(() => {
    if (wsClientRef.current) {
      const active = getActiveEndpoints();
      wsClientRef.current.connect({ url: active.wsUrl });
    }
  }, []);

  const clearGesture = useCallback(() => {
    classifierRef.current?.reset();
    setGesture({
      label: null,
      confidence: 0,
      source: 'local',
      details: null,
    });
  }, []);

  return {
    fps,
    engineStatus,
    engineError,
    gesture,
    wsSnapshot,
    landmarksCount,
    telemetry,
    reconnectTransport,
    clearGesture,
  };
}

export default useSignEngine;
