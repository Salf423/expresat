"""
Legacy WebSocket Connection Manager.

DEPRECATED: `main.py` provides the active `/ws/translate` ConnectionManager backed
by `InferenceEngine`. Kept only for compatibility with `frontend-legacy` and must
not be imported in production.
"""

import warnings
warnings.warn(
    "websockets_handler.py está deprecado. Use main.py",
    DeprecationWarning,
    stacklevel=2
)

from fastapi import WebSocket
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from backend.config import DEMO_MODE
    from backend.demo_rules import predict_demo
except ImportError:
    from config import DEMO_MODE
    from demo_rules import predict_demo


# Fallback mock predictor kept only for the legacy handler
try:
    from models.inference_engine import InferenceEngine
except (ImportError, FileNotFoundError):
    InferenceEngine = None

from models.inference import SignLanguagePredictor


class ConnectionManager:
    """
    Legacy WebSocket connection handler backed by the mock `SignLanguagePredictor`.
    Production (`main.py`) uses `InferenceEngine` via `asyncio.to_thread`.
    """

    def __init__(self):
        self.active_connections: list[WebSocket] = []
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

            if DEMO_MODE:
                demo_result = predict_demo(landmarks)
                if demo_result and demo_result.get("label") is not None:
                    await self.send_personal_message({
                        "type": "translation",
                        "payload": demo_result
                    }, websocket)
                return

            translation_result = self.predictor.process_frame(landmarks)

            if translation_result:
                await self.send_personal_message({
                    "type": "translation",
                    "payload": translation_result
                }, websocket)