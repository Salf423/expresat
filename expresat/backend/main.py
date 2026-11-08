#!/usr/bin/env python3
"""
main.py — ExpresaT: FastAPI Server with WebSocket
================================================================================
Production server that handles:
  - WebSocket endpoint /ws/translate for receiving batches of landmarks
  - Asynchronous inference pipeline (does not block the event loop)
  - JWT Authentication via Supabase
  - Health checks and latency metrics

Execution:
    uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1

    NOTE: --workers 1 because the ONNX model is loaded into memory only once.
    To scale horizontally, use multiple instances behind a load balancer.
"""

import asyncio
import os
import sys
import time
import json
import collections
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

# ── Import canonical configuration ─────────────────────────────────────────
# Import config y demo_rules de forma canónica, evitando fragilidad de sys.path.
# Se prefiere import directo del paquete backend en lugar de relajo sys.path.
try:
    from backend.config import DEMO_MODE
    from backend.demo_rules import predict_demo, DEMO_LABELS
except ImportError:
    from config import DEMO_MODE
    from demo_rules import predict_demo, DEMO_LABELS


# ── Environment Variables ────────────────────────────────────────────────────

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://your-project.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "your-service-role-key-or-anon")
MODEL_DIR = os.getenv("MODEL_DIR", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "models", "exported_model"
))
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.5"))

# CORS origins: whitelist segura por defecto, extensible vía variable de entorno
CORS_ORIGINS_DEFAULT = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://api.expresat.cloud",
    "https://expresat.netlify.app",
]
CORS_ORIGINS = os.getenv("CORS_ORIGINS", ",".join(CORS_ORIGINS_DEFAULT)).split(",")


# ── Inference Engine — Singleton ────────────────────────────────────────────

# Global reference to the inference engine
_inference_engine = None


def get_inference_engine():
    """Getter to access the inference engine from any handler."""
    global _inference_engine
    return _inference_engine


# ── LIFESPAN — Server initialization and cleanup ───────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manages the server lifecycle.
    Executes on startup and shutdown.

    Decision: We use lifespan instead of @app.on_event because
    on_event is deprecated since FastAPI 0.109+
    """
    global _inference_engine

    print("\n" + "=" * 60)
    print("  ExpresaT Backend — Starting server...")
    # [DEMO] Notificación visible de estado de modo demo en el arranque
    if DEMO_MODE:
        print("  [DEMO] MODO DEMO ACTIVO (demo_rules.py)")
        print("  Reglas deterministas para reconocimiento preliminar.")
        print("  Para usar modelo de IA, configurar DEMO_MODE = False en config.py")
    else:
        print("  [PROD] Modo IA Activo (InferenceEngine ONNX)")
    print("=" * 60)

    # --- Load inference engine ---
    try:
        from models.inference_engine import InferenceEngine

        model_path = os.path.abspath(MODEL_DIR)
        print(f"\n  Model: {model_path}")

        _inference_engine = InferenceEngine(
            model_dir=model_path,
            confidence_threshold=CONFIDENCE_THRESHOLD
        )

        engine_info = _inference_engine.get_info()
        print(f"   Engine: {engine_info['engine']}")
        print(f"   Model: {engine_info['model_file']} ({engine_info['model_size_kb']} KB)")
        print(f"   Classes: {engine_info['num_classes']}")
        print(f"   Inference engine ready.\n")

    except FileNotFoundError as e:
        print(f"\n   WARNING: {e}")
        print(f"     Server will start in MOCK mode (no real model).\n")
        _inference_engine = None

    except Exception as e:
        print(f"\n Error loading inference engine: {e}")
        print(f"   Server will start in MOCK mode.\n")
        _inference_engine = None

    yield  # Server is running here

    # --- Shutdown ---
    print("\n ExpresaT Backend — Shutting down...")
    _inference_engine = None
    print("  Resources released.\n")


# ── FASTAPI APPLICATION ────────────────────────────────────────────────────

app = FastAPI(
    title="ExpresaT API V2",
    description="Real-time Sign Language Translation Backend",
    version="2.0.0",
    lifespan=lifespan
)

# CORS — In production, restrict to Netlify domains with safe whitelist
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── CONNECTION MANAGER — Active WebSockets management ─────────────────────

class ConnectionManager:
    """
    Manages active WebSocket connections.
    Uses collections.deque(maxlen=15) for frame buffer to prevent
    memory accumulation and ensure fixed-size window.
    """

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        # Frame buffer for stream mode (frame-by-frame accumulation) — deque con límite automático
        self.frame_buffer: collections.deque = collections.deque(maxlen=15)

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"  Client connected. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        print(f"  Client disconnected. Total active: {len(self.active_connections)}")

    async def send_personal(self, message: dict, websocket: WebSocket):
        """Sends a JSON message to a specific client."""
        await websocket.send_json(message)


manager = ConnectionManager()


# ── THREAD POOL EXECUTOR — For synchronous inference offloading ────────────

async def run_inference_async(frames: list[dict]) -> dict:
    """
    Executes inference in a separate thread to avoid blocking the event loop.

    Design decision: We use asyncio.to_thread() instead of
    ProcessPoolExecutor because:
      1. The ONNX model is already thread-safe internally
      2. Avoids serialization/deserialization of data between processes
      3. Lower memory overhead (doesn't duplicate the model)
      4. Sufficient for ultra-light models (< 10ms inference)

    For heavier models, consider ProcessPoolExecutor.
    """
    # =========================================================================
    # [DEMO] EJECUCIÓN CONDICIONAL SEGÚN DEMO_MODE
    # =========================================================================
    # [DEMO] Si DEMO_MODE es True, se ejecuta el motor determinista predict_demo()
    # que calcula reglas geométricas (ángulos, distancias y extensión de dedos)
    # sobre los landmarks de MediaPipe sin modificar su estructura.
    # Esta implementación es temporal y será reemplazada por el modelo de IA.
    if DEMO_MODE:
        # [DEMO] Offload de reglas deterministas a hilo secundario para mantener async
        return await asyncio.to_thread(predict_demo, frames)

    # --- FLUJO ORIGINAL CON MODELO DE IA ---
    engine = get_inference_engine()

    if engine is None:
        # Mock mode when no model is loaded — return structured result with warning
        return {
            "label": None,
            "confidence": 0.0,
            "latency_ms": 0.0,
            "all_probabilities": {},
            "mock": True,
            "error": "Model not loaded"
        }

    # Offload synchronous inference to a pool thread
    result = await asyncio.to_thread(engine.predict, frames)
    return result


def _mock_inference(frames: list[dict]) -> dict:
    """
    Mock inference for development/testing when there is no trained model.
    Simulates a prediction with realistic latency.
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


# ── SUPABASE AUTH — JWT Verification ───────────────────────────────────────

def verify_supabase_token(token: str) -> Optional[dict]:
    """
    Verifies a Supabase JWT token.

    In production: requires valid token from Supabase.
    In development (FASTAPI_ENV=development): accepts any non-empty token as fallback.
    If in production without configured Supabase, rejects with warning log.
    """
    if not token:
        return None

    env = os.getenv("FASTAPI_ENV", "production")

    # --- DEVELOPMENT: Conditional bypass only when explicitly in dev mode ---
    if env == "development":
        # Accept any non-empty token as fallback for development
        return {"id": "dev-user", "email": "dev@expresat.local"}

    # --- PRODUCTION: Require valid token ---
    # TODO: Uncomment this block to connect everything to the DB
    # try:
    #     from supabase import create_client
    #     supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    #     user = supabase_client.auth.get_user(token)
    #     if user and user.user:
    #         return {"id": user.user.id, "email": user.user.email}
    #     return None
    # except Exception:
    #     return None

    # In production without valid Supabase config, reject and log warning
    print(f"[WARN] verify_supabase_token: Token verification required in production mode. "
          f"Token provided: {token[:20] if token else 'None'}... (truncated for log safety)")
    return None


# ── WEBSOCKET ENDPOINT — /ws/translate ────────────────────────────────────

@app.websocket("/ws/translate")
async def websocket_translate(websocket: WebSocket, token: str = Query(None)):
    """
    Main WebSocket endpoint for real-time sign language translation.

    Message protocol:
        Client → Server:
            {"type": "ping"}
            {"type": "inference", "payload": [frame1, frame2, ..., frame15]}
            {"type": "inference", "payload": single_frame_dict}

        Server → Client:
            {"type": "pong"}
            {"type": "translation", "payload": {...}}
            {"type": "error", "payload": "error message"

    The endpoint supports two delivery modes:
      1. Batch mode: The frontend sends 15 frames at once (optimal)
      2. Stream mode: The frontend sends frame by frame and the backend
         accumulates internally until it has 15 (compatible with previous version)
    """
    # --- Verify authentication ---
    user = verify_supabase_token(token)
    if not user:
        await websocket.close(code=1008, reason="Invalid or missing token")
        return

    # --- Accept connection ---
    await manager.connect(websocket)

    # Frame buffer for stream mode (frame-by-frame accumulation) — deque con maxlen=15
    frame_buffer: collections.deque = collections.deque(maxlen=15)

    try:
        while True:
            # Receive JSON message from client
            data = await websocket.receive_json()
            msg_type = data.get("type")

            # ----- PING/PONG for latency -----
            if msg_type == "ping":
                await manager.send_personal({"type": "pong"}, websocket)

            # ----- INFERENCE -----
            elif msg_type == "inference":
                payload = data.get("payload")

                if payload is None:
                    await manager.send_personal({
                        "type": "error",
                        "payload": "Empty payload in inference message"
                    }, websocket)
                    continue

                # Detect mode: batch (list of frames) vs stream (single frame)
                if isinstance(payload, list):
                    # ===== BATCH MODE =====
                    # The frontend sent a full batch of 15 frames
                    frames_to_process = payload

                elif isinstance(payload, dict):
                    # ===== STREAM MODE (backward compatible) =====
                    # The frontend sends one frame at a time
                    frame_buffer.append(payload)

                    # Since deque has maxlen=15, it automatically keeps only last 15

                    # Only infer when we have a full buffer
                    if len(frame_buffer) < 15:
                        continue

                    frames_to_process = list(frame_buffer)
                    # deque automatically clears after maxlen is reached, but we explicitly copy
                    # and create a fresh reference for the next batch
                    frame_buffer.clear()

                else:
                    await manager.send_personal({
                        "type": "error",
                        "payload": "Invalid payload format"
                    }, websocket)
                    continue

                # --- Execute asynchronous inference ---
                try:
                    result = await run_inference_async(frames_to_process)

                    # Only send translation if confidence exceeds label is not None
                    if result.get("label") is not None:
                        await manager.send_personal({
                            "type": "translation",
                            "payload": result
                        }, websocket)
                    elif result.get("debug") and DEMO_MODE:
                        # [DEMO] Telemetría diagnóstica en tiempo real (mano quieta / reposo)
                        await manager.send_personal({
                            "type": "telemetry",
                            "payload": result
                        }, websocket)

                except Exception as e:
                    # Mask sensitive token info in logs - truncate token reference
                    token_safe = token[:20] + "..." if token and len(token) > 20 else (token or "None")
                    print(f"  Inference error (token: {token_safe}): {e}")
                    await manager.send_personal({
                        "type": "error",
                        "payload": f"Inference error: {str(e)}"
                    }, websocket)

            # ----- UNKNOWN MESSAGE -----
            else:
                await manager.send_personal({
                    "type": "error",
                    "payload": f"Unknown message type: {msg_type}"
                }, websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        # Mask sensitive token info in logs
        token_safe = token[:20] + "..." if token and len(token) > 20 else (token or "None")
        print(f"  WebSocket error (token: {token_safe}): {e}")
        manager.disconnect(websocket)


# ── LEGACY ENDPOINT — /ws ────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_legacy(websocket: WebSocket, token: str = Query(None)):
    """
    Legacy endpoint that redirects to the new /ws/translate.
    Maintains compatibility with existing frontend that uses /ws.
    """
    # Reuse the same logic from the main endpoint
    await websocket_translate(websocket, token)


# ── REST ENDPOINTS — Health checks and utilities ─────────────────────────

@app.head("/")
@app.get("/")
async def health_check():
    """Basic server health check."""
    engine = get_inference_engine()
    return {
        "status": "ok",
        "service": "ExpresaT Backend V2",
        # [DEMO] Indicador visible de modo demo en el endpoint raíz
        "demo_mode": DEMO_MODE,
        "model_loaded": engine is not None,
    }


@app.head("/health")
@app.get("/health")
async def detailed_health():
    """Detailed health check with model information."""
    engine = get_inference_engine()

    response = {
        "status": "healthy",
        "service": "ExpresaT Backend V2",
        "connections": len(manager.active_connections),
        # [DEMO] Exposición de estado de modo demo para el cliente web
        "demo_mode": DEMO_MODE,
    }

    # [DEMO] Reporte de motor activo según DEMO_MODE
    if DEMO_MODE:
        response["model"] = {
            "status": "demo_rules_mode",
            "engine": "Deterministic Geometric Rules (Heuristic Demo)",
            "supported_gestures": DEMO_LABELS,
            "count": len(DEMO_LABELS)
        }
    elif engine:
        response["model"] = engine.get_info()
    else:
        response["model"] = {"status": "mock_mode", "reason": "Model not loaded"}

    return response


@app.get("/labels")
async def get_labels():
    """Returns the labels/signs that the model can recognize."""
    # [DEMO] Si DEMO_MODE es True, retornamos las señas de las reglas deterministas
    if DEMO_MODE:
        return {
            "labels": DEMO_LABELS,
            "count": len(DEMO_LABELS),
            "demo_mode": True,
            "description": "Señas soportadas por el prototipo demo determinista"
        }

    engine = get_inference_engine()
    if engine:
        return {"labels": engine.labels, "count": engine.num_classes}
    return {"labels": [], "count": 0, "message": "Model not loaded"}


# ── DIRECT EXECUTION ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")

    print(f"\n Starting server at {host}:{port}")
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,          # Hot-reload in development
        log_level="info",
        ws_ping_interval=30,  # Automatic ping every 30s to keep connection alive
        ws_ping_timeout=10,   # Pong timeout
    )