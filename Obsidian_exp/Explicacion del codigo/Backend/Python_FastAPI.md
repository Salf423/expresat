---
title: "Explicación del Código: Servidor Backend Asíncrono (Python / FastAPI)"
description: "Desglose técnico del servidor central: ConnectionManager, streaming por WebSockets, integración con ONNX Runtime y concurrencia no bloqueante."
version: "2.0.0"
category: "Código / Backend Python"
status: "Producción"
target_agents: ["backend-architect", "fastapi-pro", "async-python-patterns"]
recommended_skills:
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`fastapi-pro`, `async-python-patterns`)"
  - "[[../../Skills/Auditoria_Seguridad_y_Calidad|Auditoria_Seguridad_y_Calidad]] (`backend-security-coder`, `security-auditor`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Websocket]]"
  - "[[Main C++]]"
  - "[[../../Flujo de datos]]"
  - "[[../../Caracteristicas]]"
---

# 🐍 Explicación del Código: Servidor Backend Asíncrono (Python / FastAPI)

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Backend** > **Python FastAPI**

El backend central de **ExpresaT** (`expresat/backend`) implementa un servicio asíncrono con **FastAPI** y **Uvicorn**, diseñado específicamente para mantener conexiones de WebSocket de baja latencia con múltiples clientes de forma simultánea.

---

## 1. Conceptos Clave

- **FastAPI ASGI:** Arquitectura basada en corrutinas asíncronas de Python (`async`/`await`), reduciendo drásticamente la sobrecarga de memoria por cliente conectado.
- **Inferencia en ThreadPool Desacoplado:** Para evitar que la llamada CPU-bound a ONNX Runtime congele el bucle de eventos, la predicción se ejecuta mediante `asyncio.to_thread`.
- **CORS Configurado:** Control estricto de orígenes permitidos para habilitar la comunicación segura con el frontend web.

---

## 2. Organización del Código (`expresat/backend`)

1. **`main.py`:** Punto de entrada de la aplicación.
   - Configuración del ciclo de vida (`lifespan`) para cargar el modelo ONNX una única vez en memoria (Patrón Singleton).
   - Definición de endpoints REST (`/health`, `/labels`).
   - Endpoint WebSocket `/ws/translate` para recepción de lotes de landmarks.
2. **`websockets_handler.py`:** Administrador de conexiones y despachador de eventos de socket.
3. **`requirements.txt`:** Dependencias esenciales: `fastapi`, `uvicorn`, `onnxruntime`, `numpy`, `pydantic`.

---

## 3. Fragmentos Clave de Código

### Inicialización con Lifespan y Carga del Modelo
```python
# En main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from models.inference_engine import InferenceEngine

engine = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    # Cargar modelo ONNX cuantizado una sola vez al arrancar el servidor
    engine = InferenceEngine(model_dir="./models/exported_model", confidence_threshold=0.50)
    print(f"Modelo cargado exitosamente. Clases: {len(engine.labels)}")
    yield
    print("Limpieza al apagar el servidor.")

app = FastAPI(title="ExpresaT API", lifespan=lifespan)
```

### Manejador WebSocket con Inferencia No Bloqueante
```python
# En main.py
@app.websocket("/ws/translate")
async def websocket_translate(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "inference":
                frames = data.get("payload", [])
                # Ejecución desacoplada del event loop
                result = await asyncio.to_thread(engine.predict, frames)
                await websocket.send_json({"type": "translation", "payload": result})
            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
```

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Desarrollo y Rutas Asíncronas:** Invocar **`fastapi-pro`** y **`async-python-patterns`** (ver [[../../Skills/Backend_APIs_y_Sistemas]]).
- **Para Auditoría de Seguridad e Inyección:** Invocar **`backend-security-coder`** (ver [[../../Skills/Auditoria_Seguridad_y_Calidad]]).
- **Para Perfilado de Memoria y CPU:** Invocar **`python-performance-optimization`**.
