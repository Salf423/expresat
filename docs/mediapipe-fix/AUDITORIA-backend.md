# MediaPipe Audit — Backend (FastAPI)

**Scope:** `/home/adrian/Proyectos/expresat/expresat/backend/`
**Project:** ExpresT — Real-time Sign Language Translation
**Date:** 2026-11-08

---

## 1. Overview

The backend provides:
- **WebSocket endpoint** `/ws/translate` for receiving batches of MediaPipe landmarks
- **JWT authentication** via Supabase (`verify_supabase_token`)
- **Health check endpoints** `/health` and `/`
- **Inference engine** (ONNX Runtime or deterministic demo rules)
- **Demo mode** controlled by `DEMO_MODE` env var

Critical issues identified: 403 token rejection, CORS typo, unimplemented token verification, DEMO_MODE configuration.

---

## 2. File-by-File Audit

### `main.py` (main backend)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Critical** | **Token verification block commented out** | `verify_supabase_token()` function (lines 252-285) has the production verification block **commented out** (lines 272-280). In production mode, the function always returns `None` regardless of token validity, causing the WebSocket endpoint to close with "Invalid or missing token" (code 1008). This is the root cause of the 403/rejection the user reports. | 252-285 |
| **Critical** | **CORS origin typo causes 403 rejections** | `CORS_ORIGINS_DEFAULT` list (main.py:52-59) includes `"https://ecpresatt.netlify.app"` (line 58) — this is a typo. The comment on line 51 explicitly states: "el typo 'ec' vs 'ex' es la causa del 403 CORS". Requests from `expresat.netlify.app` or correct origin may be rejected. | 51-59 |
| **High** | **`DEMO_MODE` not configured via env var in production** | `config.py` defines `DEMO_MODE: bool = os.getenv("EXPRESAT_DEMO_MODE", "false").lower() in ("true", "1", "yes")` (config.py:19). If the environment variable `EXPRESAT_DEMO_MODE` is not set in the Render deployment, it defaults to `false`, expecting an ONNX model. If the model is not loaded, the server starts in mock mode but may still reject WebSocket connections. | config.py:19, main.py:91-96 |
| **High** | **WebSocket endpoint rejects missing/invalid token** | `websocket_translate()` (main.py:290-420) calls `verify_supabase_token(token)` (line 312). If the result is `None` (which is the case in production due to commented-out verification), the endpoint closes the connection with code 1008 and reason "Invalid or missing token" (lines 313-322). This matches the user's "403" symptom (though WS code is 1008, the HTTP-level effect is similar). | 290-322 |
| **Medium** | **Health check only pings once on WebSocket connect** | The `connect()` method in `ApiService` (frontend) fetches `/health` once (main.py:436-447). The `/health` endpoint responds 200 with status and `demo_mode` flag. No keep-alive or periodic health re-check. | 436-447 |
| **Medium** | **`/health` endpoint exposes `demo_mode` flag** | `detailed_health()` (main.py:450-477) and `health_check()` (main.py:436-447) both return `"demo_mode": DEMO_MODE` in the response. The frontend uses this to set `isDemo` state (Translator.jsx lines 78-81). If `DEMO_MODE` is incorrectly configured, `isDemo` will be wrong. | 436-477 |
| **Low** | **Inference engine loading may fail silently** | `lifespan` startup (main.py:78-132) tries to load `InferenceEngine` from `MODEL_DIR`. If `FileNotFoundError`, it sets `_inference_engine = None` and logs a warning (line 117-120). If another Exception occurs, same behavior (line 122-125). The server continues in mock mode but WebSocket may still reject connections. | 100-125 |
| **Low** | **Frame buffer size matches frontend** | `ConnectionManager.frame_buffer` uses `deque(maxlen=15)` (main.py:166), matching the frontend's 15-frame temporal window (`useMediaPipe.js:229`). Consistency good. | 166 |

### `config.py` (global configuration)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **High** | **`DEMO_MODE` default depends on unset env var** | `DEMO_MODE: bool = os.getenv("EXPRESAT_DEMO_MODE", "false").lower() in ("true", "1", "yes")` (config.py:19). In production (Render), if `EXPRESAT_DEMO_MODE` is not set in the environment, it defaults to `false`. This means the server expects an ONNX model. If the model file is not present or path is wrong, the server starts in an unexpected mode. The frontend checks `/health` for `demo_mode` to set `isDemo`, so mismatch causes UI confusion. | 19 |
| **Low** | **No documentation on how to enable demo mode** | The config file has comments explaining how to set `DEMO_MODE = True` or `EXPRESAT_DEMO_MODE=true`, but there's no runtime guard or warning if the mode changes unexpectedly. | 1-19 |

### `demo_rules.py` (demo inference)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **Deprecated/untouched demo rules** | This file implements deterministic geometric rules for sign recognition (angles, distances, finger extension). It is the fallback when `DEMO_MODE=True`. The file appears functional but may not be updated to match the 178-feature pipeline expectations. | Entire file |
| **Medium** | **May not accept same feature format as ONNX model** | The `predict_demo()` function processes frames differently from the ONNX inference path. If `DEMO_MODE` is toggled at runtime, the feature vector format (178 floats) must match between both paths. | Entire file |

### `websockets_handler.py` (WebSocket handling)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **May contain duplicate logic with main.py endpoint** | This file exists alongside the `/ws/translate` endpoint in `main.py`. Need to verify if it's used or if the `@app.websocket("/ws/translate")` in main.py is the canonical endpoint. | Entire file |
| **Low** | **No token verification in handler** | If this handler is used, it does not verify tokens, which would be a security gap. | Entire file |

### `test_demo_rules.py` (tests)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **Test coverage for demo rules** | Exists but doesn't verify 178-feature pipeline compatibility. | Entire file |

### `test_api_integration.py` (tests)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **Integration tests may not cover WebSocket auth** | Tests exist for API endpoints but may not test the `/ws/translate` endpoint with auth tokens. | Entire file |

---

## 3. Client-Server Mismatches

| Finding | Evidence |
|---------|----------|
| **Frontend sends `demo_fallback_token` or no token; backend rejects both** | The user reports: "El cliente envía demo_fallback_token, lo que sugiere que falta la variable de entorno real en el build". The frontend `Translator.jsx` lines 117-144 set `authToken = null` in production without valid token, and `apiService.connect(null)` sends no auth message. But the backend `verify_supabase_token` returns `None` for any token in production (due to commented-out verification), so the WS connection is closed with 1008. |
| **CORS origin typo blocks correct origins** | Backend lists `"https://ecpresatt.netlify.app"` (typo) instead of `"https://expresat.netlify.app"`. The frontend may be deployed to Netlify with a domain that doesn't match the CORS whitelist exactly. |
| **178-feature pipeline dimension** | Both frontend and backend expect 178 features (pose 52 + left hand 63 + right hand 63). If the landmark extraction format changes (e.g., different normalization), the feature vector dimension breaks and the backend inference returns errors or mock results. |
| **Token sending strategy mismatch** | Frontend sends token via `{ type: "auth", token }` WS message (apiService.js:113). Backend `verify_supabase_token` is supposed to validate this, but the production code path is commented out. |
| **`is_demo` flag from `/health`** | Frontend reads `data.demo_mode` from `/health` response (Translator.jsx:79-81) to set `isDemo` state. Backend returns `"demo_mode": DEMO_MODE` (main.py:445, 461). If `EXPRESAT_DEMO_MODE` env var is not set in production, `demo_mode` will be `false`, and the frontend will not show the demo UI indicators. |

---

## 4. Severity Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 3 |
| Medium | 3 |
| Low | 5 |

**Priority order for fixes:**
1. Enable production token verification (uncomment block in `verify_supabase_token`)
2. Fix CORS origin typo (`ecpresatt` → `expresat`)
3. Configure `EXPRESAT_DEMO_MODE` env var or adjust `DEMO_MODE` default
4. Ensure 178-feature pipeline compatibility between frontend and backend
5. Add retry/backoff for health check in ApiService
6. Add proper error handling for inference engine loading

---

## 5. Evidence Collection

- **Token verification commented out**: `main.py` line 272-280 block commented. In production, `verify_supabase_token()` returns `None` for any token, causing WS close code 1008 with "Invalid or missing token".
- **CORS typo**: `main.py` line 58 has `"https://ecpresatt.netlify.app"` — confirmed comment on line 51: "el typo 'ec' vs 'ex' es la causa del 403 CORS".
- **DEMO_MODE default**: `config.py:19` defaults to `false` if `EXPRESAT_DEMO_MODE` env var not set. Frontend `/health` will return `"demo_mode": false`, hiding demo UI.
- **403 vs 1008**: User reports "403" but WS close code is 1008. The HTTP-level symptom may feel like 403, but the WS protocol uses 1008.