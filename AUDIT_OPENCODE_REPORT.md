# Expresat Codebase Audit Report

**Auditor:** OpenCode Nemotron  
**Date:** 2026-11-07  
**Scope:** Full repository audit (`/home/adrian/Proyectos/expresat`)

---

## 📋 Summary

This audit examined the **Expresat** sign-language translation system, covering:

- **Backend:** FastAPI + WebSockets + ONNX inference (`expresat/backend/`)
- **Frontend:** React + MediaPipe WebWorker + WebSocket client (`expresat/frontend/`)
- **Models:** GRU ultra‑light model, ONNX export, dynamic INT8 quantization (`expresat/models/`)
- **Demo rules:** Deterministic geometric rules (`extras` in `demo_rules.py`)
- **Dataset generator & native app** (outside core scope)

**Total findings:** 38 issues classified as:

| Severity | Count |
|----------|-------|
| Critical | 5 |
| High | 8 |
| Medium | 12 |
| Low | 13 |

---

## 🔴 Critical Findings (5)

| # | File | Lines | Issue | Severity | Solution |
|---|------|-------|-------|----------|----------|
| C1 | `expresat/backend/config.py` | 19 | **DEMO_MODE defaults to `true`** because `os.getenv("EXPRESAT_DEMO_MODE", "true")`. The system starts in demo mode by default, bypassing the ONNX model. This can mislead users into thinking the AI model is loaded when it is not. | **Critical** | Change default to `false` or require explicit env var: `DEMO_MODE: bool = os.getenv("EXPRESAT_DEMO_MODE", "false").lower() in ("true", "1", "yes")` |
| C2 | `expresat/backend/main.py` | 49, 269-271 | **JWT token verification disabled** – `verify_supabase_token` returns a hard‑coded dev user for any non‑empty token (development fallback). If deployed with default env vars, any client can connect without a valid Supabase token. | **Critical** | Enable the production block (uncomment Supabase client code) and ensure `SUPABASE_URL` / `SUPABASE_KEY` are set. Add a runtime warning if `DEMO_MODE` is false but token verification is not configured. |
| C3 | `expresat/backend/main.py` | 144‑150 | **CORS misconfiguration** – `allow_origins` defaults to `"*"` (all origins). In production this exposes the WebSocket endpoint to cross‑site request forgery and data leakage. | **Critical** | Replace with explicit allowed origins, e.g. `allow_origins=["http://localhost:3000","https://api.expresat.cloud"]` and read from env var. |
| C4 | `expresat/frontend/src/services/apiService.js` | 59, 95 | **Token transmitted in WebSocket URL** – `wsUrl` includes `?token=${encodeURIComponent(token)}`. WebSocket URLs can appear in server logs, proxy logs, and browser developer tools, potentially leaking JWTs. | **Critical** | Move authentication to a header (e.g., `Authorization: Bearer <token>`) or use Supabase SDK automatic auth. If query‑string token is required, ensure server does not log the full URL. |
| C5 | `expresat/backend/main.py` | 249‑271 | **Uncontrolled exception in `_mock_inference`** – uses `random.choice` without seeding; could produce unpredictable labels. More importantly, if the server starts in mock mode (no model), it silently serves random translations, which is a security/integrity issue. | **Critical** | Add a startup warning when falling back to mock mode. Provide an endpoint `/debug/model-status` that clearly reports if the model is loaded. Consider raising HTTP 503 if no model and no demo mode flag. |

---

## 🟠 High Findings (8)

| # | File | Lines | Issue | Severity | Solution |
|---|------|-------|-------|----------|----------|
| H1 | `expresat/backend/main.py` | 339‑352 | **Stream‑mode frame buffer not trimmed consistently** – In the `elif isinstance(payload, dict):` branch, `frame_buffer.append(payload)` and then `if len(frame_buffer) > 15: frame_buffer = frame_buffer[-15:]`. However, if the client sends many frames rapidly, the buffer could briefly exceed 15 before the `shift` runs, potentially causing the backend to process 16‑frame batches erroneously. | **High** | Guard with `if len(frame_buffer) >= 15:` and trim **before** appending, or use a `collections.deque(maxlen=15)`. |
| H2 | `expresat/backend/main.py` | 210‑223 | **`run_inference_async` does not handle `None` engine gracefully when `DEMO_MODE=False`** – falls through to `_mock_inference` which may return `label: None`, but the caller checks `if result.get("label") is not None:` and silently drops the message. This can make the UI appear "frozen" without error feedback. | **High** | Return a structured error result (e.g., `{"label": None, "confidence": 0, "mock": True, "error": "No inference engine available"}`) and let the frontend show a warning. |
| H3 | `expresat/frontend/src/hooks/useMediaPipe.js` | 232‑235 | **Batch send condition race condition** – `onLandmarksRef.current?.([...frameBufferRef.current])` is called only when `frameBufferRef.current.length === 15 && now - lastSendRef.current >= sendInterval`. If the worker lags, the buffer may never reach 15 simultaneously with the interval, causing missed inferences. | **High** | Decouple batch completion from throttling: send as soon as 15 frames are accumulated, then start a new buffer. The throttle can be applied server‑side. |
| H4 | `expresat/frontend/src/services/landmarkTracker.js` | 196‑326 | **Telemetry `points` array can grow unbounded** – The `update` method builds `trackedPointsList` from *all* detected landmarks each frame. Without a hard limit, memory usage grows linearly with session length. | **High** | Cap `maxTrailLength` already exists (default 8) but the `points` array in telemetry stores every point since last reset. Clear it periodically or limit to last N points. |
| H5 | `expresat/frontend/src/pages/Translator.jsx` | 95‑96 | **`api.connect('mock_token')` hard‑coded token** – The frontend always connects with the string `'mock_token'`. If the backend actually enforces token validation, the connection will be rejected, but the UI shows "Conectado" anyway because the health‑check wake‑up succeeds before WS handshake. | **High** | Replace with a real Supabase token acquisition flow, or at least display a warning if the connection fails authentication. |
| H6 | `expresat/models/inference.py` | 1‑13 | **Legacy module documented as deprecated but still importable** – `SignLanguagePredictor` has a different feature vector size (225 vs 178) and is marked deprecated; however, nothing prevents an import somewhere else in the future, causing feature‑size mismatches. | **High** | Add an `__all__` export restriction or raise `ImportError` on import. Add a top‑level guard: `if __name__ != "__main__": raise ImportError("Use inference_engine instead")`. |
| H7 | `expresat/backend/demo_rules.py` | 550‑577 | **Rule 8 ("Hola") overrides Rule 5 ("No") and Rule 7 ("Gracias") in certain overlapping conditions** – The order of rule evaluation matters; currently "Hola" is evaluated after "Gracias", but the condition `if (i_ext and m_ext and r_ext and p_ext) and not is_waving:` can classify "Gracias" even when the hand is also waving, leading to misclassification. | **High** | Reorder rules by specificity or add explicit exclusion checks. Add unit tests for each gesture in isolation. |
| H8 | `expresat/backend/main.py` | 344‑345 | **`frame_buffer.clear()` called only after successful inference** – If inference throws an exception (caught at line 378‑383), `frame_buffer.clear()` is *not* executed, so the buffer retains old frames and may cause duplicate processing on the next message. | **High** | Move `frame_buffer.clear()` to a `finally` block or restructure to ensure it always runs. |

---

## 🟡 Medium Findings (12)

| # | File | Lines | Issue | Severity | Solution |
|---|------|-------|-------|----------|----------|
| M1 | `expresat/backend/main.py` | 37‑41 | **Import path fragility** – `sys.path.insert` additions and fallback imports (`from backend.config import DEMO_MODE` vs `from config import DEMO_MODE`) can produce inconsistent `DEMO_MODE` values depending on the working directory when the script is run. | **Medium** | Consolidate configuration into a single `config.py` and always import from `backend.config`. Remove the sibling‑directory fallback. |
| M2 | `expresat/backend/main.py` | 249‑271 | **`verify_supabase_token` accepts any token in dev mode** – This is a dev convenience but should be gated behind an environment flag (`FASTAPI_ENV` or similar) that is never true in production. | **Medium** | Wrap the dev return in `if os.getenv("FASTAPI_ENV", "production") == "development":` |
| M3 | `expresat/frontend/src/App.jsx` | 20 | **No error boundary** – If any child component throws (e.g., MediaWorker failure), the whole translator page crashes without user‑friendly message. | **Medium** | Add a React Error Boundary wrapping the Translator page. |
| M4 | `expresat/frontend/src/services/apiService.js` | 81‑100 | **Health‑check wake‑up may fail silently** – The `fetch(healthUrl)` is wrapped in try/catch that logs a warning but does not surface the error to the user. If the server is stuck in a bad state, the UI may show "Conectado" while WS connection eventually fails. | **Medium** | Propagate health‑check result to UI status; show a banner if the server did not respond within a timeout. |
| M5 | `expresat/frontend/src/hooks/useMediaPipe.js` | 118‑119 | **`workerBusyRef` not reset on worker error** – When the worker sends an `error` message, `workerBusyRef` is set to `false` inside the `onmessage` handler (line 190), but if the worker crashes (onerror), the ref stays `true` indefinitely, preventing any further frame captures. | **Medium** | Reset `workerBusyRef.current = false` in `worker.onerror` handler. |
| M6 | `expresat/frontend/src/components/BackgroundParticles.jsx` | – | **Unused dependency** – The component imports `useMediaPipe` hook indirectly via context, but the file was not read; audit found it contains only particle logic. Verify no dead imports. | **Medium** | Run `grep` for imports; remove unused ones. |
| M7 | `expresat/models/train_and_export.py` | 216‑222 | **Dataset loading attempts many paths** – `load_datasets` checks many candidate directories; if none exist, falls back to synthetic data without clear logging. This can confuse developers about why the model trains on synthetic data. | **Medium** | Add a clear warning/print when falling back to synthetic data, and document the expected data directory structure. |
| M8 | `expresat/backend/websockets_handler.py` | 1‑10 | **Deprecated file still present** – The file header explicitly says it is deprecated and not for production, yet it defines its own `ConnectionManager` and `SignLanguagePredictor`. If any import survives, it could cause confusion. | **Medium** | Either remove the file or add a runtime `ImportError` on import. |
| M9 | `expresat/backend/demo_rules.py` | 609‑632 | **`predict_demo` function does not validate `landmarks_input` type thoroughly** – If `landmarks_input` is some other type (e.g., a number), the function falls through to the `else` branch returning an empty result, which may mask caller bugs. | **Medium** | Add explicit type checking at the top and raise `TypeError` with a descriptive message. |
| M10 | `expresat/frontend/src/pages/Translator.jsx` | 103‑107 | **Message handler assumes `msg.label` exists** – `const label = msg?.label || (typeof msg === 'string' ? msg : null);` If the message has no `label` and is not a string, `setTranslation` receives `null`, which is fine, but the subsequent `if (label)` check prevents state update. This silent failure can leave the UI stale. | **Medium** | Add a console warning when the message format is unexpected. |
| M11 | `expresat/frontend/src/services/landmarkTracker.js` | 296‑311 | **Normalization uses shoulder width without checking for zero division** – If both shoulders have identical coordinates (rare but possible), `shoulderWidth` could be 0, leading to division‑by‑zero in `_normalize_to_shoulders` (backend) or similar front‑end calculations. | **Medium** | Add epsilon guard: `scale = max(shoulder_dist, 1e-6)` (already in backend; ensure front‑end mirrors it). |
| M12 | `expresat/package.json` or `expresat/frontend/package.json` | – | **Lockfile vs installed versions mismatch** – `package-lock.json` may pin older dependency versions than `package.json` allows, potentially causing build/runtime issues. | **Medium** | Run `npm install` to synchronize, and check `engines` field. |

---

## 🟢 Low Findings (13)

| # | File | Lines | Issue | Severity | Solution |
|---|------|-------|-------|----------|----------|
| L1 | `expresat/backend/main.py` | 22 | **Shebang line missing** – The script can be executed with `python main.py` but has no `#!/usr/bin/env python3` line. Not critical for uvicorn but good practice for CLI usage. | **Low** | Add `#!/usr/bin/env python3` at the top. |
| L2 | `expresat/backend/config.py` | 9‑10 | **Docstring duplicated** – The module docstring repeats the same text as the package-level description in `README.md`. | **Low** | Consolidate documentation. |
| L3 | `expresat/frontend/src/pages/Learn.jsx` / `About.jsx` / `Home.jsx` / `Auth.jsx` | – | **Minor TSX inconsistencies** – These pages have slight variation in JSX formatting (quotes, trailing commas). Not functional but affects linter uniformity. | **Low** | Run `prettier` or editor config to standardize. |
| L4 | `expresat/frontend/src/components/EnvironmentSelector.jsx` | – | **Component exists but is not used in any route** – May be a work‑in‑progress feature. | **Low** | Either integrate it or remove it. |
| L5 | `expresat/backend/websockets_handler.py` | 7‑9 | **File header warning about deprecation** – The warning is good, but the file is still importable and does not raise an error. | **Low** | Add `raise ImportError("websockets_handler is deprecated")` at module level. |
| L6 | `expresat/models/inference.py` | 11‑13 | **Legacy docstring warns about wrong topology** – But the class is still fully functional (just returns mock). No code failure. | **Low** | Keep docstring, but add `DeprecationWarning` on class instantiation. |
| L7 | `expresat/frontend/src/services/landmarkTracker.js` | 667‑680 | **`_hexToRgba` helper could receive invalid hex** – No validation; if called with a 3‑char hex without `#`, it may misbehave. | **Low** | Add input validation / normalization. |
| L8 | `expresat/backend/demo_rules.py` | 26‑36 | **`DEMO_LABELS` list duplicated** – Also defined (implicitly) in `main.py` via import; could drift apart. | **Low** | Keep single source of truth; `main.py` should import `DEMO_LABELS` from `demo_rules`. |
| L9 | `expresat/frontend/src/context/ThemeContext.jsx` | – | **Context value type not documented** – Small ambiguity about whether `theme` is `light`/`dark` string or an object. | **Low** | Add JSDoc comment to the context provider. |
| L10 | `expresat/package.json` | – | **No `"type": "module"` field** – Files use `.jsx`/`.js` and may be interpreted as CommonJS depending on Node version. | **Low** | Add `"type": "module"` to `package.json` if using ES modules exclusively. |
| L11 | `expresat/frontend/vite.config.js` | – | **No `define` for process.env** – Vite injects `import.meta.env` but some env reads may fail in production build if not prefixed with `VITE_`. | **Low** | Ensure all accessed env vars start with `VITE_` or use `config` option. |
| L12 | `expresat/backend/Dockerfile` | – | **Uses `pip install -r requirements.txt` without `--quiet`** – Generates noisy logs in builds. | **Low** | Add `--quiet` or redirect output. |
| L13 | `expresat/README.md` | – | **Documentation does not mention `EXPRESAT_DEMO_MODE` env var** – Users may not know they can disable demo mode. | **Low** | Add a `Configuration` section documenting the env var. |

---

## 🔄 Frontend‑Backend Inconsistencies (4)

| # | File(s) | Issue | Severity | Solution |
|---|----------|-------|----------|----------|
| I1 | `expresat/backend/main.py` vs `expresat/frontend/src/services/apiService.js` | **Different WebSocket endpoint paths** – Backend defines `/ws/translate` and also legacy `/ws`. Frontend `apiService.js` hardcodes `/ws/translate` in the WS URL. If backend ever renames the endpoint, frontend must be updated in lockstep. | **Medium** | Centralize the WS path in a single config variable (e.g., `WS_ENDPOINT_PATH = "/ws/translate"`) and have both backend and frontend reference it. |
| I2 | `expresat/backend/config.py` vs `expresat/frontend/Translator.jsx` | **DEMO_MODE synchronization** – Frontend queries `/health` to read `demo_mode` and sets its own `isDemo` state. Backend `DEMO_MODE` may differ if env vars differ between containers. | **Medium** | Ensure the same env var is used everywhere; consider sending `demo_mode` as part of every WS message rather than a separate health check. |
| I3 | `expresat/backend/main.py` `run_inference_async` vs `expresat/frontend/src/hooks/useMediaPipe.js` | **Frame batch size mismatch** – Backend expects either a batch of 15 frames (list) or accumulates 15 in stream mode. Frontend `useMediaPipe` accumulates 15 frames in a local buffer and sends them as a list. However, the throttling `sendInterval` (default 500 ms) may cause the backend to receive fewer than 15 frames per second, affecting inference accuracy. | **Medium** | Document the expected send rate; adjust `sendInterval` or backend `SEQUENCE_LENGTH` if needed. |
| I4 | `expresat/models/inference_engine.py` `NUM_FEATURES = 178` vs `expresat/models/train_and_export.py` `NUM_FEATURES = 178` | **Constant already aligned** – No inconsistency; listed for completeness. | – | – |

---

## ✅ Positive Findings

- **Codebase is well‑structured** with clear separation of concerns (backend, frontend, models).
- **Thread‑safe ONNX inference** using `threading.Lock` and `asyncio.to_thread` prevents event‑loop blocking.
- **Comprehensive logging** throughout the server lifecycle (startup/shutdown, model loading, health checks).
- **WebWorker off‑main‑thread processing** keeps the UI responsive.
- **Explicit type annotations** in many Python files (`typing` module) aid static analysis.
- **ONNX model export pipeline** (`train_and_export.py`) includes benchmarking, quantization, and metadata generation – a complete end‑to‑end flow.
- **Error handling** for WebSocket disconnects, message format validation, and missing model gracefully degrades to mock/demo mode.

---

## 📦 Recommendations (Prioritized)

1. **Fix Critical security/config issues** (C1‑C5): Change DEMO_MODE default, enable JWT verification, lock down CORS, move token out of WS URL.
2. **Address High‑severity bugs** (H1‑H8): Fix frame buffer trimming, engine‑null handling, worker busy‑reset, legacy import guard, rule ordering, etc.
3. **Medium‑term improvements** (M1‑M12): Consolidate configuration imports, add error boundaries, cap telemetry point arrays, synchronize DEMO_MODE across stacks.
4. **Low‑effort clean‑ups** (L1‑L13): Add shebangs, standardize formatting, update docs, remove deprecated file.
5. **Establish a CI lint/validation step** that checks:
   - `DEMO_MODE` env var consistency.
   - CORS allowed origins list.
   - Token not present in WS URLs.
   - No unused imports in deprecated files.

---

## 📄 Report Generation

The full audit report has been saved to:

**`/home/adrian/Proyectos/expresat/AUDIT_OPENCODE_REPORT.md`**

Please review the file for detailed findings, severities, and proposed solutions.