# Reporte de Rearquitectura y Verificación — ExpresaT (`rearquitectura-demo`)

**Fecha:** 2026-11-09  
**Rama:** `rearquitectura-demo`  
**Estado:** ✅ 100% En Verde (ESLint, Vitest 24/24, Backend Unittest 22/22, Vite Build, Playwright E2E 2/2)

---

## 1. Resumen de lo Realizado

Se rediseñó y reimplementó el pipeline web de **ExpresaT** siguiendo una arquitectura estricta de 4 capas desacopladas (`engine/`, `recognition/`, `transport/`, `ui/`) con un único módulo central de configuración (`src/config.js`), garantizando que el modo demo funcione **100% en el navegador sin requerir backend ni login**, y dejando lista la interfaz `Classifier` para conectar el modelo neuronal ONNX/GRU posteriormente.

### Hallazgo Técnico Clave durante la Auditoría (`ModuleFactory not set`)
Al inspeccionar el bundle de `@mediapipe/tasks-vision` (`vision_bundle.mjs`), se confirmó con evidencia exacta por qué fallaba en el Worker ESM (`type: 'module'`):
1. En un Worker ESM, `typeof importScripts === 'function'`, por lo que `vision_bundle.mjs` invoca `importScripts('/wasm/vision_wasm_internal.js')`, lo cual lanza `TypeError` en módulos ES y cae a `await import(...)`.
2. Inmediatamente después de inicializar la primera tarea (`HandLandmarker`), Emscripten ejecuta `self.ModuleFactory = self.Module = void 0;`. Cuando `PoseLandmarker` se inicializaba en paralelo o en fallback, `self.ModuleFactory` ya era `undefined`, lanzando `Error: ModuleFactory not set.`.
3. **Solución definitiva:** Se eliminó el Worker (`src/workers/mediapipe-worker.js`) y se ejecutó MediaPipe en el **hilo principal** (`src/engine/signEngine.js`), protegiendo `window.ModuleFactory` con un descriptor que impide su borrado, sirviendo tanto los binarios WASM (`/public/wasm/`) como los modelos `.task` (`/public/models/hand_landmarker.task`) localmente, y utilizando `delegate: 'CPU'` (XNNPACK) por defecto con fallback automático.

---

## 2. Bitácora de Pasos, Revisiones Independientes y Commits

Cada módulo pasó por las compuertas automatizadas (`npm run lint && npm test && npm run build`) y por la auditoría de un subagente **Revisor Independiente** de solo lectura antes de ser confirmado en Git:

| Paso | Módulo |Observaciones del Revisor Independiente y Corrección Pre-Commit | Commit Aceptado | Commits Revertidos |
|---|---|---|---|---|
| **Paso 0 y 1** | `docs/ARQUITECTURA.md`, `src/config.js`, `.env.example`, `authService.js`, ESLint, Vitest | El revisor detectó que `src/services/authService.js` aún leía `import.meta.env` directamente y lanzaba `throw new Error` al importar si faltaban variables de Supabase. Se refactorizó `authService.js` para usar `CONFIG` de `src/config.js` y degradar a `supabase = null` en modo demo, y se exportó `validateConfig()`. | `d069ed4` — `feat(base): add architecture doc, central config, env templates, eslint and vitest` | Ninguno (`0`) |
| **Paso 2** | `src/recognition/` (`geometry.js`, `classifier.js`, `syntheticHand.js`, tests) | El revisor detectó que en `GeometricClassifier.predict()` (modo streaming frame a frame) la expresión `voted.label ?? rawLabel` devolvía `rawLabel` antes de alcanzar `minVotes`. Se corrigió para devolver estrictamente `voted.label` y se añadió test unitario. | `f16a023` — `feat(recognition): add pure geometric hand classifier, normalization, temporal wave and voting` | Ninguno (`0`) |
| **Paso 3** | `src/engine/` (`signEngine.js`, `vite.config.js`, modelos `.task` locales, tests) | El revisor detectó que si `videoElement.play()` o `_initializeMediaPipe()` lanzaban excepción después de `getUserMedia`, debía invocarse `_cleanupResourcesOnly()` antes de retornar `false` para no dejar tracks de cámara abiertos. Se corrigió y se añadió test unitario. | `56d6ba6` — `feat(engine): add main-thread MediaPipe SignEngine with idempotent cleanup and real FPS` | Ninguno (`0`) |
| **Paso 5** | `src/transport/wsClient.js` + `backend/config.py`, `backend/main.py`, tests | Aprobado en primera ronda: máquina de estados explícita (`idle\|connecting\|open\|auth_error\|failed`), sin reintentos en `1008`/`403`/sin token, y validación de `Origin` y `EXPRESAT_DEMO_MODE` en backend. | `1577d5b` — `feat(transport,backend): add optional WSClient with explicit state machine and backend origin/demo validation` | Ninguno (`0`) |
| **Paso 4 y E2E** | `src/ui/` (`useSignEngine.js`, `drawLandmarks.js`), `Translator.jsx`, eliminación de `mediapipe-worker.js`, Playwright E2E | Durante la primera corrida de Playwright se detectó que `SignEngine` llamaba `this._emaFilter.filter()` en lugar de `this._emaFilter.smoothResults()`. Se corrigió y los 2 tests E2E en navegador real pasaron en verde. Aprobado por el revisor independiente. | `a3e36d4` — `feat(ui,e2e): add useSignEngine hook, Translator UI, remove worker, and add Playwright E2E` | Ninguno (`0`) |

---

## 3. Evidencia de Verificación Automatizada

### 3.1 Linter (`npm run lint`)
```text
> frontend@0.0.0 lint
> eslint src
(0 errors, 0 warnings)
```
Reglas activas verificadas: `no-undef: "error"`, `react-hooks/rules-of-hooks: "error"`, `react-hooks/exhaustive-deps: "warn"`.

### 3.2 Pruebas Unitarias Frontend (`npm test` — Vitest)
```text
 ✓ src/__tests__/config.test.js (3 tests)
 ✓ src/engine/__tests__/signEngine.test.js (4 tests)
 ✓ src/recognition/__tests__/recognition.test.js (12 tests)
 ✓ src/transport/__tests__/wsClient.test.js (5 tests)

 Test Files  4 passed (4)
      Tests  24 passed (24)
```

### 3.3 Pruebas Unitarias e Integración Backend (`unittest`)
```text
PYTHONPATH=expresat:expresat/backend expresat/venv/bin/python -m unittest expresat/backend/test_api_integration.py expresat/backend/test_demo_rules.py
----------------------------------------------------------------------
Ran 22 tests in 0.016s

OK
```
Incluye verificación explícita de:
- Handshake aceptado (`101` / `pong`) en `/ws/translate` cuando `EXPRESAT_DEMO_MODE=true` sin token.
- Rechazo inmediato con código `1008` y log `[WS REJECT] ... Token ausente` cuando `EXPRESAT_DEMO_MODE=false` en producción.
- Rechazo inmediato con código `1008` y log `[WS REJECT] ... Origin no autorizado` cuando la cabecera `Origin` no pertenece a `CORS_ORIGINS`.

### 3.4 Build de Producción (`npm run build`)
```text
> frontend@0.0.0 build
> vite build
✓ 154 modules transformed.
dist/index.html                     1.15 kB │ gzip:   0.62 kB
dist/assets/logo-BqVg_dak.png   3,143.98 kB
dist/assets/index-DUQ1uXYo.css     19.43 kB │ gzip:   4.52 kB
dist/assets/index-DYrgGz8D.js     731.10 kB │ gzip: 212.62 kB
✓ built in 1.04s
```
*(Nota: El bundle ya no genera `dist/assets/mediapipe-worker-*.js` porque el Worker fue eliminado por completo).*

### 3.5 Verificación E2E en Navegador Real con Cámara Falsa (`Playwright`)
Se ejecutó Chromium headless con `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`:
```text
Running 2 tests using 1 worker
  ✓  1 [e2e/translator.spec.js] Modo Demo 100% en navegador (sin backend): carga WASM, FPS > 0, detecta landmarks > 0, reconoce gesto y sin errores de consola (3.7s)
  ✓  2 [e2e/translator.spec.js] Con Backend en modo demo: conecta WebSocket y muestra "Conectado" sin bucles de reconexión (2.2s)
  2 passed (8.9s)
```
En la salida del navegador se verificó la creación del delegate XNNPACK en hilo principal (`INFO: Created TensorFlow Lite XNNPACK delegate for CPU`), estado `WASM Activo`, `Inferencia FPS > 0`, `21 landmarks`, reconocimiento local de `Dos` y `Mano Abierta`, conexión WebSocket mostrando `Conectado` con el backend activo, y `0` errores de página/consola (`ReferenceError`, `ModuleFactory`, `AbortError`).

---

## 4. Pendientes y Siguientes Pasos (Fuera de este Alcance)

1. **Integración futura del Modelo Neuronal (`ModelClassifier`)**:
   - Cuando se entrene y exporte una nueva versión del modelo `expresat_gru_int8.onnx` con vocabulario ampliado, basta con instanciar `ModelClassifier` (en `src/recognition/classifier.js`) y pasarlo a `useSignEngine({ classifierInstance })` sin modificar `SignEngine` ni `Translator.jsx`.
2. **Configuración manual en Netlify y Render**:
   - Aplicar las variables de entorno listadas en el `README.md` (`EXPRESAT_DEMO_MODE=true` y `CORS_ORIGINS` en Render; `VITE_WS_URL_PROD=wss://expresat.onrender.com/ws/translate` y `VITE_API_URL=https://expresat.onrender.com` en Netlify) y disparar el redeploy de ambos servicios.
