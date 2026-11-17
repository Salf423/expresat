---
title: "Explicación del Código: Motor de Inferencia Nativo en C++ (ONNX Runtime)"
description: "Arquitectura interna del motor de ejecución C++17: sesiones de ONNX Runtime con SIMD, colas circulares lock-free SPSC (FrameQueue), bus atómico (ResultBus) y estado de conformidad frente a FEATURE_SPEC v1.3.0."
version: "2.3.0"
category: "Código / Backend Nativo C++"
status: "Producción / En Transición v1.3.0"
target_agents: ["cpp-pro", "systems-engineer", "ml-engineer"]
recommended_skills:
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`, `memory-safety-patterns`)"
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_3_0]]"
  - "[[Python_FastAPI]]"
  - "[[../Frontend]]"
  - "[[../../Flujo de datos]]"
  - "[[../Funciones_Modelo/INFERENCIA]]"
---

# ⚡ Explicación del Código: Motor de Inferencia Nativo en C++ (ONNX Runtime)

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Backend** > **Main C++**

El subsistema nativo (`expresat-native/core`) constituye la implementación en **C++17** de alto rendimiento de **ExpresaT**. Proporciona un motor de inferencia desacoplado de la red, diseñado para operar tanto en escritorios convencionales (Linux/Windows) como en dispositivos móviles Android (NDK/ARM64).

---

## 1. Decisiones Arquitectónicas y Patrones C++17

- **Patrón PIMPL (*Pointer to Implementation*):** El estado de la sesión ONNX Runtime (`OrtState`) está encapsulado en un struct privado dentro de `inference_thread.cpp`, aislando los encabezados pesados de `<onnxruntime_cxx_api.h>` y acelerando los tiempos de compilación.
- **Gestión RAII (*Resource Acquisition Is Initialization*):** Todos los descriptores de textura OpenGL, sesiones de memoria de ONNX Runtime (`Ort::MemoryInfo`) y punteros de cámara OpenCV se liberan de forma determinista al destruir los objetos.
- **Concurrencia Lock-Free (SPSC):** Empleo de colas circulares atómicas Single-Producer Single-Consumer (`FrameQueue<N>`) para comunicar el hilo de cámara con el hilo de inferencia sin bloqueos por exclusión mutua (*mutex contention*).
- **Publicación Atómica en `ResultBus`:** Lectura sin esperas (*wait-free read*) por parte del bucle de interfaz gráfica (60 FPS) del resultado publicado por el hilo de inferencia (~15 Hz).

---

## 2. Componentes Principales (`expresat-native/core`)

```text
expresat-native/core/
├── include/
│   ├── inference_thread.h       # Definición de la clase InferenceThread y estado de buffers
│   ├── frame_queue.h            # Cola circular SPSC lock-free basada en std::atomic
│   ├── result_bus.h             # Bus atómico para compartir etiquetas y probabilidades
│   └── landmark_types.h         # Tipos estrictos (PoseLandmark, HandLandmark, LandmarkFrame)
└── src/
    └── inference_thread.cpp     # Carga de ONNX, normalización a hombros y loop de inferencia
```

---

## 3. Implementación: Normalización a Hombros y Desacoplamiento de Muñeca

En `inference_thread.cpp`, el método `normalize_to_shoulders` implementa la normalización de coordenadas espaciales:

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

## 4. Estado de Conformidad con FEATURE_SPEC v1.3.0

> [!WARNING] Alerta de Seguridad de Ingeniería (v1.3.0)
> La especificación canónica [[../../Especificacion_Feature_Spec_v1_3_0|FEATURE_SPEC v1.3.0]] define el algoritmo `ExtractWindow` que opera sobre secuencias completas de 15 frames:
> - Remuestreo por bloques anatómicos independientes.
> - Cálculo de escala inter-humeral por la **mediana de la ventana** ($D_{\text{ventana}} = \text{mediana}(D_0 \dots D_{14})$).
> - Filtro EMA ($\alpha = 0.50$) con reinicio automático de estado cuando una mano reaparece.
> 
> Dado que `InferenceThread::normalize_to_shoulders` procesa fotogramas de forma aislada sin implementar la secuencia por bloques de `ExtractWindow`, el pipeline nativo C++ **está formalmente clasificado como NO CONFORME con FEATURE_SPEC v1.3.0**.
> Para preservar la integridad del sistema y evitar predicciones espurias, cualquier invocación directa sin la ventana precalculada debe retornar un código de error explícito (`ERR_CPP_NOT_CONFORMANT` o `ERR_SHOULDERS_TOO_SMALL`) en vez de generar tensores con valores silenciosamente corruptos.

---

## 5. Configuración de Sesión ONNX Runtime para CPU

```cpp
InferenceThread::OrtState::OrtState() {
    // Optimización para mínima latencia en procesadores x86_64 / ARM64
    opts.SetInterOpNumThreads(1);
    opts.SetIntraOpNumThreads(
        static_cast<int>(std::min(4u, std::thread::hardware_concurrency()))
    );
    opts.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
    opts.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);
    opts.DisableCpuMemArena();
    opts.EnableMemPattern();
    opts.SetLogSeverityLevel(3); // Loguear únicamente errores severos
}
```

---

## 🤖 Guía de Operación para Agentes C++

1. **Memoria y Punteros:** No usar raw pointers para gestionar buffers. Utilizar `std::unique_ptr` o `std::array`.
2. **Concurrencia:** Mantener la política de memoria lock-free de `FrameQueue<N>`. Nunca introducir `std::mutex` en el camino crítico de captura o inferencia sin justificación estricta de rendimiento.
3. **Validación de Tests:** Compilar y ejecutar pruebas nativas con:
   ```bash
   cd expresat-native
   cmake -B build -DCMAKE_BUILD_TYPE=Release
   cmake --build build -j$(nproc)
   python scripts/bench_native.py
   ```
