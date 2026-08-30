## Key Concepts

- **WebSocket**: A protocol that enables two-way communication between client and server.
- **FastAPI**: A modern, fast framework for building APIs with Python.
- **Inference**: The process of inferring or predicting information from input data, in this case, using a sign language model.

## Code Structure

The code is organized into a class called `ConnectionManager`, which manages WebSocket connections. Below are the main methods of this class:

1. **`__init__`**: Initializes the active connections list and the sign language predictor.
2. **`connect`**: Accepts a new WebSocket connection and adds it to the active connections list.
3. **`disconnect`**: Removes a connection from the active connections list.
4. **`send_personal_message`**: Sends a JSON message to a specific client.
5. **`broadcast`**: Sends a JSON message to all connected clients.
6. **`handle_message`**: Handles incoming messages, responding to specific message types like 'ping' and 'inference'.

## Code Examples

Below is the complete code with explanations of how it works:

```python
from fastapi import WebSocket
import json
import sys
import os

# Add parent directory to path to import prediction model
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from models.inference import SignLanguagePredictor

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []  # List of active connections
        self.predictor = SignLanguagePredictor()  # Initialize sign language predictor

    async def connect(self, websocket: WebSocket):
        await websocket.accept()  # Accept WebSocket connection
        self.active_connections.append(websocket)  # Add connection to list

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)  # Remove connection from list

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)  # Send JSON message to specific client

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)  # Send message to all connected clients

    async def handle_message(self, data: dict, websocket: WebSocket):
        msg_type = data.get('type')  # Get message type

        if msg_type == 'ping':
            await self.send_personal_message({'type': 'pong'}, websocket)  # Respond to 'ping'

        elif msg_type == 'inference':
            landmarks = data.get('payload')  # Get input data
            translation_result = self.predictor.process_frame(landmarks)  # Process data

            if translation_result:
                # If the model returned a word
                await self.send_personal_message({
                    'type': 'translation',
                    'payload': translation_result
                }, websocket)
```

### Code Explanation

- **Imports**: Necessary libraries are imported, including FastAPI's `WebSocket` and the `SignLanguagePredictor` model.
- **Connection Management**: The `ConnectionManager` class maintains a registry of all active connections and handles communication with each client.
- **Message Handling**: The `handle_message` method is crucial, as it determines how to respond to different message types. For example, if it receives a 'ping', it responds with a 'pong'; if it receives an 'inference', it processes input data and sends the translation back to the client.