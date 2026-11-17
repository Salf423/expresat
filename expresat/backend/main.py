#!/usr/bin/env python3
"""
ExpresaT FastAPI server with WebSocket inference endpoint.

Handles:
  - `/ws/translate` WebSocket endpoint for 15-frame landmark batches
  - Offloaded CPU inference via `asyncio.to_thread` (non-blocking event loop)
  - Supabase JWT authentication and Origin validation
  - Health checks and latency metrics

Run with `--workers 1` so the ONNX model is loaded into memory once per instance.
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

# Prefer package-relative import; fall back when invoked directly from backend/
try:
    from backend.config import DEMO_MODE, is_demo_mode_enabled
    from backend.demo_rules import predict_demo, DEMO_LABELS
except ImportError:
    from config import DEMO_MODE, is_demo_mode_enabled
    from demo_rules import predict_demo, DEMO_LABELS


SUPABASE_URL = os.getenv("SUPABASE_URL", "https://your-project.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "your-service-role-key-or-anon")
MODEL_DIR = os.getenv("MODEL_DIR", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "models", "exported_model"
))
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.5"))

# Default CORS allowlist (override via CORS_ORIGINS env var in production)
CORS_ORIGINS_DEFAULT = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://api.expresat.cloud",
    "https://expresat.netlify.app",
    "https://ecpresatt.netlify.app",
]
CORS_ORIGINS = os.getenv("CORS_ORIGINS", ",".join(CORS_ORIGINS_DEFAULT)).split(",")


_inference_engine = None


def get_inference_engine():
    """Return the singleton inference engine instance."""
    global _inference_engine
    return _inference_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage server startup and shutdown lifecycle.
    Uses FastAPI lifespan instead of deprecated `@app.on_event`.
    """
    global _inference_engine

    print("\n" + "=" * 60)
    print("  ExpresaT Backend — Starting server...")
    if DEMO_MODE:
        print("  [DEMO] MODO DEMO ACTIVO (demo_rules.py)")
        print("  Reglas deterministas para reconocimiento preliminar.")
        print("  Para usar modelo de IA, configurar DEMO_MODE = False en config.py")
    else:
        print("  [PROD] Modo IA Activo (InferenceEngine ONNX)")
    print("=" * 60)

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

    yield

    print("\n ExpresaT Backend — Shutting down...")
    _inference_engine = None
    print("  Resources released.\n")


app = FastAPI(
    title="ExpresaT API V2",
    description="Real-time Sign Language Translation Backend",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectionManager:
    """
    Manage active WebSocket connections with a bounded 15-frame stream buffer.
    """

    def __init__(self):
        self.active_connections: list[WebSocket] = []
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
        """Send a JSON message to a single client."""
        await websocket.send_json(message)


manager = ConnectionManager()


async def run_inference_async(frames: list[dict]) -> dict:
    """
    Run inference off the asyncio event loop via `asyncio.to_thread()`.
    Thread offloading avoids process-boundary serialization and model duplication
    since the ONNX Runtime session is thread-safe and inference is < 10 ms.
    """
    if is_demo_mode_enabled():
        return await asyncio.to_thread(predict_demo, frames)

    engine = get_inference_engine()

    if engine is None:
        return {
            "label": None,
            "confidence": 0.0,
            "latency_ms": 0.0,
            "all_probabilities": {},
            "mock": True,
            "error": "Model not loaded"
        }

    result = await asyncio.to_thread(engine.predict, frames)
    return result


def _mock_inference(frames: list[dict]) -> dict:
    """Mock inference fallback for development when no trained model is available."""
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


def verify_supabase_token(token: str) -> Optional[dict]:
    """
    Verify a Supabase JWT token.
    Accepts any non-empty token when FASTAPI_ENV=development; requires valid
    Supabase verification in production.
    """
    if not token:
        return None

    env = os.getenv("FASTAPI_ENV", "production")

    if env == "development":
        return {"id": "dev-user", "email": "dev@expresat.local"}

    # Reject development fallback tokens in production
    if token in ("mock_token", "demo_fallback_token"):
        return None

    if SUPABASE_URL and SUPABASE_KEY and "your-project.supabase.co" not in SUPABASE_URL:
        try:
            from supabase import create_client
            supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
            user_resp = supabase_client.auth.get_user(token)
            if user_resp and getattr(user_resp, "user", None):
                return {"id": user_resp.user.id, "email": user_resp.user.email}
            print("[WS REJECT] Supabase get_user returned no user for provided token.")
            return None
        except Exception as e:
            print(f"[WS REJECT] Supabase verification failed: {e}")
            return None

    print(f"[WARN] verify_supabase_token: Supabase verification required in production. "
          f"Token provided: {token[:20]}... (truncated).")
    return None


def is_origin_allowed(origin: Optional[str]) -> bool:
    """Validate the WebSocket Origin header against CORS_ORIGINS when present."""
    if not origin:
        return True
    allowed = [o.strip() for o in os.getenv("CORS_ORIGINS", ",".join(CORS_ORIGINS_DEFAULT)).split(",") if o.strip()]
    if "*" in allowed:
        return True
    return origin in allowed


@app.websocket("/ws/translate")
async def websocket_translate(websocket: WebSocket, token: str = Query(None)):
    """Main WebSocket endpoint for real-time sign language translation."""
    origin = websocket.headers.get("origin")
    demo_active = is_demo_mode_enabled()

    if not is_origin_allowed(origin):
        reason = f"Origin no autorizado: {origin}"
        print(f"[WS REJECT] Origin={origin} | {reason} | DEMO_MODE={demo_active} | closing code=1008")
        await websocket.close(code=1008, reason=reason)
        return

    user = verify_supabase_token(token)
    if not user and demo_active:
        # Demo mode allows unauthenticated demo sessions
        user = {"id": "demo-user", "email": "demo@expresat.local", "demo": True}
        print(f"[WS AUTH] DEMO_MODE=true: sesión de demostración pública iniciada (Origin={origin or 'none'})")

    if not user:
        reason = "Token ausente (no provided)" if not token else "Token inválido o expirado"
        print(f"[WS REJECT] Origin={origin or 'unknown'} | {reason} | "
              f"DEMO_MODE={demo_active} | FASTAPI_ENV={os.getenv('FASTAPI_ENV', 'production')} | "
              f"closing connection code=1008")
        await websocket.close(code=1008, reason=reason)
        return

    await manager.connect(websocket)

    frame_buffer: collections.deque = collections.deque(maxlen=15)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await manager.send_personal({"type": "pong"}, websocket)

            elif msg_type == "auth":
                client_token = data.get("token")
                # Token already validated at handshake when provided in query string
                token_user = verify_supabase_token(client_token) if client_token else user
                if token_user:
                    await manager.send_personal({
                        "type": "auth_ack",
                        "payload": {"authenticated": True, "user_id": token_user.get("id")}
                    }, websocket)
                else:
                    await manager.send_personal({
                        "type": "error",
                        "payload": "Authentication failed"
                    }, websocket)

            elif msg_type == "inference":
                payload = data.get("payload")

                if payload is None:
                    await manager.send_personal({
                        "type": "error",
                        "payload": "Empty payload in inference message"
                    }, websocket)
                    continue

                if isinstance(payload, list):
                    frames_to_process = payload

                elif isinstance(payload, dict):
                    # Stream mode (legacy single-frame input)
                    frame_buffer.append(payload)
                    if len(frame_buffer) < 15:
                        continue

                    frames_to_process = list(frame_buffer)
                    frame_buffer.clear()

                else:
                    await manager.send_personal({
                        "type": "error",
                        "payload": "Invalid payload format"
                    }, websocket)
                    continue

                try:
                    result = await run_inference_async(frames_to_process)

                    if result.get("label") is not None:
                        await manager.send_personal({
                            "type": "translation",
                            "payload": result
                        }, websocket)
                    elif result.get("debug") and DEMO_MODE:
                        # Real-time diagnostic telemetry in demo mode
                        await manager.send_personal({
                            "type": "telemetry",
                            "payload": result
                        }, websocket)

                except Exception as e:
                    token_safe = token[:20] + "..." if token and len(token) > 20 else (token or "None")
                    print(f"  Inference error (token: {token_safe}): {e}")
                    await manager.send_personal({
                        "type": "error",
                        "payload": f"Inference error: {str(e)}"
                    }, websocket)

            else:
                await manager.send_personal({
                    "type": "error",
                    "payload": f"Unknown message type: {msg_type}"
                }, websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        token_safe = token[:20] + "..." if token and len(token) > 20 else (token or "None")
        print(f"  WebSocket error (token: {token_safe}): {e}")
        manager.disconnect(websocket)


@app.websocket("/ws")
async def websocket_legacy(websocket: WebSocket, token: str = Query(None)):
    """Legacy WebSocket alias forwarding to `/ws/translate`."""
    await websocket_translate(websocket, token)


@app.head("/")
@app.get("/")
async def health_check():
    """Basic server health check."""
    engine = get_inference_engine()
    demo_active = is_demo_mode_enabled()
    return {
        "status": "ok",
        "service": "ExpresaT Backend V2",
        "demo_mode": demo_active,
        "model_loaded": engine is not None,
    }


@app.head("/health")
@app.get("/health")
async def detailed_health():
    """Detailed health check with model information."""
    engine = get_inference_engine()
    demo_active = is_demo_mode_enabled()

    response = {
        "status": "healthy",
        "service": "ExpresaT Backend V2",
        "connections": len(manager.active_connections),
        "demo_mode": demo_active,
    }

    if demo_active:
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
    """Return the labels/signs the active backend can recognize."""
    if is_demo_mode_enabled():
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


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")

    print(f"\n Starting server at {host}:{port}")
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,
        log_level="info",
        ws_ping_interval=30,
        ws_ping_timeout=10,
    )