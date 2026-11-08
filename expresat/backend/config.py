"""
config.py — ExpresaT Backend Global Configuration
================================================
Centraliza los parámetros globales y banderas de configuración del sistema.
"""

import os

# =============================================================================
# [DEMO] MODO DEMO — RECONOCIMIENTO DETERMINISTA BASADO EN REGLAS
# =============================================================================
# [DEMO] DEMO_MODE: Constante global que controla si el sistema utiliza
# cálculos deterministas predefinidos (reglas, distancias y ángulos entre landmarks)
# o el modelo de IA definitivo (ONNX Runtime / InferenceEngine).

# Por defecto modo producción (false). Activar modo demo con:
#   - Establecer DEMO_MODE = True aquí, o
#   - Configurar la variable de entorno EXPRESAT_DEMO_MODE=true
DEMO_MODE: bool = os.getenv("EXPRESAT_DEMO_MODE", "false").lower() in ("true", "1", "yes")