"""
websockets_handler.py — ExpresaT: WebSocket Connection Manager (legacy)
========================================================================
⚠️  DEPRECADO: main.py ya incluye su propio ConnectionManager con
    InferenceEngine real. Este archivo se conserva por compatibilidad con
    el frontend-legacy pero NO debe ser importado en producción.

    El endpoint activo es:  main.py → /ws/translate  (InferenceEngine)
    El endpoint legacy era: este módulo → SignLanguagePredictor (MOCK)
"""

from fastapi import WebSocket
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# [DEMO] Modo demo y reglas deterministas
try:
    from backend.config import DEMO_MODE
    from backend.demo_rules import predict_demo
except ImportError:
    from config import DEMO_MODE
    from demo_rules import predict_demo

# NOTA: InferenceEngine es el motor real de producción.
# SignLanguagePredictor se mantiene solo como fallback MOCK para el handler legacy.
try:
    from models.inference_engine import InferenceEngine
except (ImportError, FileNotFoundError):
    InferenceEngine = None

from models.inference import SignLanguagePredictor


class ConnectionManager:
    """
    Handler de conexiones WebSocket.

    ⚠️  Este ConnectionManager usa SignLanguagePredictor (mock) para
    compatibilidad con el frontend legacy. El backend de producción
    (main.py) usa InferenceEngine directamente vía asyncio.to_thread.
    """

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        # Mock predictor para el handler legacy
        self.predictor = SignLanguagePredictor()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

    async def handle_message(self, data: dict, websocket: WebSocket):
        msg_type = data.get("type")

        if msg_type == "ping":
            await self.send_personal_message({"type": "pong"}, websocket)

        elif msg_type == "inference":
            landmarks = data.get("payload")

            # [DEMO] Comprobación de DEMO_MODE: utiliza reglas deterministas en vez del predictor
            if DEMO_MODE:
                # [DEMO] Ejecución de predicción temporal con reglas fijas
                demo_result = predict_demo(landmarks)
                if demo_result and demo_result.get("label") is not None:
                    await self.send_personal_message({
                        "type": "translation",
                        "payload": demo_result
                    }, websocket)
                return

            # --- FLUJO LEGACY ORIGINAL ---
            translation_result = self.predictor.process_frame(landmarks)

            if translation_result:
                await self.send_personal_message({
                    "type": "translation",
                    "payload": translation_result
                }, websocket)
