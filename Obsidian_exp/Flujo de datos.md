---
title: "Arquitectura y Especificación del Flujo de Datos Extremo a Extremo"
description: "Pipeline completo de captura, vectorización de landmarks 178D (FEATURE_SPEC v1.3.0), buffers deslizantes de 15 frames, transmisión por WebSockets con máquina de estados, inferencia en ONNX Runtime y renderizado en cliente."
version: "2.3.0"
category: "Arquitectura / Streaming"
status: "Producción"
target_agents: ["backend-architect", "ml-engineer", "systems-engineer", "frontend-developer"]
recommended_skills:
  - "[[Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `data-engineering-data-pipeline`)"
  - "[[Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`fastapi-pro`, `cpp-pro`, `async-python-patterns`)"
  - "[[Skills/UI_UX_y_Frontend|UI_UX_y_Frontend]] (`react-modernization`, `ui-visual-validator`)"
related_docs:
  - "[[00_INDICE_MAESTRO]]"
  - "[[Caracteristicas]]"
  - "[[Especificacion_Feature_Spec_v1_3_0]]"
  - "[[Websocket]]"
  - "[[Explicacion del codigo/Backend/Python_FastAPI]]"
  - "[[Explicacion del codigo/Backend/Main C++]]"
  - "[[Explicacion del codigo/Frontend/Vite_React]]"
  - "[[Explicacion del codigo/Funciones_Modelo/INFERENCIA]]"
---

# 🔄 Flujo de Datos y Pipeline de Procesamiento Extremo a Extremo — ExpresaT

> **Navegación:** [[00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Flujo de Datos**

Este documento detalla el ciclo de vida completo de la información desde que el sensor óptico (cámara web) captura la escena hasta que la predicción textual y audible de la lengua de señas es desplegada en pantalla, siguiendo el contrato canónico de [[Especificacion_Feature_Spec_v1_3_0|FEATURE_SPEC v1.3.0]].

---

## 🛰️ Diagrama de Secuencia Extremo a Extremo (Web Moderna)

```mermaid
sequenceDiagram
    autonumber
    actor Usuario
    participant Cam as Cámara Web (640×480 @ 4:3)
    participant SE as SignEngine (Tasks Vision CPU)
    participant Geo as Clasificador Geométrico (Offline)
    participant Ext as FeatureExtractor 178D (v1.3.0)
    participant Buf as Sliding Buffer (15 frames)
    participant WS as WSClient (State Machine)
    participant Srv as FastAPI (main.py)
    participant ONNX as ONNX Runtime (CPU Session)
    participant UI as React 19 (useSignEngine + Translator)

    Usuario->>Cam: Realiza gesto de LSM
    Cam->>SE: Frame crudo de video
    SE->>SE: Detección Tasks Vision (HandLandmarker + PoseLandmarker Lite)
    SE->>UI: Feedback geométrico directo (FPS reales, overlay en Canvas)
    
    alt Modo Offline o Demostración Directa
        SE->>Geo: Landmarks crudos de manos
        Geo->>UI: Predicción estática instantánea (A, B, C...)
    else Pipeline de Inferencia Neuronal (Producción)
        SE->>Ext: Landmarks crudos 3D por frame
        Ext->>Buf: Validación previa de hombros y acumulación
        Note over Buf: Ventana temporal de 15 frames (1 segundo a 15 FPS)
        Buf->>WS: Lote serializado {"type": "inference", "payload": [...]}
        WS->>Srv: WebSocket Batch Message (wss://api.expresat.com/ws/translate)
        Note over Srv: Algoritmo Canónico ExtractWindow (v1.3.0)
        Srv->>ONNX: Tensor NumPy (1, 15, 178) float32
        ONNX-->>Srv: Logits de salida por clase
        Note over Srv: Softmax + Umbral de confianza (>= 0.50)
        Srv-->>WS: {"type": "translation", "payload": {"label": "hola", "confidence": 0.952, "latency_ms": 2.02}}
        WS->>UI: Dispatch de traducción reactiva
        UI->>Usuario: Render visual accesible (aria-live="polite") + Síntesis de voz (Web Speech API)
    end
```

---

## 📐 Algoritmo Canónico `ExtractWindow` (FEATURE_SPEC v1.3.0)

El procesamiento de secuencias temporales en el backend (`models/feature_extractor.py`) y en el pipeline offline v2 se ejecuta en **6 pasos inmutables por bloques anatómicos**:

```mermaid
flowchart TD
    Step1["Paso 1: Validación Previa de Hombros Crudos\n• P11 y P12 presentes con vis >= 0.40\n• Hombros dentro del cuadro [0, 1]\n• Brecha temporal continua <= 100 ms"]
    Step2["Paso 2: Asignación Anatómica de Manos por Frame\n• Coste conjunto = Distancia 2D + Penalización Etiqueta (0.25·D) + Continuidad (0.50·dist)\n• Detección y descarte de manos desconectadas (> 1.75·D)"]
    Step3["Paso 3: Remuestreo Temporal por Bloque\n• Remuestreo equidistante a 15 frames (Δt = 66.67 ms)\n• Interpolación lineal 3D independiente para Upper Pose, Mano Izquierda y Mano Derecha"]
    Step4["Paso 4: Cálculo de Escala y Centroide por Ventana\n• D_k = dist3D(P11, P12) por frame\n• D_ventana = mediana(D_0..D_14) >= 0.08\n• C_ventana = mediana(C_0..C_14)"]
    Step5["Paso 5: Filtro EMA Temporal por Bloque (α = 0.50)\n• Suavizado continuo de pose\n• Reinicio de estado inmediato si una mano reaparece tras ausencia"]
    Step6["Paso 6: Normalización Final y Ensamble\n• Upper Pose relativo a C_ventana / D_ventana\n• Manos en XY relativas a C_ventana, eje Z relativo a muñeca / D_ventana\n• Salida: Tensor (1, 15, 178) float32"]

    Step1 --> Step2 --> Step3 --> Step4 --> Step5 --> Step6

    style Step1 fill:#1a3a6b,color:#fff
    style Step2 fill:#2b4a6b,color:#fff
    style Step3 fill:#1d5b4a,color:#fff
    style Step4 fill:#2d5a27,color:#fff
    style Step5 fill:#6b5a1a,color:#fff
    style Step6 fill:#4a2d6b,color:#fff
```

---

## ⚡ Pipeline Nativo Local (C++ / Edge In-Device)

En la variante **`expresat-native`**, el diseño busca latencias inferiores a **3 ms** y funcionamiento *offline-first* mediante buffers circulares:

```mermaid
flowchart LR
    A["Cámara\n(cv::VideoCapture)"] -->|"cv::Mat crudo"| B["SPSC FrameQueue\n(Lock-Free RingBuffer)"]
    B -->|"Wait-Free Pop"| C["Inference Thread\n(C++ Tasks)"]
    C -->|"178D Landmarks"| D["normalize_to_shoulders\n(Salvaguarda v1.3.0)"]
    D -->|"Tensor [1, 15, 178]"| E["ONNX Runtime C++\n(expresat_gru_int8.onnx)"]
    E -->|"Softmax & Top-5"| F["ResultBus\n(Atomic State)"]
    F -->|"Lectura asíncrona"| G["Dear ImGui / OpenGL\n(Render Loop 60 FPS)"]

    style A fill:#2d5a27,color:#fff
    style B fill:#1a3a6b,color:#fff
    style C fill:#6b5a1a,color:#fff
    style D fill:#6b2d1a,color:#fff
    style E fill:#4a2d6b,color:#fff
    style F fill:#2b4a6b,color:#fff
    style G fill:#1d5b4a,color:#fff
```

> [!WARNING] Estado de Conformidad C++ con FEATURE_SPEC v1.3.0
> El pipeline nativo C++ (`expresat-native/core/src/inference_thread.cpp`) actualmente **no implementa `ExtractWindow` con remuestreo por bloques y medianas de ventana**.
> Por diseño de seguridad, si `InferenceThread` detecta parámetros incompletos, rechaza activamente el frame emitiendo `ERR_CPP_NOT_CONFORMANT` o `ERR_SHOULDERS_TOO_SMALL`, evitando corromper la inferencia con ceros silenciosos.

---

## ⏱️ Presupuesto de Latencias (Latency Budget)

| Etapa del Pipeline | Plataforma Web (FastAPI + React 19) | Plataforma Nativa C++ (Desktop / Android) |
|---|---|---|
| Captura de Video | ~16 ms (Cámara nativa 60 FPS / 4:3) | ~16 ms (Hilo independiente OpenCV) |
| Extracción MediaPipe | ~12–18 ms (`SignEngine` Tasks Vision CPU) | ~8–12 ms (MediaPipe C++ Tasks) |
| Normalización Canónica 178D | < 0.15 ms (`featureExtractor.js` / py) | < 0.05 ms (`normalize_to_shoulders`) |
| Transporte de Red (WebSocket) | ~30–50 ms (WSClient batch wss://) | **0 ms** (Memoria compartida SPSC) |
| Inferencia ONNX (INT8 CPU) | **2.02 ms** | **1.85 ms** |
| Post-procesado (Softmax/Filtro) | < 0.1 ms | < 0.05 ms |
| **Latencia Total de Respuesta** | **~60–85 ms** (Percepción instantánea) | **~10–18 ms** (Tiempo real estricto) |

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Inferencia y Normalización Canónica:** Activar la skill **`ml-engineer`** y consultar [[Especificacion_Feature_Spec_v1_3_0]].
- **Para Concurrencia y Sockets:** Activar la skill **`fastapi-pro`** y **`async-python-patterns`** para verificar que el bucle asíncrono no se bloquee.
- **Para Lock-Free y C++:** Activar la skill **`cpp-pro`** y **`memory-safety-patterns`** para inspeccionar la integridad de `inference_thread.cpp` y `frame_queue.h`.
- **Para Coordinación de UI:** Consultar [[Explicacion del codigo/Frontend/Vite_React]].
