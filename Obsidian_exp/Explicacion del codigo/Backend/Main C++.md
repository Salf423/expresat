---
title: "Explicación del Código: Motor de Inferencia Nativo en C++ (ONNX Runtime)"
description: "Arquitectura interna del motor de ejecución en C++17: sesiones optimizadas de ONNX Runtime, colas circulares lock-free SPSC, paralelismo de CPU y normalización alineada a FEATURE_SPEC v1.2.1."
version: "2.2.1"
category: "Código / Backend Nativo C++"
status: "Producción"
target_agents: ["cpp-pro", "systems-engineer", "ml-engineer"]
recommended_skills:
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`, `memory-safety-patterns`)"
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_2_1]]"
  - "[[Python_FastAPI]]"
  - "[[../Frontend]]"
  - "[[../../Flujo de datos]]"
  - "[[../Funciones_Modelo/INFERENCIA]]"
---

# ⚡ Explicación del Código: Motor de Inferencia Nativo en C++ (ONNX Runtime)

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Backend** > **Main C++**

El subsistema nativo (`expresat-native/core`) constituye la implementación en C++17 de alto rendimiento de **ExpresaT**. Proporciona un motor de inferencia desacoplado de la red, diseñado para operar tanto en escritorios convencionales como en arquitecturas ARM en teléfonos Android, alineado estrictamente con [[../../Especificacion_Feature_Spec_v1_2_1|FEATURE_SPEC v1.2.1]].

---

## 1. Conceptos Clave

- **C++17 con RAII:** Gestión determinista de recursos del sistema operativo sin recolección de basura (*garbage collection*).
- **ONNX Runtime (C++ API):** API nativa de bajo nivel que ejecuta el grafo cuantizado `expresat_gru_int8.onnx` con instrucciones vectorizadas SIMD (AVX2/NEON).
- **Concurrencia Lock-Free:** Empleo de colas circulares atómicas Single-Producer Single-Consumer (SPSC) para transferir video e inferencias entre hilos sin bloqueos por exclusión mutua (*mutex contention*).
- **Normalización Canónica v1.2.1:** Implementación idéntica en C++ de la distancia euclidiana 3D inter-humeral, desacoplamiento del eje $Z$ en manos y relleno de ceros.

---

## 2. Componentes Principales (`expresat-native/core`)

1. **`inference_thread.h` / `.cpp`:** Administra el ciclo de vida de la sesión ONNX Runtime, preprocesamiento y ejecución del tensor `[1, 15, 178]`.
2. **`frame_queue.h`:** Búfer de anillo wait-free donde la cámara inserta fotogramas y el hilo de inferencia los extrae.
3. **`result_bus.h`:** Bus atómico donde se publica el resultado de la traducción más reciente para que el hilo de interfaz ImGui lo lea de forma asíncrona.
4. **`landmark_types.h`:** Definición estricta de estructuras para las 178 dimensiones corporales.

---

## 3. Implementación Canónica: Normalización a Hombros (v1.2.1)

En `inference_thread.cpp`, el método `normalize_to_shoulders` fue actualizado para cumplir exactamente con la especificación matemática unificada:

```cpp
// En expresat-native/core/src/inference_thread.cpp
bool InferenceThread::normalize_to_shoulders(
    float* features, int n,
    const PoseLandmark& ls, const PoseLandmark& rs,
    const std::vector<HandLandmark>& left_hand,
    const std::vector<HandLandmark>& right_hand)
{
    (void)n;
    constexpr float SHOULDERS_D_MIN = 0.08f;
    constexpr float SHOULDER_VIS_THRESH = 0.40f;

    // 1. Validación de visibilidad de hombros
    if (ls.visibility < SHOULDER_VIS_THRESH || rs.visibility < SHOULDER_VIS_THRESH) {
        return false;
    }

    // 2. Centroide de hombros 3D
    const float cx = (ls.x + rs.x) * 0.5f;
    const float cy = (ls.y + rs.y) * 0.5f;
    const float cz = (ls.z + rs.z) * 0.5f;

    // 3. Escala Euclidiana 3D
    const float dx = ls.x - rs.x;
    const float dy = ls.y - rs.y;
    const float dz = ls.z - rs.z;
    const float scale = std::sqrt(dx * dx + dy * dy + dz * dz);

    if (scale < SHOULDERS_D_MIN) {
        return false;
    }

    // 4. Upper Pose [0..51]: x'=(x-cx)/D, y'=(y-cy)/D, z'=(z-cz)/D, vis'=clamp(vis, 0, 1)
    constexpr int POSE_END = static_cast<int>(POSE_UPPER_INDICES.size()) * POSE_COORDS;
    for (int j = 0; j < POSE_END; j += POSE_COORDS) {
        features[j + 0] = (features[j + 0] - cx) / scale;
        features[j + 1] = (features[j + 1] - cy) / scale;
        features[j + 2] = (features[j + 2] - cz) / scale;
        features[j + 3] = std::max(0.0f, std::min(1.0f, features[j + 3]));
    }

    // 5. Mano Izquierda [52..114]: Z relativo a la muñeca propia. Ceros si está ausente.
    if (!left_hand.empty()) {
        const float z_wrist = left_hand[0].z;
        for (std::size_t i = 0; i < std::min(left_hand.size(), static_cast<std::size_t>(HAND_POINTS)); ++i) {
            features[52 + i * 3 + 0] = (left_hand[i].x - cx) / scale;
            features[52 + i * 3 + 1] = (left_hand[i].y - cy) / scale;
            features[52 + i * 3 + 2] = (left_hand[i].z - z_wrist) / scale;
        }
    } else {
        std::fill(features + 52, features + 115, 0.0f);
    }

    // 6. Mano Derecha [115..177]: Z relativo a la muñeca propia. Ceros si está ausente.
    if (!right_hand.empty()) {
        const float z_wrist = right_hand[0].z;
        for (std::size_t i = 0; i < std::min(right_hand.size(), static_cast<std::size_t>(HAND_POINTS)); ++i) {
            features[115 + i * 3 + 0] = (right_hand[i].x - cx) / scale;
            features[115 + i * 3 + 1] = (right_hand[i].y - cy) / scale;
            features[115 + i * 3 + 2] = (right_hand[i].z - z_wrist) / scale;
        }
    } else {
        std::fill(features + 115, features + 178, 0.0f);
    }

    return true;
}
```

---

## 4. Configuración de Sesión ONNX Runtime

```cpp
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

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Optimización de Memoria y Concurrencia:** Invocar **`cpp-pro`** y **`memory-safety-patterns`** (ver [[../../Skills/Backend_APIs_y_Sistemas]]).
- **Para Integración con Redes y Modelos ONNX:** Invocar **`ml-engineer`** (ver [[../../Skills/MachineLearning_y_Vision]]).
- **Para Contratos de Características:** Consultar [[../../Especificacion_Feature_Spec_v1_2_1]].
