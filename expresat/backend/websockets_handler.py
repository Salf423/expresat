from fastapi import WebSocket
import json
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from models.inference import SignLanguagePredictor

class ConnectionManager:
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
        msg_type = data.get('type')
        
        if msg_type == 'ping':
            await self.send_personal_message({'type': 'pong'}, websocket)
            
        elif msg_type == 'inference':
            landmarks = data.get('payload')
            translation_result = self.predictor.process_frame(landmarks)
            
            if translation_result:
                # Si el modelo determinó que la seña está completa y devolvió una palabra
                await self.send_personal_message({
                    'type': 'translation',
                    'payload': translation_result
                }, websocket)
