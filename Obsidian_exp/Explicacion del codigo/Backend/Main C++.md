---
title: "Explicación del Código: Motor de Inferencia Nativo en C++ (ONNX Runtime)"
description: "Arquitectura interna del motor de ejecución en C++17: sesiones optimizadas de ONNX Runtime, colas circulares lock-free SPSC y paralelismo de CPU."
version: "2.0.0"
category: "Código / Backend Nativo C++"
status: "Producción"
target_agents: ["cpp-pro", "systems-engineer", "ml-engineer"]
recommended_skills:
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`, `memory-safety-patterns`)"
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[Python_FastAPI]]"
  - "[[../Frontend]]"
  - "[[../../Flujo de datos]]"
  - "[[../Funciones_Modelo/INFERENCIA]]"
---

# ⚡ Explicación del Código: Motor de Inferencia Nativo en C++ (ONNX Runtime)

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Backend** > **Main C++**

El subsistema nativo (`expresat-native/core`) constituye la implementación en C++17 de alto rendimiento de **ExpresaT**. Proporciona un motor de inferencia desacoplado de la red, diseñado para operar tanto en escritorios convencionales como en arquitecturas ARM en teléfonos Android.

---

## 1. Conceptos Clave

- **C++17 con RAII:** Gestión determinista de recursos del sistema operativo sin recolección de basura (*garbage collection*).
- **ONNX Runtime (C++ API):** API nativa de bajo nivel que ejecuta el grafo cuantizado `expresat_gru_int8.onnx` con instrucciones vectorizadas SIMD (AVX2/NEON).
- **Concurrencia Lock-Free:** Empleo de colas circulares atómicas Single-Producer Single-Consumer (SPSC) para transferir video e inferencias entre hilos sin bloqueos por exclusión mutua (*mutex contention*).

---

## 2. Componentes Principales (`expresat-native/core`)

1. **`inference_thread.h` / `.cpp`:** Administra el ciclo de vida de la sesión ONNX Runtime, preprocesamiento y ejecución del tensor `[1, 15, 178]`.
2. **`frame_queue.h`:** Búfer de anillo wait-free donde la cámara inserta fotogramas y el hilo de inferencia los extrae.
3. **`result_bus.h`:** Bus atómico donde se publica el resultado de la traducción más reciente para que el hilo de interfaz ImGui lo lea de forma asíncrona.
4. **`landmark_types.h`:** Definición estricta de estructuras para las 178 dimensiones corporales.

---

## 3. Fragmentos Clave de Código

### Configuración Optimizada de la Sesión ONNX Runtime
```cpp
// En inference_thread.cpp
InferenceThread::OrtState::OrtState() {
    // Configuración para latencia mínima en CPUs multi-core
    opts.SetInterOpNumThreads(1);
    opts.SetIntraOpNumThreads(
        static_cast<int>(std::min(4u, std::thread::hardware_concurrency()))
    );
    opts.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
    opts.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);
    opts.DisableCpuMemArena();
    opts.EnableMemPattern();
}
```

### Preprocesamiento y Ejecución del Tensor
```cpp
// Flattens the circular buffer to [1, 15, 178]
auto input_tensor = preprocess_sequence();
auto logits = run_onnx(input_tensor);

// Softmax + top-5 probability distribution
std::vector<float> probs = softmax(logits);
if (probs[max_idx] >= confidence_threshold_) {
    result_bus_.publish(labels_[max_idx]);
}
```

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Optimización de Memoria y Concurrencia:** Invocar **`cpp-pro`** y **`memory-safety-patterns`** (ver [[../../Skills/Backend_APIs_y_Sistemas]]).
- **Para Integración con Redes y Modelos ONNX:** Invocar **`ml-engineer`** (ver [[../../Skills/MachineLearning_y_Vision]]).
