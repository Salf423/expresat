# Auditoría MediaPipe — Backend (FastAPI)

- **Ámbito:** `expresat/backend/`
- **Proyecto:** ExpresaT — Traducción de Lengua de Señas Mexicana en Tiempo Real
- **Fecha:** 2026-11-08
- **Estado:** **Histórico / Superado** — Snapshot de auditoría previo a `fix-mediapipe` y `rearquitectura-demo`

> [!NOTE]
> Este documento registra el estado del backend **antes** de las correcciones aplicadas en `fix-mediapipe` y `rearquitectura-demo`. El manejo actual de `EXPRESAT_DEMO_MODE`, `verify_supabase_token` y `CORS_ORIGINS_DEFAULT` vive en [`expresat/backend/main.py`](../../expresat/backend/main.py) y [`expresat/backend/config.py`](../../expresat/backend/config.py). Consulta también el [índice general](../README.md).

---

## 1. Resumen General

El backend provee:
- **Endpoint WebSocket** `/ws/translate` para recibir lotes de landmarks MediaPipe.
- **Autenticación JWT** vía Supabase (`verify_supabase_token`).
- **Endpoints de salud** `/health` y `/`.
- **Motor de inferencia** (ONNX Runtime CPU o reglas geométricas deterministas en modo demo).
- **Modo demo** controlado mediante `EXPRESAT_DEMO_MODE` (`DEMO_MODE`).

**Problemas críticos detectados en esa revisión:** rechazo masivo de tokens (`403` percibido / `1008` WS), error tipográfico en CORS, bloque de verificación en producción comentado y configuración ambigua de `DEMO_MODE`.

---

## 2. Auditoría Archivo por Archivo (Instantánea del 2026-11-08)

### `main.py` (servidor principal)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Crítica** | **Bloque de verificación de token comentado** | `verify_supabase_token()` tenía comentado el bloque de producción, retornando `None` para cualquier token y provocando cierre WebSocket `1008` (`Invalid or missing token`). | 252–285 |
| **Crítica** | **Error tipográfico en origen CORS** | `CORS_ORIGINS_DEFAULT` contenía `"https://ecpresatt.netlify.app"` en lugar de `"https://expresat.netlify.app"`, bloqueando solicitudes del dominio correcto en Netlify. | 51–59 |
| **Alta** | **`DEMO_MODE` dependiente de variable sin definir en producción** | `os.getenv("EXPRESAT_DEMO_MODE", "false")`: si la variable faltaba en Render, asumía `false` exigiendo modelo ONNX real y tokens JWT. *(En el código actual, el valor por defecto pasó a `"true"`.)* | `config.py:19`, `main.py:91–96` |
| **Alta** | **Endpoint WebSocket rechaza ausencia o invalidez de token** | `websocket_translate()` cerraba con código `1008` al recibir `user = None` desde `verify_supabase_token(token)`. | 290–322 |
| **Media** | **Health check ejecutado una sola vez al conectar** | El frontend antiguo (`ApiService`) consultaba `/health` una única vez sin reintentos ante cold-start. | 436–447 |
| **Media** | **`/health` expone bandera `demo_mode`** | `/health` retorna `"demo_mode": DEMO_MODE`, por lo que cualquier desajuste con env vars desincronizaba la UI. | 436–477 |
| **Baja** | **Carga silenciosa en modo mock ante fallo de modelo** | Si `lifespan` capturaba `FileNotFoundError` o `Exception`, dejaba `_inference_engine = None` y continuaba en modo mock. | 100–125 |
| **Baja** | **Tamaño de buffer coincidente con frontend** | `ConnectionManager.frame_buffer` usaba `deque(maxlen=15)`, alineado con la ventana de 15 frames. | 166 |

### `config.py` (configuración global)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Alta** | **Default de `DEMO_MODE` sensible a ausencia de env var** | Sin `EXPRESAT_DEMO_MODE` en producción, `DEMO_MODE` quedaba en `false`, causando discrepancia entre `/health` y el modo demo del cliente. | 19 |
| **Baja** | **Falta de validación/aviso ante cambios de modo** | Comentarios documentaban el uso de la variable, pero sin advertencia estructurada al arrancar. | 1–19 |

### `demo_rules.py` (reglas deterministas de demo)

| Severidad | Hallazgo | Evidencia | Líneas |
|---|---|---|---|
| **Baja** | **Reglas geométricas preliminares aisladas** | Fallback determinista cuando `DEMO_MODE=True`; requiere mantenerse compatible con el formato esperado desde el cliente. | Archivo completo |
| **Media** | **Formato de entrada distinto al tensor ONNX** | `predict_demo()` opera por reglas geométricas sobre diccionarios de landmarks y no sobre el tensor `(1, 15, 178)`. | Archivo completo |

### `websockets_handler.py` (manejador WebSocket legado)

| Severidad | Hallazgo | Evidencia | Líneas |
|---|---|---|---|
| **Baja** | **Lógica duplicada y deprecada** | Coexiste con `/ws/translate` en `main.py` *(marcado posteriormente con `DeprecationWarning` para compatibilidad legacy)*. | Archivo completo |
| **Baja** | **Sin verificación de token** | No valida tokens JWT si llegase a invocarse directamente. | Archivo completo |

### `test_demo_rules.py` y `test_api_integration.py` (pruebas)

| Severidad | Hallazgo | Evidencia | Líneas |
|---|---|---|---|
| **Baja** | **Cobertura parcial en pruebas originales** | No validaban aún compatibilidad completa 178D ni todos los escenarios de handshake WS con/sin token en `/ws/translate`. *(Ampliado posteriormente en [`expresat/backend/test_api_integration.py`](../../expresat/backend/test_api_integration.py).)* | Archivos completos |

---

## 3. Desajustes Cliente–Servidor Detectados en esa Revisión

| Hallazgo | Evidencia Histórica |
|---|---|
| **Cliente enviaba `demo_fallback_token` o `null`** | El cliente sin token fallaba frente a un backend donde `verify_supabase_token` retornaba `None` para cualquier token en producción. |
| **Error tipográfico de origen CORS** | `"https://ecpresatt.netlify.app"` frente a `"https://expresat.netlify.app"`. |
| **Invariante del pipeline de 178 features** | Ambos lados deben coincidir en pose (52) + mano izquierda (63) + mano derecha (63). |
| **Estrategia de envío de token** | El frontend antiguo enviaba `{ type: "auth", token }` tras abrir conexión mientras el backend validaba `?token=` en query params durante el handshake. |
| **Bandera `demo_mode` en `/health`** | Desalineación entre `EXPRESAT_DEMO_MODE` en servidor y expectativas de la interfaz. |

---

## 4. Resumen de Severidades y Evidencia Histórica

| Severidad | Cantidad |
|---|---|
| Crítica | 3 |
| Alta | 3 |
| Media | 3 |
| Baja | 5 |

**Orden de prioridad original:**
1. Habilitar verificación real de token en producción dentro de `verify_supabase_token()`.
2. Corregir orígenes permitidos de CORS (`ecpresatt` / `expresat`).
3. Ajustar configuración por defecto de `EXPRESAT_DEMO_MODE`.
4. Garantizar compatibilidad del pipeline de 178 features entre cliente y servidor.
5. Agregar reintentos en `/health` y manejo explícito de errores al cargar `InferenceEngine`.

**Notas de evidencia del snapshot:**
- **Verificación de token comentada:** `main.py` líneas 272–280 devolvían siempre `None` en producción (cierre `1008`).
- **CORS:** `main.py` línea 58 incluía `"https://ecpresatt.netlify.app"`.
- **Síntoma HTTP 403 vs WS 1008:** El cliente observaba desconexión equivalente a rechazo 403 aunque el cierre del protocolo WebSocket era `1008`.
