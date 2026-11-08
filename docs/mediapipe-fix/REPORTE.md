# Reporte Final de Depuración y Mejora MediaPipe — ExpresaT

**Rama:** `fix-mediapipe`  
**Fecha:** 2026-11-08  
**Estado:** ✅ 100% Validado (Build verde, Lint verde, 19/19 Tests en verde)

---

## 1. Causas Raíz Identificadas y Resueltas

| # | Problema Reportado | Causa Raíz Técnica | Solución Implementada |
|---|---|---|---|
| **A** | `ReferenceError: isDemo is not defined` (ErrorBoundary) | En `Translator.jsx`, la variable de estado `isDemo` se referenciaba en 6 ubicaciones del JSX y efectos (`/health` y `onMessage`), pero **nunca fue declarada con `useState`**. | Declarada `const [isDemo, setIsDemo] = useState(false)` en línea 21. |
| **B1** | WebSocket `wss://.../ws/translate` 403 / 1008 rechazo | En `main.py`, `verify_supabase_token()` tenía el bloque de producción comentado y retornaba `None` para cualquier token, cerrando el WebSocket con código 1008 sin bypass para modo demo. | Se desacopló la verificación estricta de JWT de la autorización en `websocket_translate()`, permitiendo acceso demo cuando `DEMO_MODE=True` o en desarrollo. |
| **B2** | Rechazo por `demo_fallback_token` espurio | `Translator.jsx` enviaba un token falso cableado (`'demo_fallback_token'`) cuando no había sesión, provocando el rechazo en producción. | Se reemplazó por `null` (conexión limpia sin token espurio que el servidor acepta en `DEMO_MODE`). |
| **B3** | Desincronización del protocolo de autenticación | `main.py` exigía `token` en los query params del handshake HTTP Upgrade (`/ws/translate?token=...`), mientras que `apiService.js` no lo adjuntaba en la URL y enviaba un mensaje `{type: 'auth'}` tras `onopen`, el cual `main.py` rechazaba como `Unknown message type`. | `apiService.js` ahora adjunta `?token=` en la URL si hay token disponible, y `main.py` reconoce `{type: 'auth'}` respondiendo `{type: 'auth_ack'}`. |
| **C** | Fallos potenciales de Worker e inicialización de MediaPipe | 1. No había CDN fallback si jsdelivr fallaba.<br>2. Se solicitaba `delegate: 'GPU'` sin fallback a CPU (falla en navegadores sin soporte WebGL/GPU en Workers).<br>3. `useMediaPipe.js` llamaba a `video.requestVideoFrameCallback` sin polyfill/fallback para navegadores que no lo soportan. | 1. CDN fallback a unpkg en `FilesetResolver`.<br>2. Helper `createWithFallback()` que degrada automáticamente a CPU.<br>3. `scheduleNextCapture()` y `cancelScheduledCapture()` con soporte nativo de rVFC + rAF. |
| **D** | Contador de FPS = 0 | Consecuencia combinada de la caída del render por `isDemo` y el timeout agresivo del watchdog de FPS (2.0s). | Resuelto el render, inicializado el worker con fallbacks y relajado el watchdog a 3.5s para absorber variaciones normales de latencia. |

---

## 2. Historial de Commits Aprobados (`fix-mediapipe`)

Todos los commits fueron probados atómicamente y validados contra linter y tests:

1. [`8d66a9c`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/pages/Translator.jsx): `fix(frontend): define isDemo state to resolve ReferenceError [MP-1]`
2. [`6caf276`](file:///home/adrian/Proyectos/expresat/expresat/backend/main.py): `fix(backend): allow demo mode WS connections and log reject reasons with origin [MP-2]`
3. [`fd6ea42`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/services/apiService.js): `fix(ws): align token auth protocol across handshake and message phases [MP-2b]`
4. [`d40c591`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/workers/mediapipe-worker.js): `fix(mediapipe): add WASM CDN fallback, GPU-to-CPU graceful degradation, and rVFC fallback [MP-3]`
5. [`98b75bf`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/pages/Translator.jsx): `fix(frontend): remove demo_fallback_token and relax FPS watchdog [MP-4]`
6. [`8615265`](file:///home/adrian/Proyectos/expresat/expresat/backend/main.py): `fix(backend): decouple token verification from demo mode access control [MP-5]`
7. [`28defd5`](file:///home/adrian/Proyectos/expresat/docs/mediapipe-fix/): `docs: add MediaPipe audit reports and execution plan [MP-0]`

*Commits revertidos:* Ninguno. Durante la inspección del stash se detectaron literales C++ (`1e-4f`, `0.60f`, `seq.empty`) que habrían roto el build de JavaScript con `SyntaxError`, por lo que fueron descartados preventivamente antes de ingresar a la rama.

---

## 3. Evidencia Antes / Después

### Frontend (Build & Lint)
- **Antes:** Pantalla de error con `ReferenceError: isDemo is not defined` capturado por `ErrorBoundary`. Fallo de conexión WS 1006 tras rechazo 403.
- **Después:**
  ```text
  > frontend@0.0.0 lint (oxlint)
  Found 2 warnings and 0 errors. Finished in 26ms.

  > frontend@0.0.0 build (vite build)
  ✓ 141 modules transformed.
  dist/assets/mediapipe-worker-B3e3GB0l.js   155.53 kB
  dist/assets/index-CXxrn6Sk.js              343.32 kB
  ✓ built in 858ms
  ```

### Backend (Pruebas Unitarias e Integradas)
- **Antes:** Error 403 / 1008 mudo sin logs claros de origen o motivo. Tests con discrepancias en mock tokens.
- **Después:**
  ```text
  Ran 19 tests in 0.013s
  OK
  ```
  Los logs de Render ahora imprimen explícitamente:
  `[WS REJECT] Origin=... | Token ausente | DEMO_MODE=... | FASTAPI_ENV=...` o `[WS AUTH] DEMO_MODE=true: sesión de demostración pública iniciada`.

---

## 4. Pasos Manuales Requeridos para el Usuario

> [!IMPORTANT]
> Los siguientes cambios deben aplicarse manualmente en los paneles de control de tus proveedores de hosting:

### A. En el Dashboard de **Render** (Servicio Backend)
1. **Variables de Entorno**:
   - `CORS_ORIGINS`: Añadir tu dominio de Netlify exacto:  
     `https://ecpresatt.netlify.app,https://expresat.netlify.app`
   - `EXPRESAT_DEMO_MODE`: Establecer en `true` para permitir inferencia pública y conexiones sin exigir token JWT de Supabase.
   - `FASTAPI_ENV`: Mantener en `production` (o `development` si vas a hacer pruebas directas con mock tokens).
2. **Redeploy**: Desplegar tras fusionar la rama `fix-mediapipe`.

### B. En el Dashboard de **Netlify** (Servicio Frontend)
1. **Variables de Entorno de Build**:
   - `VITE_WS_URL_PROD`: `wss://expresat.onrender.com/ws/translate`
   - `VITE_API_URL`: `https://expresat.onrender.com`
2. **Redeploy**: Desplegar el nuevo build para que tome las correcciones de `Translator.jsx`, `apiService.js`, `mediapipe-worker.js` y `useMediaPipe.js`.

---

## 5. Estado de Componentes Secundarios (Fase 3)

- **`expresat-dataset-generator`**: Opera en modo stub por defecto (sin MediaPipe C++ linkado). Las constantes y topología 178D (52 upper pose + 63 mano izq + 63 mano der) son coherentes con el backend.
- **`expresat-native`**: El módulo C++ tiene pendiente la implementación de `extract_landmarks()` (marcado como TODO); no interfiere con la aplicación web en producción.
