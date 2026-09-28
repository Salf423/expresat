---
title: "Skills Especializadas: Backend, APIs y Sistemas de Alto Rendimiento"
description: "Habilidades para desarrollo de APIs asíncronas con FastAPI, concurrencia en C++17, WebSockets en tiempo real, estructuras lock-free y seguridad de memoria."
version: "2.0.0"
category: "Skills / Backend & Sistemas"
target_agents: ["backend-architect", "fastapi-pro", "cpp-pro", "systems-engineer"]
related_docs:
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
- **Objetivo:** Creación y mantenimiento de microservicios FastAPI de alto rendimiento, validación con Pydantic v2, gestión del ciclo de vida (`@asynccontextmanager lifespan`) y manejo de excepciones asíncronas.
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
- **Objetivo:** Dominio de `asyncio`, tareas en segundo plano (*background tasks*), offloading de inferencia síncrona mediante `asyncio.to_thread` o `ThreadPoolExecutor` para evitar el bloqueo del bucle de eventos.
- **Cuándo invocar:**
  - Optimizar la función `run_inference_async` en el backend para admitir múltiples clientes concurrentes.

### 5. `api-design-principles` & `api-testing-observability-api-mock`
- **Ubicación:**
  - `~/.gemini/config/skills/api-design-principles/SKILL.md`
  - `~/.gemini/config/skills/api-testing-observability-api-mock/SKILL.md`
- **Objetivo:** Especificación rigurosa de contratos REST y WebSocket, esquemas OpenAPI 3.1, códigos de estado HTTP y simulación (*mocking*) de streams para pruebas de carga.

---

## 📋 Reglas Arquitectónicas Invariables para Agentes Backend

1. **No Bloquear el Event Loop en FastAPI:** La llamada `session.run()` de ONNX Runtime es intensiva en CPU. Debe invocarse siempre a través de un ejecutor desacoplado o thread pool, nunca directamente en la corrutina asíncrona del WebSocket.
2. **Buffer Circular Estricto:** La ventana de inferencia requiere exactamente **15 frames**. Los agentes no deben modificar este tamaño sin actualizar sincronizadamente la arquitectura en `SignLanguageGRU` y en los exportadores ONNX.
3. **Manejo de Desconexiones:** Siempre capturar `WebSocketDisconnect` para liberar descriptores de conexión en el `ConnectionManager`.
