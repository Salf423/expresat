## Key Concepts

- **FastAPI**: A modern, fast framework for building APIs with Python.
- **WebSocket**: A protocol that enables two-way communication between client and server.
- **Asynchronous Inference**: The process of performing predictions without blocking the event loop, allowing the server to handle multiple connections concurrently.
- **JWT (JSON Web Tokens)**: A method for securely authenticating users.

## Code Structure

The code is organized into several key sections:

1. **Environment Variables**: Server and model configuration.
2. **Inference Engine**: Class managing the loading and execution of the prediction model.
3. **WebSocket Connection Management**: Class managing active client connections.
4. **WebSocket Endpoints**: Functions defining how the server responds to client messages.
5. **REST Endpoints**: Provide information on server and model status.

## Code Examples

Below are code snippets illustrating the server's functionality.

### Server Initialization

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _inference_engine
    print("Starting server...")
    try:
        from models.inference_engine import InferenceEngine
        _inference_engine = InferenceEngine(model_dir=MODEL_DIR, confidence_threshold=CONFIDENCE_THRESHOLD)
        print("Inference engine ready.")
    except Exception as e:
        print(f"Error loading inference engine: {e}")
        _inference_engine = None
    yield
    print("Shutting down server...")
    _inference_engine = None
```

This snippet manages the server lifecycle, loading the inference engine at startup and releasing resources upon shutdown.

### WebSocket Connection Management

```python
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
```

Here, the `ConnectionManager` class is defined to accept and disconnect WebSocket clients while keeping track of active connections.

### WebSocket Endpoint for Translation

```python
@app.websocket("/ws/translate")
async def websocket_translate(websocket: WebSocket, token: str = Query(None)):
    user = verify_supabase_token(token)
    if not user:
        await websocket.close(code=1008, reason="Invalid or missing token")
        return
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "inference":
                payload = data.get("payload")
                # Process inference...
```

This endpoint handles communication with the client, verifying the authentication token and processing inference messages.