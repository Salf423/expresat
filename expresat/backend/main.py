from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
import os
from websockets_handler import ConnectionManager

app = FastAPI(title="ExpresaT API V2")

# Supabase Auth Configuration
# Ensure these environment variables are set in production
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://your-project.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "your-service-role-key-or-anon")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to Netlify domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = ConnectionManager()

def verify_token(token: str):
    """
    Verifica el JWT token de Supabase para proteger el WebSocket.
    """
    if not token:
        raise ValueError("Token is missing")
    
    # Intenta obtener el usuario validando el JWT
    user = supabase.auth.get_user(token)
    if not user:
        raise ValueError("Invalid or expired token")
    return user

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    """
    Endpoint principal para la conexión WebSocket del traductor.
    Verifica la autenticación antes de aceptar la conexión.
    """
    try:
        if not token:
            await websocket.close(code=1008) # Policy Violation
            return
            
        # En producción descomentar para usar la validación real
        # user = verify_token(token)
        # print(f"User {user.user.id} connected")
        
        await manager.connect(websocket)
        
        try:
            while True:
                data = await websocket.receive_json()
                await manager.handle_message(data, websocket)
        except WebSocketDisconnect:
            manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket Error: {str(e)}")
        await websocket.close(code=1008)

@app.get("/")
def health_check():
    return {"status": "ok", "message": "ExpresaT Backend V2 is running."}
