## Conceptos Clave

- **FastAPI**: Un framework moderno y rápido para construir APIs con Python.
- **WebSocket**: Un protocolo que permite la comunicación bidireccional entre el cliente y el servidor.
- **Inferencia Asíncrona**: Proceso de realizar predicciones sin bloquear el event loop, permitiendo que el servidor maneje múltiples conexiones simultáneamente.
- **JWT (JSON Web Tokens)**: Un método para autenticar usuarios de manera segura.

## Estructura del Código

El código se organiza en varias secciones clave:

1. **Variables de Entorno**: Configuración del servidor y del modelo.
2. **Motor de Inferencia**: Clase que gestiona la carga y ejecución del modelo de predicción.
3. **Gestión de Conexiones WebSocket**: Clase que maneja las conexiones activas de los clientes.
4. **Endpoints WebSocket**: Funciones que definen cómo el servidor responde a los mensajes de los clientes.
5. **Endpoints REST**: Proporcionan información sobre el estado del servidor y del modelo.

## Ejemplos de Código

A continuación, se presentan fragmentos de código que ilustran las funcionalidades del servidor.

### Inicialización del Servidor

language-python

`@asynccontextmanager async def lifespan(app: FastAPI):     global _inference_engine     print("Iniciando servidor...")     try:         from models.inference_engine import InferenceEngine         _inference_engine = InferenceEngine(model_dir=MODEL_DIR, confidence_threshold=CONFIDENCE_THRESHOLD)         print("Motor de inferencia listo.")     except Exception as e:         print(f"Error cargando motor de inferencia: {e}")         _inference_engine = None     yield     print("Apagando servidor...")     _inference_engine = None`

Este fragmento gestiona el ciclo de vida del servidor, cargando el motor de inferencia al inicio y liberando recursos al apagarse.

### Gestión de Conexiones WebSocket

language-python

`class ConnectionManager:     def __init__(self):         self.active_connections: list[WebSocket] = []      async def connect(self, websocket: WebSocket):         await websocket.accept()         self.active_connections.append(websocket)      def disconnect(self, websocket: WebSocket):         if websocket in self.active_connections:             self.active_connections.remove(websocket)`

Aquí se define la clase `ConnectionManager`, que permite aceptar y desconectar clientes WebSocket, manteniendo un registro de las conexiones activas.

### Endpoint WebSocket para Traducción

language-python

`@app.websocket("/ws/translate") async def websocket_translate(websocket: WebSocket, token: str = Query(None)):     user = verify_supabase_token(token)     if not user:         await websocket.close(code=1008, reason="Token inválido o faltante")         return     await manager.connect(websocket)     try:         while True:             data = await websocket.receive_json()             msg_type = data.get("type")             if msg_type == "inference":                 payload = data.get("payload")                 # Procesar inferencia...`

Este endpoint maneja la comunicación con el cliente, verificando el token de autenticación y procesando mensajes de inferencia.