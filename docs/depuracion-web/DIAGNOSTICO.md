# Diagnóstico de Fallo en Handshake WebSocket — ExpresaT

- **Fecha:** 2026-11-08
- **Estado:** **Histórico — Diagnóstico de incidente en despliegue Cloud**
- **Entorno evaluado:**
  - **Frontend:** `https://ecpresatt.netlify.app` (Netlify)
  - **Backend:** `https://expresat.onrender.com` (Render, FastAPI + WebSockets)
  - **Modo:** Cloud (despliegue en producción)

> [!NOTE]
> Incidente puntual de infraestructura/proxy documentado el 2026-11-08. Posteriormente, el código de [expresat/backend/main.py](../../expresat/backend/main.py) y [expresat/.env.example](../../expresat/.env.example) incorporó ambos dominios (`https://expresat.netlify.app` y `https://ecpresatt.netlify.app`) en `CORS_ORIGINS_DEFAULT`, y el cliente web pasó a usar [WSClient](../../expresat/frontend/src/transport/wsClient.js). Ver [README.md de docs](../README.md).

---

## Resumen Ejecutivo

**Causa raíz:** El handshake WebSocket falla porque **Cloudflare** (proxy/CDN frente a Render) devuelve **403 Forbidden** ante las solicitudes de actualización WebSocket (`Upgrade: websocket`) hacia `wss://expresat.onrender.com/ws/translate`. La petición no alcanza al servidor de origen (FastAPI); el error `NS_ERROR_WEBSOCKET_CONNECTION_REFUSED` en Firefox es consecuencia directa de ese rechazo previo.

**Conclusión de código:** La ruta WebSocket del cliente (`/ws/translate`) coincide con la del backend. El bloqueo proviene de infraestructura/proxy, no de incompatibilidad de rutas.

---

## Evidencia

### 1. Error en la consola del navegador (Firefox)
```text
NS_ERROR_WEBSOCKET_CONNECTION_REFUSED
al conectar a wss://expresat.onrender.com/translate
```
> [!NOTE]
> Firefox resume en pantalla la ruta final `/translate`, mientras el cliente solicita `wss://expresat.onrender.com/ws/translate` (véase §2).

### 2. Captura de red (pestaña Red, Firefox)
- `GET https://expresat.onrender.com/health` → **200 OK** (servicio vivo, HTTP funciona)
- `GET wss://expresat.onrender.com/translate` → **NS_ERROR_WEBSOCKET_CONNECTION_REFUSED** (handshake fallido)
- `GET wss://expresat.onrender.com/ws/translate` → **NS_ERROR_WEBSOCKET_CONNECTION_REFUSED** (handshake fallido)
- Los assets estáticos cargan correctamente, no hay 404 de modelos ni WASM.

### 3. Pruebas aisladas con curl (HTTP/1.1, con headers de WebSocket)

```
curl -i -N --http1.1 \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Host: expresat.onrender.com" \
  -H "Origin: https://ecpresatt.netlify.app" \
  -H "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
  -H "Sec-WebSocket-Version: 13" \
  https://expresat.onrender.com/ws/translate
```

**Resultado:**
```
HTTP/1.1 403 Forbidden
Date: Sun, 08 Nov 2026 17:57:08 GMT
Content-Type: text/plain; charset=utf-8
Transfer-Encoding: chunked
Connection: keep-alive
Vary: Origin
cf-cache-status: DYNAMIC
server: cloudflare
CF-RAY: a57674ed2c1846cc-DFW
...
```

**Análisis:** El cuerpo de la respuesta contiene `{"detail":"Not Found"}` (formato FastAPI), pero el **código de estatus HTTP es 403 Forbidden** y el header `server: cloudflare` confirma que Cloudflare está bloqueando la conexión. El request nunca llega al servidor FastAPI de Render.

### 4. Pruebas con la librería `websockets` (Python)

```
Probing wss://expresat.onrender.com/ws/translate (origin=None)...
Error: InvalidStatus: server rejected WebSocket connection: HTTP 403
```

Mismo resultado: el servidor rechaza el handshake con estatus HTTP 403.

### 5. Pruebas con HTTP/2 (curl sin --http1.1)

```
curl -i -N \
  -H "Host: expresat.onrender.com" \
  -H "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
  -H "Sec-WebSocket-Version: 13" \
  https://expresat.onrender.com/ws/translate
```

**Resultado:** `HTTP/1.1 404 Not Found` (Cloudflare no maneja el método CONNECT para WebSockets sobre HTTP/2, el request llega al origen que responde 404 porque no hay endpoint HTTP en esa ruta).

### 6. Endpoints WebSocket identificados

| Componente | Endpoint |
|---|---|
| **Frontend** (`apiService.js` histórico) | `wss://expresat.onrender.com/ws/translate` |
| **Backend** (`main.py`) | `@app.websocket("/ws/translate")` — **Coincide** |
| **Backend** (`main.py` ruta legacy) | `@app.websocket("/ws")` (redirección legacy hacia `/ws/translate`) |

> [!NOTE]
> Las rutas coinciden; el rechazo HTTP 403 descrito en este incidente provino del proxy antes del backend.

### 7. Configuración CORS (`backend/main.py`, estado durante el incidente)

```python
CORS_ORIGINS_DEFAULT = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://api.expresat.cloud",
    "https://expresat.netlify.app",
]
CORS_ORIGINS = os.getenv("CORS_ORIGINS", ",".join(CORS_ORIGINS_DEFAULT)).split(",")
```

*(Observación: durante el incidente, la lista incluía `https://expresat.netlify.app` mientras el frontend desplegado respondía desde `https://ecpresatt.netlify.app`. En el código actual, ambos dominios figuran en `CORS_ORIGINS_DEFAULT` dentro de [`expresat/backend/main.py`](../../expresat/backend/main.py).)*

---

## Análisis de la Causa

### Flujo del problema

1. El frontend histórico (`ApiService.connect()`) construía la URL `wss://expresat.onrender.com/ws/translate`.
2. El navegador enviaba un HTTP Upgrade con `Origin: https://ecpresatt.netlify.app`.
3. **Cloudflare** (proxy frente a Render) devolvía **403 Forbidden** (`server: cloudflare`, `cf-ray`) sin reenviar la conexión a FastAPI:
   - `/health` respondía `200 OK` (peticiones HTTP estándar permitidas).
   - No se establecía sesión WebSocket ni envío de frames.

### Posibles causas del bloqueo en Cloudflare
- Regla de Firewall/WAF bloqueando cabeceras `Upgrade: websocket`.
- Soporte de WebSockets deshabilitado para el subdominio/zona en la configuración de proxy.
- Regla de seguridad disparada por la firma del upgrade en la ruta.

---

## Acciones Recomendadas en el Incidente

1. **Configurar Cloudflare:** Revisar reglas WAF/Firewall para permitir `Upgrade: websocket` hacia `/ws/translate` y habilitar soporte WebSocket.
2. **Validar bypass/DNS (diagnóstico):** Comprobar temporalmente con modo DNS-Only si el bloqueo desaparece al ir directo al origen Render.
3. **Verificar servicio en Render y CORS:** Confirmar soporte de WebSockets en el plan/instancia y mantener sincronizada la variable `CORS_ORIGINS` (incluyendo los dominios activos de Netlify).
4. **Verificar tras el cambio:** Validar el handshake con `wscat` o `websocat` sobre `wss://expresat.onrender.com/ws/translate`.

---

## Referencia de Tareas (del diagnóstico de 2026-11-08)

- Tarea 1 (Cliente): **Completada** — Construcción correcta de `wss://expresat.onrender.com/ws/translate`.
- Tarea 2 (Servidor): **Completada** — Endpoint `/ws/translate` operativo en FastAPI.
- Tarea 3 (Prueba aislada en cloud): **Pendiente tras ajuste de infraestructura** — Validar handshake con `wscat`/`websocat` después de ajustar proxy/CORS.
- Tarea 4 (Contrato cliente-servidor): **Completada** — Alineado en `main.py` y transportes web.
- Tarea 5 (Entrega): **Completada** — Archivo generado en `docs/depuracion-web/DIAGNOSTICO.md`.
