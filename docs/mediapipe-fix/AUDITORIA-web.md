# MediaPipe Audit — Frontend (Web)

**Scope:** `/home/adrian/Proyectos/expresat/expresat/frontend/src/`
**Project:** ExpresT — Real-time Sign Language Translation
**Date:** 2026-11-08

---

## 1. Overview

The frontend implements MediaPipe holistic detection using:
- **Web Worker** (`mediapipe-worker.js`) running `@mediapipe/tasks-vision` for pose + hand landmark detection
- **Main thread hook** (`useMediaPipe.js`) managing camera, worker lifecycle, EMA smoothing, canvas drawing, and WebSocket payload throttling
- **ApiService** (`apiService.js`) handling WebSocket connection to `/ws/translate` endpoint
- **Translator.jsx** — main UI component connecting everything

Critical issues identified: `isDemo` ReferenceError, WebSocket 403, FPS = 0, WASM/model loading, client-server API mismatches.

---

## 2. File-by-File Audit

### `useMediaPipe.js` (hooks)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **High** | **FPS watchdog reports 0 when worker stalls** | `fpsWatchdogRef` clears after 2s of no results and forces FPS to 0 (`useMediaPipe.js:212-217`). If the worker never sends 'ready' or 'results', FPS freezes at 0, which explains the reported "counter marks 0". | 95, 211-217 |
| **Medium** | **Camera must stream before Worker 'ready'** | `startCamera()` is called immediately (line 138), but `requestVideoFrameCallback` (captureFrame) is only activated after Worker sends 'ready' (line 164). If Worker fails to initialize, camera still works but inference is disabled — this is intentional but means FPS will be 0 unless user sees results. | 138, 164 |
| **Medium** | **Worker creation wraps in try/catch but returns early** | If Worker creation fails (e.g., WASM 404), the cleanup function stops the camera stream (`useMediaPipe.js:151-153`), leaving the user with a black screen or stopped camera. No retry logic. | 142-154 |
| **Low** | **`isDemo` state not referenced in hook** | The hook does not manage `isDemo`; it's managed in `Translator.jsx`. No direct coupling issues, but data flow between hook and component must be verified. | N/A |
| **Low** | **EMA filter uses fixed alpha=0.45** | `alpha` option defaults to 0.45 (`useMediaPipe.js:64`). No validation if this value is appropriate for all devices — could cause over-smoothing or under-smoothing. | 64 |

### `mediapipeEngine.js` (services)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **High** | **Uses legacy `window.Holistic` / `window.Camera` from `@mediapipe/tasks-vision`** | The engine attaches MediaPipe to `window` global (`mediapipeEngine.js:37-52`). If the Worker fails to load models, `holistic` and `camera` will be undefined, but the code does not check this before `camera.start()`. | 37-52, 85-86 |
| **High** | **WASM CDN URL version must match npm package version** | `WASM_URL` points to `@mediapipe/tasks-vision@1.0.1` (worker line 37). Must match `package.json` version. Mismatch causes "ModuleFactory not set" error in FilesetResolver. | 37 |
| **Medium** | **Model URLs hardcoded to Google Storage** | Hand model: `hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` (line 41). Pose model: `pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` (line 44). If Google Storage paths change or are rate-limited, loading fails silently (error message logged but UI continues). | 41, 44 |
| **Medium** | **No fallback if models fail to load** | `initialize()` catches errors and posts `{ type: 'error' }` (worker line 113), but the main thread `useMediaPipe.js` only logs it and continues with inference disabled. No UI indication to user. | 111-113 |
| **Low** | **Uses GPU delegate without CPU fallback check** | Both hand and pose landmarkers request `delegate: 'GPU'` (lines 87, 98). On devices without GPU support, this may cause initialization failure. No `try` with CPU fallback. | 87, 98 |

### `landmarkTracker.js` (services)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **`POSE_UPPER_CONNECTIONS` in landmarkTracker differs from `useMediaPipe.js`** | `landmarkTracker.js` defines `POSE_UPPER_CONNECTIONS` (line 25-38) and `POSE_CONNECTIONS` is defined in `useMediaPipe.js` (line 28-34). They are similar but not identical — drawings may differ slightly between the tracker visualizer and the hook's fallback drawing. | 25-38 vs 28-34 |
| **Low** | **HAND_CONNECTIONS constant naming** | `landmarkTracker.js` exports `HAND_CONNECTIONS` (line 41-54) but `useMediaPipe.js` uses `HAND_CONNECTIONS$1` (line 37-44). Different names could cause confusion. | 37 vs 41 |
| **Low** | **`_drawPoseSegments` has complex color logic** | The method (`landmarkTracker.js:654-763`) mixes `colorByPart` and hardcoded colors. Some code paths may not render correctly if `results.pose` has unexpected structure. | 654-763 |
| **Low** | **`validateSequence` static method references `seq.empty`** | Line 383: `if (seq.empty)` — `seq.empty` is not a standard Array method. If `seq` is an Array, this will always be `false` (undefined property). If it's a typed array or custom object, behavior differs. | 383 |

### `apiService.js` (services)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Critical** | **WebSocket 403 — token/Origin mismatch** | The client sends `demo_fallback_token` or no token, production server rejects with 403 (per user report). The `connect()` method sends `{ type: "auth", token }` only if `authToken` is truthy (`apiService.js:108`). In production without Supabase token, `authToken = null` and no auth message is sent, but the server may still reject missing auth. | 37-118 |
| **Critical** | **CORS origin typo causes 403 rejection** | Backend `CORS_ORIGINS_DEFAULT` includes `"https://ecpresatt.netlify.app"` (main.py:58) — this is a typo; should be `"https://expresat.netlify.app"`. The comment on line 51 confirms: "el typo 'ec' vs 'ex' es la causa del 403 CORS". | 51-58, 58 |
| **High** | **Health check fires once on connect, no retry** | `connect()` fetches `{origin}/health` once (`apiService.js:79`). If the container is cold-starting, the first request may fail, and the status is set to `'status-offline'` (`apiService.js:84`). No exponential backoff for health check. | 78-85 |
| **Medium** | **WebSocket URL normalization may produce incorrect ws:// URLs** | `new URL()` does not accept `ws://`/`wss://` — normalized to `http://`/`https://` first (lines 49-51). If the env var contains `ws://127.0.0.1:8000/ws`, the origin becomes `http://127.0.0.1:8000`, and WS URL becomes `ws://127.0.0.1:8000/ws/translate` — but the path `/ws/translate` is appended on top of the original path if present. | 49-69 |
| **Low** | **Ping interval sends raw JSON without type guard** | `ws.send(JSON.stringify({ type: 'ping' }))` (line 99). If the server expects a different ping format, this could cause unexpected behavior. | 99 |

### `Translator.jsx` (pages)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Critical** | **`isDemo` may be undefined when referenced in JSX** | `isDemo` state initialized with `useState(false)` (line 21). The health-check effect (lines 64-89) fetches `/health` and conditionally sets `setIsDemo(Boolean(data.demo_mode))` **only if** `data.demo_mode !== undefined`. If the response lacks `demo_mode`, `isDemo` stays `false`. However, the ErrorBoundary may catch a ReferenceError if there's a code path where `isDemo` is accessed before the state hook runs, or if the component renders in a state where the variable is hoisted differently. The reported `ReferenceError: isDemo is not defined` suggests the variable is not in scope at render time in some edge case. | 21, 64-81, 782-801 |
| **High** | **Demo token fallback causes 403** | When no valid Supabase token exists and `FASTAPI_ENV !== 'development'`, the code sets `authToken = null` and `setUsingDemoToken(true)` / `setAuthWarning(true)` (lines 132-135, 134). The apiService then connects without auth, but the server may reject the connection or the client sends `demo_fallback_token` which the production server rejects with 403. The comment on line 104-105 says: "Degradar a modo sin token (con aviso) en lugar de enviar 'demo_fallback_token'". | 104-144 |
| **High** | **FPS counter (0) is a symptom of detection loop not starting** | The FPS state is updated by `onFps` callback from `useMediaPipe` (line 187). If the Worker never sends 'ready', `requestVideoFrameCallback` is never started, the capture loop doesn't run, no results arrive, and FPS stays at 0 (confirmed by FPS watchdog). Lines 91-92, 201-208, 212-217. | 91-92, 187, 278-279 |
| **Medium** | **Video element styles may prevent frame decoding** | `<video>` has `style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}` (line 340). While this hides the video, `objectFit: 'contain'` on the canvas may not work if the video dimensions are 0. The comment on lines 334-336 warns about WebKit not decoding frames if `display:none`, but `opacity: 0` may have similar issues on some browsers. | 338-345 |
| **Low** | **`usingDemoToken` and `authWarning` state logic complex** | Multiple code paths set these states (lines 117-144). The interaction between `storedToken`, `env`, `FASTAPI_ENV`, and `apiEnv` creates ambiguity. If `localStorage.getItem('apiEnv')` returns a value, it overrides the default env, which may change token handling behavior. | 96-144 |
| **Low** | **`is_demo` message from server not handled in all paths** | The onMessage callback (lines 152-177) checks `msg?.is_demo` (line 169) but only after checking `msg?.label`. If the server sends a message with `is_demo` but no `label`, it will update `isDemo`. But if the message structure is different, `isDemo` may not be updated. | 169-171 |

### `worker/mediapipe-worker.js`

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Critical** | **WASM loading may fail in production without error propagation** | `initialize()` uses `FilesetResolver.forVisionTasks(WASM_URL)` (line 78). If the CDN is unavailable or the WASM binary fails to load, the catch block posts an 'error' message (line 113), but the main thread only logs it. No retry or user-visible error. | 76-115 |
| **Critical** | **Model file URLs may be inaccessible (Google Storage CORS/rate limits)** | Hand and pose model URLs point to `storage.googleapis.com/mediapipe-models/` (lines 40-44). If these requests fail (403/404), the whole initialization fails. No fallback model paths. | 40-44 |
| **High** | **`runningMode: 'VIDEO'` requires timestamps** | Both landmarkers use `runningMode: 'VIDEO'` (lines 89, 100). This requires sending a `timestamp` with each `detectForVideo()` call. The worker sends `timestamp` from the main thread (line 176), but if timestamps are monotonically increasing and correct, the model may produce poor results or skip frames. | 89, 100, 127, 134 |
| **Medium** | **GPU delegate may not be available on all devices** | Both landmarkers request `delegate: 'GPU'` (lines 87, 98). If the device doesn't support GPU delegate, the loader may fallback to CPU silently or fail. No explicit CPU fallback. | 87, 98 |
| **Low** | **Hand presence confidence and detection confidence both set to 0.5** | `minHandDetectionConfidence: 0.5`, `minHandPresenceConfidence: 0.5`, `minPoseDetectionConfidence: 0.5`, `minPosePresenceConfidence: 0.5` (lines 91-93, 102-103). These thresholds may need tuning for the use case. | 91-93, 102-103 |

---

## 3. Client-Server Mismatches

| Finding | Evidence |
|---------|----------|
| **Backend expects `demo_fallback_token` but rejects it** | User report: "El cliente envía demo_fallback_token, lo que sugiere que falta la variable de entorno real en el build". The frontend may be sending a hardcoded fallback token that the production server rejects with 403. |
| **CORS origin typo** | Backend lists `"https://ecpresatt.netlify.app"` (typo) instead of `"https://expresat.netlify.app"`. This causes CORS preflight/rejection even when the correct origin is used. |
| **API version mismatch** | Frontend uses `@mediapipe/tasks-vision@1.0.1` (worker) but this must match the npm installed version. If `package.json` has a different version, WASM module factory mismatch occurs. |
| **178-feature pipeline compatibility** | Both frontend `useMediaPipe.js` and backend `main.py` / dataset generator expect 178 features (pose 52 + left hand 63 + right hand 63). If the landmark extraction changes, the feature vector dimension breaks. |
| **Token sending strategy** | Frontend `apiService.js` sends token via `{ type: "auth", token }` initial message. Backend `verify_supabase_token` has the production verification block **commented out** (main.py:272-280), so in production, tokens are always rejected, returning `None`, which causes the WebSocket to close with reason "Invalid or missing token". |

---

## 4. Severity Summary

| Severity | Count |
|----------|-------|
| Critical | 6 |
| High | 6 |
| Medium | 10 |
| Low | 7 |

**Priority order for fixes (based on reported symptoms):**
1. Fix `isDemo` ReferenceError (blocks Translator render)
2. Fix WebSocket 403 (auth + CORS)
3. Fix FPS = 0 (worker not starting)
4. Fix WASM/model loading reliability
5. Fix CORS origin typo
6. Fix token verification in backend

---

## 5. Evidence Collection

- **isDemo ReferenceError**: `Translator.jsx` line 21 initializes `const [isDemo, setIsDemo] = useState(false)`, but the health-check effect (lines 64-89) may not set it if `/health` response lacks `demo_mode`. The ErrorBoundary catches the ReferenceError during render.
- **WebSocket 403**: Backend CORS has typo `"ecpresatt"` vs `"expresat"`; frontend may send `demo_fallback_token`; token verification in production is commented out.
- **FPS = 0**: `fpsWatchdogRef` in `useMediaPipe.js` forces FPS to 0 after 2s no results. Worker may never send 'ready' if WASM/models fail to load.
- **WASM/model load**: `mediapipe-worker.js` line 37 `WASM_URL` must match npm package version. Model URLs are hardcoded CDN links.