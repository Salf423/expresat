## Conceptos Clave

- **WebSocket**: Un protocolo que permite la comunicación bidireccional entre el cliente y el servidor.
- **FastAPI**: Un framework moderno y rápido para construir APIs con Python.
- **Inferencia**: Proceso de deducir o predecir información a partir de datos de entrada, en este caso, utilizando un modelo de lenguaje de señas.

## Estructura del Código

El código se organiza en una clase llamada `ConnectionManager`, que se encarga de gestionar las conexiones WebSocket. A continuación, se describen los métodos principales de esta clase:

1. **`__init__`**: Inicializa la lista de conexiones activas y el predictor de lenguaje de señas.
2. **`connect`**: Acepta una nueva conexión WebSocket y la añade a la lista de conexiones activas.
3. **`disconnect`**: Elimina una conexión de la lista de conexiones activas.
4. **`send_personal_message`**: Envía un mensaje JSON a un cliente específico.
5. **`broadcast`**: Envía un mensaje JSON a todos los clientes conectados.
6. **`handle_message`**: Maneja los mensajes entrantes, respondiendo a tipos específicos de mensajes como 'ping' y 'inference'.

## Ejemplos de Código

A continuación, se presenta el código completo con explicaciones sobre su funcionamiento:

language-python

`from fastapi import WebSocket import json import sys import os  # Añadimos el directorio padre al path para importar el modelo de predicción sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) from models.inference import SignLanguagePredictor  class ConnectionManager:     def __init__(self):         self.active_connections: list[WebSocket] = []  # Lista de conexiones activas         self.predictor = SignLanguagePredictor()  # Inicializa el predictor de lenguaje de señas      async def connect(self, websocket: WebSocket):         await websocket.accept()  # Acepta la conexión WebSocket         self.active_connections.append(websocket)  # Añade la conexión a la lista      def disconnect(self, websocket: WebSocket):         if websocket in self.active_connections:             self.active_connections.remove(websocket)  # Elimina la conexión de la lista      async def send_personal_message(self, message: dict, websocket: WebSocket):         await websocket.send_json(message)  # Envía un mensaje JSON al cliente específico      async def broadcast(self, message: dict):         for connection in self.active_connections:             await connection.send_json(message)  # Envía un mensaje a todos los clientes conectados      async def handle_message(self, data: dict, websocket: WebSocket):         msg_type = data.get('type')  # Obtiene el tipo de mensaje                  if msg_type == 'ping':             await self.send_personal_message({'type': 'pong'}, websocket)  # Responde a un 'ping'                      elif msg_type == 'inference':             landmarks = data.get('payload')  # Obtiene los datos de entrada             translation_result = self.predictor.process_frame(landmarks)  # Procesa los datos                          if translation_result:                 # Si el modelo devolvió una palabra                 await self.send_personal_message({                     'type': 'translation',                     'payload': translation_result                 }, websocket)`

### Explicación del Código

- **Importaciones**: Se importan las librerías necesarias, incluyendo `WebSocket` de FastAPI y el modelo `SignLanguagePredictor`.
- **Gestión de Conexiones**: La clase `ConnectionManager` mantiene un registro de todas las conexiones activas y permite la comunicación con cada cliente.
- **Manejo de Mensajes**: El método `handle_message` es crucial, ya que determina cómo responder a diferentes tipos de mensajes. Por ejemplo, si recibe un 'ping', responde con un 'pong', y si recibe un 'inference', procesa los datos de entrada y envía la traducción de vuelta al cliente.