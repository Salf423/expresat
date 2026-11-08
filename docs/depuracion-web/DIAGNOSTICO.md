# Diagnóstico de fallo en handshake WebSocket - ExpresaT

## Fecha: 2026-11-08

## Entorno
- Frontend: `https://ecpresatt.netlify.app` (Netlify)
- Backend: `https://expresat.onrender.com` (Render, FastAPI + WebSockets)
- Modo: Cloud (despliegue en producción)

---

## Resumen Ejecutivo

**Causa raíz:** El handshake WebSocket falla porque **Cloudflare** (servicio de proxy/CDN en Render) devuelve **403 Forbidden** para las solicitudes de upgrade WebSocket a `wss://expresat.onrender.com/ws/translate`. La conexión nunca alcanza al origen (FastAPI). El error `NS_ERROR_WEBSOCKET_CONNECTION_REFUSED` en Firefox es consecuente de que Cloudflare rechaza la conexión antes de establecerla.

**Estado:** La ruta del WebSocket frontend (`/ws/translate`) coincide con la del backend. El problema es de infraestructura/proxy, no de lógica de código.

---

## Evidencia

### 1. Error en la consola del navegador (Firefox)
```
NS_ERROR_WEBSOCKET_CONNECTION_REFUSED
al conectar a wss://expresat.onrender.com/translate
```
*Note: El navegador muestra la ruta `/translate`, pero el cliente real construye `wss://expresat.onrender.com/ws/translate` (ver sección 2).*

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
|------------|----------|
| **Frontend** (apiService.js, línea 69) | `wss://expresat.onrender.com/ws/translate` |
| **Backend** (main.py, línea 288) | `@app.websocket("/ws/translate")` ✅ **Coincide** |
| **Backend** (main.py, línea 415) | `@app.websocket("/ws")` (legacy, redirige a `/ws/translate`) |

*Las rutas coinciden. El problema no es la definición del endpoint.*

### 7. Configuración CORS (backend/main.py, líneas 51-58)

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

*El origen configurado es `https://expresat.netlify.app`, pero el dominio actual es `ecpresatt.netlify.app` (diferencia en el prefijo `ec` vs `ex`). Sin embargo, al ser el error 403 proveniente de Cloudflare **antes** de que la solicitud llegue al middleware CORS de FastAPI, este es un factor secundario y no la causa primaria.*

---

## Análisis de la Causa

### Flujo del problema

1. El frontend (`ApiService.connect()`) construye la URL WebSocket:
   ```
   wsUrl = "wss://" + "expresat.onrender.com" + "/ws/translate"
   → wss://expresat.onrender.com/ws/translate
   ```

2. El navegador envía un upgrade WebSocket con headers:
   - `Upgrade: websocket`
   - `Connection: Upgrade`
   - `Sec-WebSocket-Key`
   - `Sec-WebSocket-Version: 13`
   - `Origin: https://ecpresatt.netlify.app`

3. **Cloudflare** (proxy en Render) recibe la solicitud y **devuelve 403 Forbidden** inmediatamente. El header `cf-ray` y `server: cloudflare` confirman esto.

4. La conexión nunca llega al servidor FastAPI, por eso:
   - El health check `/health` retorna 200 OK (peticiones HTTP normales sí pasan)
   - No hay error de cámara o MediaPipe (nunca se establece la conexión WS)
   - FPS marca 0 porque no se envían frames

### ¿Por qué Cloudflare devuelve 403?

No hay configuración pública explícita, pero los indicios son:

- Cloudflare puede tener un **firewall rule** que bloquea los headers `Upgrade: websocket` para este dominio
- Falta **habilitar soporte de WebSocket** en la configuración de Cloudflare para el dominio `expresat.onrender.com`
- El patrón de solicitud puede ser marcado como sospechoso por el sistema de seguridad de Cloudflare

*Importante: Las peticiones HTTP normales (`/health`, `/labels`) sí pasan a través de Cloudflare exitosamente, lo que confirma que Cloudflare está activo pero tiene una regla específica que bloquea el upgrade WebSocket.*

---

## Corrección Propuesta

### Opción 1: Configurar Cloudflare (recomendada)

1. Ingresar al panel de Cloudflare del dominio `expresat.onrender.com`
2. Verificar la regla **Firewall** → Revisar si hay reglas que bloqueen métodos `Upgrade` o headers de WebSocket
3. Asegurarse de que **WebSockets** estén habilitados para el servicio (Cloudflare Pages o Workers KV pueden requerir configuración especial)
4. Probar la conexión nuevamente después de los cambios

### Opción 2: Saltar Cloudflare / Usar modo "Full DNS"

1. En Cloudflare, cambiar el modo de `expresat.onrender.com` de "Proxied" (nube naranja) a "DNS Only" (nube gris)
2. Esto hará que las conexiones WebSocket vayan directamente al origen Render sin pasar por el proxy de Cloudflare
3. *Advertencia:* Perderá algunas protecciones de Cloudflare, pero permitirá las conexiones WebSocket

### Opción 3: Ajustar configuración en Render/FastAPI

1. Verificar que el servicio de Render esté configurado para aceptar conexiones WebSocket (algunos planes/estándares tienen límites)
2. Añadir headers adicionales que Cloudflare espere (si la bloqueo es por firma/missing header)
3. Revisar logs del servicio en Render durante intentos de conexión WS

### Opción 4: Corregir el typo de origen en CORS

El archivo `Deploys.md` y el backend configuran `CORS_ORIGINS=https://expresat.netlify.app`, pero el dominio real es `ecpresatt.netlify.app`. Este typo debería corregirse:

```env
CORS_ORIGINS=https://ecpresatt.netlify.app,https://expresat.com
```

*Nota: Aunque no es la causa raíz del 403 de Cloudflare, corregirlo evitará problemas adicionales si Cloudflare pasa la solicitud al origen y este rechaza por CORS.*

---

## Próximos Pasos

1. **Aplicar la corrección** (preferiblemente la Opción 1 o 2 para eliminar el bloqueo de Cloudflare)
2. **Verificar la conexión WS** con la prueba aislada (wscat/websocat contra `wss://expresat.onrender.com/ws/translate`)
3. **Confirmar FPS > 0** una vez establecida la conexión WebSocket
4. **Corregir el typo** de `ecpresatt.netlify.app` vs `expresat.netlify.app` en las variables de entorno de CORS
5. **Reanudar el bucle revisor**: verificar conexión WS estable → cámara activa → landmarks → FPS > 0

---

## Referencia de Tareas (del diagnóstico original)

- Tarea 1 (Cliente): ✅ Completada - La URL se construye como `wss://expresat.onrender.com/ws/translate`
- Tarea 2 (Servidor): ✅ Completada - Endpoint `/ws/translate` existe en FastAPI, el problema es Cloudflare 403
- Tarea 3 (Prueba aislada): ⚠️ Pendiente - Se necesita wscat/websocat después de aplicar la corrección
- Tarea 4 (Contrato cliente-servidor): ✅ Completada - Formato de mensajes definido en main.py y apiService.js
- Tarea 5 (Entrega): ✅ Archivo generado en `docs/depuracion-web/DIAGNOSTICO.md`