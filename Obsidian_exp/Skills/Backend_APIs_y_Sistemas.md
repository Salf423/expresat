---
title: "Skills Especializadas: Backend, APIs y Sistemas de Alto Rendimiento"
description: "Habilidades para desarrollo de APIs asíncronas con FastAPI, concurrencia en C++17, WebSockets en tiempo real, colas circulares lock-free SPSC y seguridad de memoria."
version: "2.3.0"
category: "Skills / Backend & Sistemas"
status: "Producción"
target_agents: ["backend-architect", "fastapi-pro", "cpp-pro", "systems-engineer"]
recommended_skills:
  - "[[00_Matriz_General_Skills]]"
  - "[[../Websocket]]"
  - "[[../Explicacion del codigo/Backend/Python_FastAPI]]"
  - "[[../Explicacion del codigo/Backend/Main C++]]"
  - "[[../Flujo de datos]]"
---

# ⚡ Skills Especializadas: Backend, APIs y Sistemas de Alto Rendimiento

> **Navegación:** [[../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[00_Matriz_General_Skills|🧭 Matriz de Skills]] > **Backend, APIs y Sistemas**

En **ExpresaT**, el subsistema de backend y ejecución de inferencia opera en dos modalidades complementarias:
1. **Servidor Web Centralizado:** Python 3.10+ / FastAPI con WebSockets asíncronos y ONNX Runtime CPU.
2. **Motor Nativo Edge:** C++17 de latencia ultra-baja (<2ms) con buffers circulares lock-free (SPSC) y cero dependencias de red.

---

## 🛠️ Catálogo de Skills Instaladas en este Dominio

### 1. `fastapi-pro` & `fastapi-templates`
- **Ubicación:**
  - `~/.gemini/config/skills/fastapi-pro/SKILL.md`
  - `~/.gemini/config/skills/fastapi-templates/SKILL.md`
- **Objetivo:** Creación y mantenimiento de microservicios FastAPI de alto rendimiento, validación con Pydantic v2, ciclo de vida (`lifespan`) y manejo de excepciones asíncronas.
- **Cuándo invocar:**
  - Optimizar `expresat/backend/main.py`.
  - Configurar endpoints de healthcheck (`/health`), etiquetas soportadas (`/labels`) y streaming `/ws/translate`.

### 2. `cpp-pro` & `c-pro`
- **Ubicación:**
  - `~/.gemini/config/skills/cpp-pro/SKILL.md`
  - `~/.gemini/config/skills/c-pro/SKILL.md`
- **Objetivo:** Código C++ idiomático moderno (C++17/20), gestión de memoria RAII, semántica de movimiento (*move semantics*), metaprogramación con plantillas y llamadas al sistema optimizadas.
- **Cuándo invocar:**
  - Desarrollar o mantener `expresat-native/core/inference_thread.cpp`.
  - Implementar pipelines de captura de video eficientes con OpenCV `cv::VideoCapture`.

### 3. `memory-safety-patterns`
- **Ubicación:** `~/.gemini/config/skills/memory-safety-patterns/SKILL.md`
- **Objetivo:** Patrones para evitar vulnerabilidades de corrupción de memoria, desbordamientos de búfer (*buffer overflow*), carreras de datos y uso después de liberación (*use-after-free*).
- **Cuándo invocar:**
  - Auditar estructuras de intercambio entre hilos como `frame_queue.h` y `result_bus.h`.
  - Asegurar la inicialización limpia de sesiones de memoria en ONNX Runtime C++ (`Ort::MemoryInfo`).

### 4. `async-python-patterns` & `python-performance-optimization`
- **Ubicación:**
  - `~/.gemini/config/skills/async-python-patterns/SKILL.md`
  - `~/.gemini/config/skills/python-performance-optimization/SKILL.md`
- **Objetivo:** Dominio de `asyncio`, tareas en segundo plano (*background tasks*), offloading de inferencia síncrona mediante `asyncio.to_thread` para evitar el bloqueo del bucle de eventos.
- **Cuándo invocar:**
  - Optimizar la función `run_inference_async` en el backend para admitir múltiples clientes concurrentes.

---

## 📋 Reglas Arquitectónicas Invariables para Agentes Backend

1. **No Bloquear el Event Loop en FastAPI:** La llamada `session.run()` de ONNX Runtime es intensiva en CPU. Debe invocarse siempre a través de `await asyncio.to_thread(...)`, nunca directamente en la corrutina asíncrona del WebSocket.
2. **Buffer Circular Estricto:** La ventana de inferencia requiere exactamente **15 frames**. Los agentes no deben modificar este tamaño sin actualizar sincronizadamente la arquitectura en `SignLanguageGRU` y en los exportadores ONNX.
3. **Manejo de Desconexiones:** Siempre capturar `WebSocketDisconnect` para liberar descriptores de conexión en el `ConnectionManager`.
4. **Estado C++ v1.3.0:** El motor C++ actual no implementa el remuestreo por bloques de `ExtractWindow` v1.3.0. Debe rechazar ejecuciones que carezcan de preprocesamiento canónico con `ERR_CPP_NOT_CONFORMANT` o `ERR_SHOULDERS_TOO_SMALL`.

---

## 🧪 Comandos de Prueba para Backend

```bash
# Tests de integración de backend FastAPI:
pytest expresat/backend/test_api_integration.py -v

# Tests de paridad matemática de extractores:
pytest tests/test_feature_spec.py -v

# Benchmark de inferencia nativa:
python scripts/bench_native.py
```
