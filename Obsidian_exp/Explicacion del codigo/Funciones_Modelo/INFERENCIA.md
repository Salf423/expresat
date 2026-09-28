---
title: "Explicación del Código: Motor de Inferencia en Tiempo Real"
description: "Implementación detallada de la inferencia en C++ y Python: carga de sesiones ONNX Runtime, normalización respecto a hombros y evaluación de umbral de confianza."
version: "2.0.0"
category: "Código / IA & Inferencia"
status: "Producción"
target_agents: ["ml-engineer", "cpp-pro", "fastapi-pro"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`)"
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`, `fastapi-pro`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[Training_and_Inference]]"
  - "[[ENTRENO Y EXPORTACION]]"
  - "[[../Backend/Main C++]]"
  - "[[../../Caracteristicas]]"
---

# ⚡ Explicación del Código: Motor de Inferencia en Tiempo Real

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Modelos** > **Inferencia**

La inferencia de señas en **ExpresaT** está diseñada para ejecutarse en CPUs estándar con una latencia de ~2 milisegundos, tanto en Python (`inference_engine.py`) como en C++ (`InferenceThread`).

---

## 1. Conceptos Clave

1. **Inferencia ONNX Runtime:** Ejecución del grafo cuantizado `expresat_gru_int8.onnx` con soporte multi-hilo en CPU.
2. **Buffer de Secuencia (Ventana Temporal):** Acumulación circular de 15 fotogramas contiguos (1 segundo a 15 FPS) para alimentar la red recurrente.
3. **Filtro de Umbral de Confianza (*Confidence Threshold*):** Las predicciones sólo se emiten si la probabilidad calculada tras el *Softmax* supera el valor configurado (por defecto `0.50` en desarrollo y `0.80` en entornos de alta exigencia).

---

## 2. Bucle de Inferencia en C++ (`expresat-native/core/inference_thread.cpp`)

```cpp
void InferenceThread::run(const std::atomic<bool> &running) {
    while (running) {
        cv::Mat current_frame;
        // 1. Extraer fotograma de la cola lock-free (sin bloqueo de mutex)
        if (!frame_queue_.pop(current_frame)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
            continue;
        }

        // 2. Extraer puntos clave anatómicos (178D)
        LandmarkFrame lm_frame = extract_landmarks(current_frame);

        // 3. Insertar en el buffer circular de 15 frames
        push_landmark_frame(std::move(lm_frame));

        if (frames_accumulated_ < SEQUENCE_LENGTH) continue;

        // 4. Aplanar buffer a un tensor continuo de dimensiones [1, 15, 178]
        auto input_tensor = preprocess_sequence();

        // 5. Inferencia con ONNX Runtime C++ API
        auto logits = run_onnx(input_tensor);

        // 6. Post-procesado: Softmax + Top-5 probabilidades
        std::vector<float> probs = softmax(logits);
        int best_class = std::distance(probs.begin(), std::max_element(probs.begin(), probs.end()));

        if (probs[best_class] >= confidence_threshold_) {
            result_bus_.publish(labels_[best_class]);
        }
    }
}
```

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Inferencia Nativa C++:** Invocar **`cpp-pro`** (ver [[../../Skills/Backend_APIs_y_Sistemas]]).
- **Para Inferencia Asíncrona Python:** Invocar **`fastapi-pro`** y **`async-python-patterns`**.
- **Para Precisión y Métrica del Modelo:** Invocar **`ml-engineer`** (ver [[../../Skills/MachineLearning_y_Vision]]).