"""
main.py — ExpresaT: Servidor FastAPI con WebSocket para Traducción en Tiempo Real
==================================================================================
Servidor de producción que gestiona:
  - Endpoint WebSocket /ws/translate para recepción de lotes de landmarks
  - Pipeline asíncrono de inferencia (no bloquea el event loop)
  - Autenticación JWT vía Supabase
  - Health checks y métricas de latencia

Ejecución:
    uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1

    NOTA: --workers 1 porque el modelo ONNX se carga una sola vez en memoria.
    Para escalar horizontalmente, usar múltiples instancias detrás de un load balancer.
"""

import asyncio
import os
import sys
import time
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

# Agregar la ruta del proyecto para imports relativos
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# =============================================================================
# VARIABLES DE ENTORNO
# =============================================================================

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://your-project.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "your-service-role-key-or-anon")
MODEL_DIR = os.getenv("MODEL_DIR", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "models", "exported_model"
))
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.5"))


# =============================================================================
# INFERENCE ENGINE — Singleton (se carga una vez al iniciar el servidor)
# =============================================================================

# Referencia global al motor de inferencia
_inference_engine = None


def get_inference_engine():
    """Getter para acceder al motor de inferencia desde cualquier handler."""
    global _inference_engine
    return _inference_engine


# =============================================================================
# LIFESPAN — Inicialización y limpieza del servidor
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Gestiona el ciclo de vida del servidor.
    Se ejecuta al iniciar (startup) y al apagar (shutdown).

    Decisión: Usamos lifespan en lugar de @app.on_event porque
    on_event está deprecated desde FastAPI 0.109+
    """
    global _inference_engine

    print("\n" + "=" * 60)
    print("  🚀 ExpresaT Backend — Iniciando servidor...")
    print("=" * 60)

    # --- Cargar motor de inferencia ---
    try:
        from models.inference_engine import InferenceEngine

        model_path = os.path.abspath(MODEL_DIR)
        print(f"\n  📂 Modelo: {model_path}")

        _inference_engine = InferenceEngine(
            model_dir=model_path,
            confidence_threshold=CONFIDENCE_THRESHOLD
        )

        engine_info = _inference_engine.get_info()
        print(f"  📊 Motor: {engine_info['engine']}")
        print(f"  📦 Modelo: {engine_info['model_file']} ({engine_info['model_size_kb']} KB)")
        print(f"  🏷️  Clases: {engine_info['num_classes']}")
        print(f"  ✅ Motor de inferencia listo.\n")

    except FileNotFoundError as e:
        print(f"\n  ⚠️  ADVERTENCIA: {e}")
        print(f"  ⚠️  El servidor arrancará en modo MOCK (sin modelo real).\n")
        _inference_engine = None

    except Exception as e:
        print(f"\n  ❌ Error cargando motor de inferencia: {e}")
        print(f"  ⚠️  El servidor arrancará en modo MOCK.\n")
        _inference_engine = None

    yield  # El servidor está corriendo aquí

    # --- Shutdown ---
    print("\n  🛑 ExpresaT Backend — Apagando...")
    _inference_engine = None
    print("  ✓ Recursos liberados.\n")


# =============================================================================
# APLICACIÓN FASTAPI
# =============================================================================

app = FastAPI(
    title="ExpresaT API V2",
    description="Backend de traducción de Lengua de Señas en tiempo real",
    version="2.0.0",
    lifespan=lifespan
)

# CORS — En producción, restringir a los dominios de Netlify
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# CONNECTION MANAGER — Gestión de WebSockets activos
# =============================================================================

class ConnectionManager:
    """
    Gestiona las conexiones WebSocket activas.
    Thread-safe para múltiples conexiones concurrentes.
    """

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"  🔗 Cliente conectado. Total activos: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        print(f"  🔌 Cliente desconectado. Total activos: {len(self.active_connections)}")

    async def send_personal(self, message: dict, websocket: WebSocket):
        """Envía un mensaje JSON a un cliente específico."""
        await websocket.send_json(message)


manager = ConnectionManager()


# =============================================================================
# THREAD POOL EXECUTOR — Para offload de inferencia síncrona
# =============================================================================

# asyncio.to_thread() usará este executor internamente
# Esto evita que la inferencia ONNX (síncrona) bloquee el event loop de asyncio

async def run_inference_async(frames: list[dict]) -> dict:
    """
    Ejecuta la inferencia en un thread separado para no bloquear el event loop.

    Decisión de diseño: Usamos asyncio.to_thread() en lugar de
    ProcessPoolExecutor porque:
      1. El modelo ONNX ya es thread-safe internamente
      2. Evita serialización/deserialización de datos entre procesos
      3. Menor overhead de memoria (no duplica el modelo)
      4. Suficiente para modelos ultra-ligeros (< 10ms de inferencia)

    Para modelos más pesados, considerar ProcessPoolExecutor.
    """
    engine = get_inference_engine()

    if engine is None:
        # Modo mock cuando no hay modelo cargado
        return _mock_inference(frames)

    # Offload la inferencia síncrona a un thread del pool
    result = await asyncio.to_thread(engine.predict, frames)
    return result


def _mock_inference(frames: list[dict]) -> dict:
    """
    Inferencia mock para desarrollo/testing cuando no hay modelo entrenado.
    Simula una predicción con latencia realista.
    """
    import random

    mock_labels = ["hola", "gracias", "por_favor", "adios", "si", "no"]
    label = random.choice(mock_labels)

    return {
        "label": label,
        "confidence": round(random.uniform(0.6, 0.99), 4),
        "latency_ms": round(random.uniform(1.0, 5.0), 2),
        "all_probabilities": {label: 0.85},
        "mock": True
    }


# =============================================================================
# SUPABASE AUTH — Verificación de JWT
# =============================================================================

def verify_supabase_token(token: str) -> Optional[dict]:
    """
    Verifica un JWT token de Supabase.

    En producción: descomentar la verificación real con el cliente Supabase.
    En desarrollo: acepta cualquier token no vacío.
    """
    if not token:
        return None

    # --- PRODUCCIÓN: Descomentar este bloque ---
    # try:
    #     from supabase import create_client
    #     supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    #     user = supabase_client.auth.get_user(token)
    #     if user and user.user:
    #         return {"id": user.user.id, "email": user.user.email}
    #     return None
    # except Exception:
    #     return None

    # --- DESARROLLO: Aceptar cualquier token ---
    return {"id": "dev-user", "email": "dev@expresat.local"}


# =============================================================================
# WEBSOCKET ENDPOINT — /ws/translate
# =============================================================================

@app.websocket("/ws/translate")
async def websocket_translate(websocket: WebSocket, token: str = Query(None)):
    """
    Endpoint WebSocket principal para traducción de señas en tiempo real.

    Protocolo de mensajes:
        Cliente → Servidor:
            {"type": "ping"}
            {"type": "inference", "payload": [frame1, frame2, ..., frame15]}
            {"type": "inference", "payload": single_frame_dict}

        Servidor → Cliente:
            {"type": "pong"}
            {"type": "translation", "payload": {...}}
            {"type": "error", "payload": "mensaje de error"}

    El endpoint soporta dos modos de envío:
      1. Batch mode: El frontend envía 15 frames de golpe (óptimo)
      2. Stream mode: El frontend envía frame por frame y el backend
         acumula internamente hasta tener 15 (compatible con versión anterior)
    """
    # --- Verificar autenticación ---
    user = verify_supabase_token(token)
    if not user:
        await websocket.close(code=1008, reason="Token inválido o faltante")
        return

    # --- Aceptar conexión ---
    await manager.connect(websocket)

    # Buffer de frames para modo stream (acumulación frame-a-frame)
    frame_buffer: list[dict] = []

    try:
        while True:
            # Recibir mensaje JSON del cliente
            data = await websocket.receive_json()
            msg_type = data.get("type")

            # ----- PING/PONG para latencia -----
            if msg_type == "ping":
                await manager.send_personal({"type": "pong"}, websocket)

            # ----- INFERENCIA -----
            elif msg_type == "inference":
                payload = data.get("payload")

                if payload is None:
                    await manager.send_personal({
                        "type": "error",
                        "payload": "Payload vacío en mensaje de inferencia"
                    }, websocket)
                    continue

                # Detectar modo: batch (lista de frames) vs stream (frame individual)
                if isinstance(payload, list):
                    # ===== BATCH MODE =====
                    # El frontend envió un lote completo de 15 frames
                    frames_to_process = payload

                elif isinstance(payload, dict):
                    # ===== STREAM MODE (retrocompatible) =====
                    # El frontend envía un frame a la vez
                    frame_buffer.append(payload)

                    # Mantener buffer en máximo SEQUENCE_LENGTH frames
                    if len(frame_buffer) > 15:
                        frame_buffer = frame_buffer[-15:]

                    # Solo inferir cuando tenemos el buffer lleno
                    if len(frame_buffer) < 15:
                        continue

                    frames_to_process = frame_buffer.copy()
                    frame_buffer.clear()

                else:
                    await manager.send_personal({
                        "type": "error",
                        "payload": "Formato de payload inválido"
                    }, websocket)
                    continue

                # --- Ejecutar inferencia asíncrona ---
                try:
                    result = await run_inference_async(frames_to_process)

                    # Solo enviar traducción si la confianza supera el threshold
                    if result.get("label") is not None:
                        await manager.send_personal({
                            "type": "translation",
                            "payload": result
                        }, websocket)

                except Exception as e:
                    print(f"  ❌ Error en inferencia: {e}")
                    await manager.send_personal({
                        "type": "error",
                        "payload": f"Error en inferencia: {str(e)}"
                    }, websocket)

            # ----- MENSAJE DESCONOCIDO -----
            else:
                await manager.send_personal({
                    "type": "error",
                    "payload": f"Tipo de mensaje desconocido: {msg_type}"
                }, websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"  ❌ WebSocket error: {e}")
        manager.disconnect(websocket)


# =============================================================================
# ENDPOINT LEGACY — /ws (retrocompatibilidad con frontend existente)
# =============================================================================

@app.websocket("/ws")
async def websocket_legacy(websocket: WebSocket, token: str = Query(None)):
    """
    Endpoint legacy que redirige al nuevo /ws/translate.
    Mantiene compatibilidad con el frontend existente que usa /ws.
    """
    # Reusar la misma lógica del endpoint principal
    await websocket_translate(websocket, token)


# =============================================================================
# REST ENDPOINTS — Health checks y utilidades
# =============================================================================

@app.get("/")
async def health_check():
    """Health check básico del servidor."""
    engine = get_inference_engine()
    return {
        "status": "ok",
        "service": "ExpresaT Backend V2",
        "model_loaded": engine is not None,
    }


@app.get("/health")
async def detailed_health():
    """Health check detallado con información del modelo."""
    engine = get_inference_engine()

    response = {
        "status": "healthy",
        "service": "ExpresaT Backend V2",
        "connections": len(manager.active_connections),
    }

    if engine:
        response["model"] = engine.get_info()
    else:
        response["model"] = {"status": "mock_mode", "reason": "Modelo no cargado"}

    return response


@app.get("/labels")
async def get_labels():
    """Retorna las etiquetas/señas que el modelo puede reconocer."""
    engine = get_inference_engine()
    if engine:
        return {"labels": engine.labels, "count": engine.num_classes}
    return {"labels": [], "count": 0, "message": "Modelo no cargado"}


# =============================================================================
# EJECUCIÓN DIRECTA
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")

    print(f"\n  🌐 Iniciando servidor en {host}:{port}")
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,          # Hot-reload en desarrollo
        log_level="info",
        ws_ping_interval=30,  # Ping automático cada 30s para mantener conexión
        ws_ping_timeout=10,   # Timeout de pong
    )
