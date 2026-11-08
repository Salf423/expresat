# MediaPipe Fix Plan — ExpresT

**Created:** 2026-11-08
**Phase:** 0 — Audit Complete (no fixes applied yet)
**Status:** Awaiting user approval before implementation

---

## Overview

This plan consolidates all audit findings across 4 components (Frontend, Backend, Dataset Generator, Native/Desktop) and prioritizes fixes to make the MediaPipe pipeline function end-to-end.

The pipeline flow is:
```
Frontend (camera + MediaPipe Worker) → WebSocket /ws/translate → Backend (inference) → Translation result
                                              ↑                                                          |
                                           178-feature vector <─────── consistent across all components
```

---

## 1. Prioritized Fix Queue

### Priority 1 — Critical (blocks basic functionality)

| # | Component | Issue | Root Cause | Fix | Acceptance Criteria |
|---|-----------|-------|------------|-----|---------------------|
| 1 | Frontend (`Translator.jsx`) | `ReferenceError: isDemo is not defined` | Health-check effect may not set `isDemo` if `/health` response lacks `demo_mode`; ErrorBoundary catches ReferenceError during render | Ensure `isDemo` always has a defined value; add fallback default; make health-check robust to missing `demo_mode` | Translator renders without ErrorBoundary; `isDemo` state is always `true` or `false` (never undefined) |
| 2 | Backend (`main.py`) | Token verification commented out | `verify_supabase_token()` returns `None` for all tokens in production (block commented out, lines 272-280) | Uncomment the production token verification block; add Supabase client initialization | WebSocket `/ws/translate` accepts connections with valid tokens; invalid tokens are rejected with clear error |
| 3 | Backend (`main.py`) | CORS origin typo | `"https://ecpresatt.netlify.app"` should be `"https://expresat.netlify.app"` (line 51-58 comment confirms this causes 403) | Fix the typo in `CORS_ORIGINS_DEFAULT` | Requests from Netlify domain are accepted; no CORS 403 rejections |
| 4 | Frontend (`useMediaPipe.js` + worker) | FPS = 0 — detection loop never starts | Worker fails to initialize (WASM 404, model CDN failure); `fpsWatchdogRef` forces FPS to 0 after 2s; no 'ready' message received | Fix WASM/CDN loading: ensure version match, add fallback, show user-visible error if models fail to load | FPS counter shows >0 when camera has signal; Worker 'ready' message received |

### Priority 2 — High (severely degrades experience)

| # | Component | Issue | Root Cause | Fix | Acceptance Criteria |
|---|-----------|-------|------------|-----|---------------------|
| 5 | Frontend (`apiService.js`) | WebSocket 403 — token/origin mismatch | Combined: (a) CORS typo blocks correct origin, (b) frontend sends no auth token in production (authToken=null), (c) backend rejects all tokens | Fix CORS typo (Priority 3) + implement proper auth flow: either (i) send valid Supabase token, or (ii) in production, connect without token and let server accept, or (iii) use `demo_fallback_token` only in dev mode | WebSocket connects successfully; status shows "Conectado" not "Desconectado" |
| 6 | Frontend (`mediapipeEngine.js`) | No fallback if WASM/models fail to load | `initialize()` catches error but main thread only logs it; inference silently disabled | Add UI indication when MediaPipe is unavailable; retry logic or graceful degradation | User sees clear message if MediaPipe cannot load; camera feed still visible |
| 7 | Dataset generator (`mediapipe_extractor.cpp`) | Real MediaPipe not linked; stub mode always runs | `EXPRESAT_USE_MEDIAPIPE` and `EXPRESAT_STUB_EXTRACTOR` macros not both defined in CMake build | Define the macros in CMakeLists.txt or build config; or confirm stub mode is intentional for now | Build compiles with real MediaPipe enabled OR stub mode is documented as the current state |
| 8 | Native desktop (`inference_thread.cpp`) | `extract_landmarks()` is a stub | TODO comment; returns default-constructed LandmarkFrame without reading camera frame | Replace stub with MediaPipe Tasks C++ API or integrate frontend worker approach; ensure LandmarkFrame populated from camera frames | ONNX receives valid 178-dim feature vectors; inference produces meaningful predictions |

### Priority 3 — Medium (improves robustness/compatibility)

| # | Component | Issue | Root Cause | Fix | Acceptance Criteria |
|---|-----------|-------|------------|-----|---------------------|
| 9 | Frontend (`useMediaPipe.js`) | FPS watchdog forces 0 after 2s stale results | `fpsWatchdogRef` clears FPS and reports 0 if no results for 2s (lines 212-217) | Increase watchdog timeout or make FPS reporting conditional on valid session | FPS counter freezes at last valid value rather than snapping to 0 |
| 10 | Frontend (`apiService.js`) | Health check only once on connect | Single `fetch(healthUrl)` with no retry (lines 78-85) | Add exponential backoff health check or make it periodic | Server cold-start detected; status updates accordingly |
| 11 | All components | 178-feature pipeline drift | Frontend `buildPayload()`, backend `run_inference_async()`, dataset generator `extract()` must all agree on 52+63+63 feature layout | Add version constant or type validation; document the feature vector layout | All components agree on feature dimensions; integration tests pass |
| 12 | Frontend (`mediapipe-worker.js`) | GPU delegate may not be available | Both landmarkers request `delegate: 'GPU'` (lines 87, 98) without CPU fallback | Add `try { GPU } catch { CPU }` or remove GPU delegate for broader compatibility | MediaPipe works on more devices (including those without GPU) |
| 13 | Frontend (`Translator.jsx`) | Complex `usingDemoToken`/`authWarning` state logic | Multiple code paths set these states (lines 117-144); ambiguous interactions | Simplify to: if no token → connect without auth; show clear UI warning; remove `demo_fallback_token` sending | UI state is predictable; no unexpected "Modo demo activo" messages |

### Priority 4 — Low (polish/minor improvements)

| # | Component | Issue | Root Cause | Fix | Acceptance Criteria |
|---|-----------|-------|------------|-----|---------------------|
| 14 | Frontend (`landmarkTracker.js`) | `seq.empty` not standard Array method | `validateSequence()` line 383 uses `seq.empty` which is not a standard Array property | Change to `seq.length === 0` or add type guard | Validation works correctly for Array input |
| 15 | Frontend (`worker/mediapipe-worker.js`) | Model version mismatch risk | `WASM_URL` hardcoded to `@mediapipe/tasks-vision@1.0.1`; must match `package.json` | Extract version from `package.json` or add build-time verification | WASM version always matches npm package version |
| 16 | Dataset generator (`types.h`) | Landmark struct field names may not match MediaPipe C++ API | Need verification against actual MediaPipe C++ API headers | If replacing stub, verify struct field names match (x, y, z, visibility) | Struct compiles and works with real MediaPipe |
| 17 | All components | No runtime mode switch (stub vs real MediaPipe) | Each component compiled/instantiated for one mode | Add feature flag / env var to toggle between stub and real MediaPipe at runtime | Operator can switch modes without rebuild |
| 18 | Frontend (`useMediaPipe.js`) | `requestVideoFrameCallback` not supported on all browsers/devices | May fail on older browsers or devices; no fallback | Add detection of support; fallback to `setInterval`-based capture if rVFC unavailable | Camera works on all supported browsers |

---

## 2. Dependencies Between Fixes

Some fixes are prerequisites for others:

```
[Fix 3: CORS typo] → [Fix 5: WebSocket 403] → [Fix 1: isDemo renders correctly]
         ↓
[Fix 2: Token verification] → [Fix 5: WebSocket 403] → [Fix 1: isDemo renders correctly]
         ↓
[Fix 4: Worker WASM/models] → [Fix 6: No fallback if models fail] → [Fix 3: FPS > 0]
         ↓
[Fix 7: Dataset generator MediaPipe] → [Fix 8: Desktop extract_landmarks] → [Pipeline: 178 features consistent]
         ↓
[Fix 11: 178-feature invariant] → [All inference produces valid results]
```

**Key dependency chains:**
- **Chain A (Auth → WS → Demo UI)**: Fix CORS typo (3) → Uncomment token verification (2) → WebSocket connects → Auth state correct → `isDemo` health check works → Demo UI displays properly
- **Chain B (Worker → FPS → Translation)**: Fix worker WASM/CDN (4) → Worker initializes and sends 'ready' → FPS counter > 0 → Landmarks sent to backend → Inference produces results → Translation displayed
- **Chain C (178-feature pipeline)**: Fix dataset generator (7) → Ensure `TOTAL_FEATURES` = 178 → Feature vectors match across all three platforms → ONNX receives valid input → Predictions correct

---

## 3. Measurable Acceptance Criteria

The following criteria must be met for the MediaPipe pipeline to be considered "fully functional end-to-end":

| Criterion | Measurement | Component(s) |
|-----------|-------------|------------|
| **Camera streams** | `<video>` element has valid `srcObject` with user media; no black screen | Frontend (`useMediaPipe.js:startCamera()`) |
| **Worker initializes** | Web Worker posts `{ type: 'ready' }` within 5s of mount; no "ModuleFactory not set" errors | Frontend (`mediapipe-worker.js:initialize()`) |
| **FPS > 0** | FPS counter shows value ≥ 1 when camera has signal and worker is running | Frontend (`useMediaPipe.js:fpsWatchdogRef`, `mediapipeEngine.js:_fpsFrameCount`) |
| **Landmarks sent to backend** | WebSocket sends `{ type: 'inference', payload: [15-frame batch] }` at ≥ 2/sec throttling | Frontend (`useMediaPipe:buildPayload()`, `apiService:sendLandmarks()`) |
| **Backend accepts connection** | WS connection opens without 1008 close; auth token verified or connection allowed in production | Backend (`main.py:verify_supabase_token()`, CORS config) |
| **Inference produces result** | Backend returns `{"type": "translation", "payload": {"label": "<sign>", "confidence": > 0}}` | Backend (`main.py:run_inference_async()`, ONNX model) |
| **Translation displayed** | UI shows translation text; `isDemo` flag correctly reflects mode; no ReferenceError | Frontend (`Translator.jsx` render) |
| **178-feature invariant** | All three components (frontend, backend, dataset generator) agree on 52+63+63 feature layout; feature vectors are consistent | All components |

---

## 4. Implementation Phasing (for user approval)

### Phase 1 — Critical fixes (1 week)
1. Fix CORS origin typo in `backend/main.py`
2. Uncomment production token verification in `backend/verify_supabase_token()`
3. Fix `isDemo` initialization in `frontend/Translator.jsx` (ensure default + health-check robustness)
4. Fix MediaPipe worker WASM/CDN version matching in `frontend/src/workers/mediapipe-worker.js`
5. Add user-visible error if MediaPipe models fail to load

### Phase 2 — High-priority fixes (1-2 weeks)
6. Fix FPS watchdog to not snap to 0 immediately; freeze at last valid value
7. Add retry/backoff for health check in `frontend/apiService.js`
8. Enable real MediaPipe in dataset generator CMake build (or document stub mode)
9. Replace desktop `extract_landmarks()` stub with real MediaPipe C++ API or frontend worker integration
10. Ensure 178-feature dimension consistency across all components (add constant/check)

### Phase 3 — Medium-priority fixes (2-3 weeks)
11. Add mode switch (stub vs real MediaPipe) at runtime
12. Improve `usingDemoToken`/`authWarning` state logic simplicity
13. Add GPU/CPU delegate fallback in worker
14. Add type guards for `validateSequence()` `seq.empty` check
15. Add browser/devices detection for `requestVideoFrameCallback` fallback

### Phase 4 — Low-priority polish (optional)
16. Minor UI/UX improvements, documentation, type fixes

---

## 5. Rollout Strategy

- **Branch**: All fixes on branch `fix-mediapipe` with small, atomic commits
- **Each commit**: Single fix with message citing the audit finding that resolves it
- **Testing**: Manual end-to-end test: open Translator, grant camera access, verify:
  - Camera feed visible
  - FPS counter > 0
  - Landmarks drawn on canvas
  - WebSocket connection established (status "Conectado")
  - Translation result appears when signs are made
  - `isDemo` chip displays correctly
- **Rollback**: Each fix is revertible independently; no breaking changes expected since fixes either enable previously-broken functionality or correct typos

---