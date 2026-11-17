# Auditoría MediaPipe — Frontend (Web)

- **Ámbito:** `expresat/frontend/src/`
- **Proyecto:** ExpresaT — Traducción de Lengua de Señas Mexicana en Tiempo Real
- **Fecha:** 2026-11-08
- **Estado:** **Histórico / Reemplazado** — Instantánea previa a `fix-mediapipe` y `rearquitectura-demo`

> [!NOTE]
> Los archivos `mediapipe-worker.js`, `useMediaPipe.js` y `mediapipeEngine.js` auditados en este documento fueron **eliminados** posteriormente en `rearquitectura-demo` al migrar MediaPipe al hilo principal dentro de `SignEngine` (`expresat/frontend/src/engine/signEngine.js`). Para la arquitectura vigente, consulta [ARQUITECTURA.md](../ARQUITECTURA.md) y el [índice general](../README.md).

---

## 1. Resumen General

En el momento de la auditoría, el frontend implementaba detección holística con:
- **Web Worker** (`src/workers/mediapipe-worker.js`, *eliminado posteriormente*) ejecutando `@mediapipe/tasks-vision`.
- **Hook principal** (`src/hooks/useMediaPipe.js`, *eliminado posteriormente*) para cámara, ciclo de vida del Worker, suavizado EMA, dibujo y envío WebSocket.
- **Servicio API/WS** (`src/services/apiService.js`) hacia `/ws/translate`.
- **Componente principal** (`src/pages/Translator.jsx`).

**Problemas críticos detectados en esa revisión:** `ReferenceError` por `isDemo`, rechazo WebSocket 403, `FPS = 0`, fallos de carga WASM/modelos y desajustes cliente–servidor.

---

## 2. Auditoría Archivo por Archivo (Instantánea del 2026-11-08)

### `useMediaPipe.js` (`hooks`, *eliminado posteriormente*)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Alta** | **Watchdog de FPS reporta `0` si el Worker se detiene** | `fpsWatchdogRef` limpiaba el contador a los 2 s sin resultados, congelando FPS en `0`. | 95, 211–217 |
| **Media** | **Cámara transmite antes de `'ready'` del Worker** | `startCamera()` iniciaba primero, pero `requestVideoFrameCallback` esperaba `'ready'` desde el Worker; si fallaba, el video seguía activo con FPS `0`. | 138, 164 |
| **Media** | **Fallo en Worker detiene la cámara al limpiar** | Si el Worker fallaba (ej. WASM 404), el cleanup detenía el stream dejando pantalla sin cámara ni reintentos. | 142–154 |
| **Baja** | **Estado `isDemo` fuera del hook** | Gestionado directamente en `Translator.jsx`. | N/A |
| **Baja** | **Filtro EMA con `alpha = 0.45` fijo** | Sin validación adaptativa entre hardware o FPS dispares. | 64 |

### `mediapipeEngine.js` (`services`, *eliminado posteriormente*)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Alta** | **Uso de globales `window.Holistic` / `window.Camera` sin guardas** | Asumía disponibilidad en `window` antes de llamar `camera.start()`. | 37–52, 85–86 |
| **Alta** | **Alineación obligatoria de versión WASM CDN y `package.json`** | `WASM_URL` fijado a `@mediapipe/tasks-vision@1.0.1`; un desajuste provocaba `ModuleFactory not set`. | 37 |
| **Media** | **URLs de modelos dependientes solo de Google Storage** | Modelos `.task` sin copia o respaldo local. | 41, 44 |
| **Media** | **Sin aviso visual si falla carga de modelos** | El Worker enviaba `{ type: 'error' }` y el hook solo registraba en consola. | 111–113 |
| **Baja** | **Delegado `GPU` sin fallback explícito a `CPU`** | Podía fallar en navegadores o GPUs sin soporte WebGL estable. | 87, 98 |

### `landmarkTracker.js` (`services`)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Baja** | **Diferencias menores en `POSE_UPPER_INDICES` / conexiones** | Definiciones locales ligeramente distintas respecto a `useMediaPipe.js`. | 25–38 vs 28–34 |
| **Baja** | **Nombres divergentes para conexiones de mano** | `HAND_CONNECTIONS` vs `HAND_CONNECTIONS$1`. | 37 vs 41 |
| **Baja** | **Lógica compleja de color en `_drawPoseSegments`** | Mezcla de `colorByPart` y colores fijos. | 654–763 |
| **Baja** | **`validateSequence()` referencia `seq.empty`** | Uso no estándar en `Array` (evaluaba siempre a `false` en arreglos JS). | 383 |

### `apiService.js` (`services`)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Crítica** | **Rechazo WebSocket 403 / 1008 por token y origen** | Envío de `demo_fallback_token` o ausencia de token en producción frente a rechazo en backend. | 37–118 |
| **Crítica** | **Error tipográfico en origen CORS de backend** | `"https://ecpresatt.netlify.app"` vs `"https://expresat.netlify.app"` en `CORS_ORIGINS_DEFAULT`. | `main.py:51–58` |
| **Alta** | **Health check único sin reintentos** | Un cold-start del servidor dejaba estado `'status-offline'` sin backoff exponencial. | 78–85 |
| **Media** | **Normalización ambigua de rutas `ws://` / `wss://`** | Agregaba `/ws/translate` incluso si la URL base ya incluía ruta `/ws`. | 49–69 |
| **Baja** | **Envío periódico de `ping` JSON sin validación de estado previo** | Enviaba `{ type: 'ping' }` sin verificar handshake completo. | 99 |

### `Translator.jsx` (`pages`)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Crítica** | **`ReferenceError: isDemo is not defined`** | Referenciada en JSX/efectos sin inicialización garantizada en alcance de componente. | 21, 64–81, 782–801 |
| **Alta** | **Fallback con `demo_fallback_token` rechazado en producción** | Token espurio causaba cierre inmediato en el servidor. | 104–144 |
| **Alta** | **Contador FPS en `0` por bloqueo del bucle Worker** | Al no recibirse `'ready'`, nunca arrancaba el loop de captura. | 91–92, 187, 212–217 |
| **Media** | **Estilos del `<video>` oculto (`width: 0, height: 0, opacity: 0`)** | Riesgo de pausa o ausencia de decodificación de frames en ciertos motores WebKit. | 338–345 |
| **Baja** | **Estados complejos `usingDemoToken` y `authWarning`** | Múltiples ramas condicionales dependientes de `localStorage('apiEnv')` y variables globales. | 96–144 |
| **Baja** | **Procesamiento parcial de `msg.is_demo`** | Solo se evaluaba en ramas específicas de `onMessage`. | 169–171 |

### `mediapipe-worker.js` (*eliminado posteriormente*)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Crítica** | **Carga WASM sin propagación visible de errores** | Errores atrapados en `initialize()` sin notificación en interfaz. | 76–115 |
| **Crítica** | **Modelos dependientes exclusivamente de CDN remoto** | Sin modelos `.task` servidos desde `/public/models/`. | 40–44 |
| **Alta** | **`runningMode: 'VIDEO'` sensible a timestamps monotónicos** | Riesgo de saltos o errores si el reloj de entrada retrocede o se repite. | 89, 100, 127, 134 |
| **Media** | **Delegado GPU sin respaldo CPU** | Falla silenciosa o excepción en dispositivos sin GPU compatible. | 87, 98 |
| **Baja** | **Umbrales fijos en `0.5`** | Valores de detección/presencia iniciales pendientes de calibración. | 91–93, 102–103 |

---

## 3. Desajustes Cliente–Servidor Detectados en esa Revisión

| Hallazgo | Evidencia Histórica |
|---|---|
| **`demo_fallback_token` rechazado** | El cliente enviaba un token sintético rechazado en backend de producción. |
| **Origen CORS divergente** | `"https://ecpresatt.netlify.app"` frente a `"https://expresat.netlify.app"`. |
| **Riesgo de desfase WASM** | `@mediapipe/tasks-vision@1.0.1` debe coincidir entre bundle JS y archivos WASM. |
| **Invariante 178D** | Frontend, backend y generador requieren coincidir en `52 + 63 + 63` features. |
| **Protocolo de envío de token** | Diferencia entre mensaje WS `{ type: "auth", token }` y query param `?token=`. |

---

## 4. Resumen de Severidades y Evidencia Histórica

| Severidad | Cantidad |
|---|---|
| Crítica | 6 |
| Alta | 6 |
| Media | 10 |
| Baja | 7 |

**Prioridades originales reportadas:**
1. Corregir `ReferenceError` de `isDemo`.
2. Resolver rechazo WebSocket 403/1008 (auth + CORS).
3. Desbloquear bucle de inferencia (`FPS > 0`).
4. Garantizar carga local/fallback de WASM y modelos `.task`.
5. Unificar origen CORS y verificación de tokens en backend.
