"""
config.py — ExpresaT Backend Global Configuration
=================================================
Centraliza los parámetros globales y banderas de configuración del sistema.

Variables de entorno soportadas:
  - EXPRESAT_DEMO_MODE:
      Cuando es "true" (por defecto en modo demo), el backend utiliza las reglas
      geométricas deterministas (`demo_rules.py`) y permite conexiones WebSocket
      en `/ws/translate` sin exigir un token JWT de Supabase.
      Cuando es "false", exige un token JWT válido de Supabase en producción
      y utiliza el motor ONNX (`InferenceEngine`).
  - FASTAPI_ENV:
      "development" | "production" (default: "production").
  - CORS_ORIGINS:
      Lista de orígenes permitidos separados por coma para HTTP CORS y validación
      de cabecera `Origin` en el handshake WebSocket.
"""

import os


def is_demo_mode_enabled() -> bool:
    """Evalúa dinámicamente EXPRESAT_DEMO_MODE para facilitar pruebas e inyección por entorno."""
    return os.getenv("EXPRESAT_DEMO_MODE", "true").strip().lower() in ("true", "1", "yes", "on")


DEMO_MODE: bool = is_demo_mode_enabled()
