---
title: "Explicación del Código: Servidor Backend Asíncrono (Python / FastAPI)"
description: "Desglose técnico exhaustivo de expresat/backend/main.py: ConnectionManager, ciclo de vida lifespan, inferencia desacoplada vía asyncio.to_thread, autenticación Supabase JWT y validación estricta de Origin."
version: "2.3.0"
category: "Código / Backend Python"
status: "Producción"
target_agents: ["backend-architect", "fastapi-pro", "async-python-patterns", "security-auditor"]
recommended_skills:
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`fastapi-pro`, `async-python-patterns`, `api-design-principles`)"
  - "[[../../Skills/Auditoria_Seguridad_y_Calidad|Auditoria_Seguridad_y_Calidad]] (`backend-security-coder`, `security-auditor`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Websocket]]"
  - "[[Main C++]]"
  - "[[../../Flujo de datos]]"
  - "[[../../Caracteristicas]]"
  - "[[../../Deploys]]"
---

# 🐍 Explicación del Código: Servidor Backend Asíncrono (Python / FastAPI)

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Backend** > **Python FastAPI**

El backend central de **ExpresaT** (`expresat/backend/main.py`) implementa un servicio asíncrono con **FastAPI** y **Uvicorn**, diseñado específicamente para mantener conexiones de WebSocket persistentes de ultra-baja latencia con múltiples clientes de forma simultánea.

---

## 1. Decisiones Arquitectónicas Clave

1. **FastAPI ASGI & Corrutinas:** Reducción drástica de la sobrecarga de memoria por cliente conectado, permitiendo atender decenas de conexiones concurrentes en instancias de 512 MB de RAM.
2. **Ciclo de Vida `lifespan` (FastAPI 0.109+):** Carga del modelo ONNX cuantizado una única vez al arrancar (`InferenceEngine` Singleton), liberando recursos ordenadamente al apagar.
3. **Inferencia en Hilo Desacoplado (`asyncio.to_thread`):** La llamada a ONNX Runtime es CPU-bound. Invocarse directamente en la corrutina asíncrona congelaría el bucle de eventos (`event loop`) para todos los demás clientes. Se delega a un worker pool de hilos sin serialización inter-proceso.
4. **Buffer con Límite Fijo (`collections.deque(maxlen=15)`):** Evita fugas de memoria por acumulación ilimitada de frames en clientes que transmiten en Stream Mode.
5. **Mitigaciones de Seguridad (Auditoría Opencode):**
   - Validación estricta de la cabecera `Origin` en el handshake con código de cierre **1008 (Policy Violation)**.
   - Verificación de tokens JWT contra la API de Supabase en producción.
   - Evaluación booleana robusta de `DEMO_MODE`.

---

## 2. Organización del Código (`expresat/backend`)

| Archivo | Rol en el Sistema | Estado |
|---|---|---|
| **`main.py`** | Punto de entrada ASGI, endpoints REST (`/health`, `/labels`, `/`), endpoint WebSocket `/ws/translate` y gestión de conexiones. | **Producción** |
| **`config.py`** | Parseo y tipado de variables de entorno, configuración de orígenes CORS y banderas de modo demo. | **Producción** |
| **`demo_rules.py`** | Motor heurístico determinista para validación geométrica sin servidor en desarrollo. | **Producción / Fallback** |
| **`test_api_integration.py`** | Suite de pruebas de integración para endpoints REST y WebSocket. | **Tests** |
| **`websockets_handler.py`** | Implementación histórica (vector de 225D). | **Deprecado / No Usado** |

---

## 3. Análisis Detallado de Fragmentos de Código

### A. Inicialización con Lifespan y Carga del Singleton
```python
# En expresat/backend/main.py
_inference_engine = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _inference_engine
    print("ExpresaT Backend — Starting server...")
    
    try:
        from models.inference_engine import InferenceEngine
        model_path = os.path.abspath(MODEL_DIR)
        
        # Carga del modelo ONNX una única vez en memoria
        _inference_engine = InferenceEngine(
            model_dir=model_path,
            confidence_threshold=CONFIDENCE_THRESHOLD
        )
        print(f"Inference engine ready. Classes: {_inference_engine.labels}")
    except Exception as e:
        print(f"Error loading inference engine: {e}. Server will start in MOCK mode.")
        _inference_engine = None

    yield  # El servidor procesa solicitudes aquí

    # Limpieza al apagar
    _inference_engine = None
    print("Resources released.")

app = FastAPI(title="ExpresaT API V2", lifespan=lifespan)
```

### B. Gestor de Conexiones Concurrente (`ConnectionManager`)
```python
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        # Deque acotado a 15 elementos para streaming cuadro a cuadro
        self.frame_buffer: collections.deque = collections.deque(maxlen=15)

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_personal(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)
```

### C. Inferencia No Bloqueante Desacoplada
```python
async def run_inference_async(frames: list[dict]) -> dict:
    if is_demo_mode_enabled():
        # Modo demo: cálculo de reglas deterministas en hilo secundario
        return await asyncio.to_thread(predict_demo, frames)

    engine = get_inference_engine()
    if engine is None:
        return {"label": None, "confidence": 0.0, "mock": True, "error": "Model not loaded"}

    # Offload de inferencia ONNX a hilo secundario (evita congelar event loop)
    return await asyncio.to_thread(engine.predict, frames)
```

### D. Endpoint WebSocket `/ws/translate` con Validación de Origen y JWT
```python
@app.websocket("/ws/translate")
async def websocket_translate(websocket: WebSocket, token: str = Query(None)):
    origin = websocket.headers.get("origin")
    
    # 1. Comprobación estricta de Origin contra lista blanca
    if not is_origin_allowed(origin):
        reason = f"Origin no autorizado: {origin}"
        print(f"[WS REJECT] {reason} | closing code=1008")
        await websocket.close(code=1008, reason=reason)
        return

    # 2. Verificación de token Supabase
    user = verify_supabase_token(token)
    if not user and os.getenv("ENVIRONMENT") == "production":
        await websocket.close(code=1008, reason="Token de autenticación inválido")
        return

    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "inference":
                payload = data.get("payload", [])
                # Procesa lote de 15 frames
                result = await run_inference_async(payload)
                await manager.send_personal({"type": "translation", "payload": result}, websocket)

            elif msg_type == "ping":
                await manager.send_personal({"type": "pong"}, websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
```

---

## 🤖 Guía de Operación para Agentes Backend

1. **Nunca invocar `engine.predict` de forma síncrona** dentro de rutas asíncronas (`async def`). Siempre envolver en `await asyncio.to_thread(...)`.
2. **Ejecutar Uvicorn con `--workers 1`** en entornos con poca memoria para evitar duplicar el grafo ONNX en múltiples procesos.
3. **Verificar orígenes permitidos** en `CORS_ORIGINS` antes de realizar pruebas de integración con el frontend.
4. **Ejecutar tests de integración:**
   ```bash
   pytest expresat/backend/test_api_integration.py -v
   ```
