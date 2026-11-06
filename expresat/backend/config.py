"""
config.py — ExpresaT Backend Global Configuration
=================================================
Centraliza los parámetros globales y banderas de configuración del sistema.
"""

import os

# =============================================================================
# [DEMO] MODO DEMO — RECONOCIMIENTO DETERMINISTA BASADO EN REGLAS
# =============================================================================
# [DEMO] DEMO_MODE: Constante global que controla si el sistema utiliza
# cálculos deterministas predefinidos (reglas, distancias y ángulos entre landmarks)
# o el modelo de IA definitivo (ONNX Runtime / InferenceEngine).
#
# Para volver al flujo original del modelo de IA:
#   - Establecer DEMO_MODE = False aquí, o
#   - Configurar la variable de entorno EXPRESAT_DEMO_MODE=false
DEMO_MODE: bool = os.getenv("EXPRESAT_DEMO_MODE", "true").lower() in ("true", "1", "yes")
