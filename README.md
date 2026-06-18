# ExpresaT — Traductor de Lengua de Señas en Tiempo Real

ExpresaT es una plataforma diseñada para cerrar la brecha de comunicación mediante la traducción automática de Lengua de Señas a texto, utilizando inteligencia artificial de vanguardia optimizada para ejecutarse en hardware convencional (CPU).

## Características Principales

- **Detección Multi-modelo**: Integración con MediaPipe Holistic para seguimiento de manos y pose.
- **Inferencia Ultra-rápida**: Motor basado en ONNX Runtime con latencias de ~2ms.
- **Arquitectura Edge-first**: Diseñado para funcionar sin necesidad de GPU dedicada.
- **Comunicación en Tiempo Real**: WebSockets asíncronos para una experiencia fluida.

## Stack Tecnológico

- **Frontend**: HTML5, Vanilla CSS (Premium Glassmorphism), JavaScript.
- **Backend**: FastAPI (Python), WebSockets.
- **IA/ML**: PyTorch (entrenamiento), ONNX Runtime (producción), NumPy.

## Estructura del Proyecto

- `/frontend`: Interfaz de usuario y lógica de captura de cámara.
- `/backend`: Servidor de API y gestión de conexiones.
- `/models`: Definición de red neuronal GRU, scripts de entrenamiento y modelos exportados.
- `/docs`: Documentación detallada del sistema.

## Documentación

Para una comprensión profunda del funcionamiento interno del sistema de IA, el procesamiento de datos y la arquitectura del servidor, consulta:

**[Especificación Técnica del Backend (IA & Inferencia)](./expresat/docs/BACKEND_TECHNICAL_SPEC.md)**

## Inicio Rápido

1. Instalar dependencias: `pip install -r expresat/backend/requirements.txt`
2. Iniciar el servidor: `cd expresat/backend && uvicorn main:app`
3. Abrir `expresat/frontend/index.html` en tu navegador.

---
Desarrollado con ❤️ para la accesibilidad universal.
