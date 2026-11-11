---
title: "Explicación del Código: Motor de Inferencia en Tiempo Real"
description: "Implementación detallada de la inferencia en C++ y Python: sesiones ONNX Runtime, normalización conforme a FEATURE_SPEC v1.2.1 y evaluación de umbral de confianza."
version: "2.2.1"
category: "Código / IA & Inferencia"
status: "Producción"
target_agents: ["ml-engineer", "cpp-pro", "fastapi-pro"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`)"
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`, `fastapi-pro`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_2_1]]"
  - "[[Training_and_Inference]]"
  - "[[ENTRENO Y EXPORTACION]]"
  - "[[../Backend/Main C++]]"
  - "[[../../Caracteristicas]]"
---

# ⚡ Explicación del Código: Motor de Inferencia en Tiempo Real

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Modelos** > **Inferencia**

La inferencia de señas en **ExpresaT** está diseñada para ejecutarse en CPUs estándar con una latencia de ~2 milisegundos, tanto en Python (`inference_engine.py`) como en C++ (`InferenceThread`), operando estrictamente bajo el contrato de [[../../Especificacion_Feature_Spec_v1_2_1|FEATURE_SPEC v1.2.1]].

---

## 1. Conceptos Clave

1. **Inferencia ONNX Runtime:** Ejecución del grafo cuantizado `expresat_gru_int8.onnx` con soporte multi-hilo en CPU.
2. **Buffer de Secuencia (Ventana Temporal):** Acumulación circular de 15 fotogramas contiguos (1 segundo a 15 FPS) para alimentar la red recurrente.
3. **Verificación de Versión e Integridad:** `InferenceEngine` verifica que `feature_spec_version == "1.2.1"` y que el `config_hash` coincida con el cálculo canónico SHA-256.
4. **Filtro de Umbral de Confianza (*Confidence Threshold*):** Las predicciones sólo se emiten si la probabilidad calculada tras el *Softmax* supera el valor configurado (por defecto `0.50`).

---

## 2. Inferencia en Python (`expresat/models/inference_engine.py`)

En el backend asíncrono, `InferenceEngine` delega la vectorización al extractor canónico `feature_extractor.py`:

```python
# En expresat/models/inference_engine.py
from models.feature_extractor import extract_window_features, CANONICAL_SPEC_VERSION

class InferenceEngine:
    def __init__(self, model_dir: str, confidence_threshold: float = 0.50):
        self.load_metadata(model_dir)
        self.verify_spec_compatibility()
        self.session = ort.InferenceSession(os.path.join(model_dir, "expresat_gru_int8.onnx"))

    def predict(self, raw_frames: list) -> dict:
        # Extracción y normalización canónica v1.2.1 con filtro EMA y mediana
        tensor_178 = extract_window_features(raw_frames, target_fps=15)
        if tensor_178 is None:
            return {"label": None, "confidence": 0.0, "status": "INVALID_WINDOW"}

        # Inferencia con ONNX Runtime
        input_data = np.expand_dims(tensor_178, axis=0).astype(np.float32)
        outputs = self.session.run(None, {self.input_name: input_data})
        probs = softmax(outputs[0][0])
        best_idx = int(np.argmax(probs))
        
        confidence = float(probs[best_idx])
        if confidence >= self.confidence_threshold:
            return {"label": self.labels[best_idx], "confidence": confidence}
        return {"label": None, "confidence": confidence}
```

---

## 3. Bucle de Inferencia en C++ (`expresat-native/core/src/inference_thread.cpp`)

```cpp
void InferenceThread::run(const std::atomic<bool> &running) {
    while (running) {
        cv::Mat current_frame;
        // 1. Extraer fotograma de la cola lock-free
        if (!frame_queue_.pop(current_frame)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
            continue;
        }

        // 2. Extraer puntos clave anatómicos
        LandmarkFrame lm_frame = extract_landmarks(current_frame);

        // 3. Insertar en el buffer circular de 15 frames
        push_landmark_frame(std::move(lm_frame));
        if (frames_accumulated_ < SEQUENCE_LENGTH) continue;

        // 4. Preprocesar y normalizar a hombros según FEATURE_SPEC v1.2.1
        //    (Escala 3D, Z relativo a muñeca en manos, visibilidad clamp)
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
- **Para Conformidad Matemática:** Consultar [[../../Especificacion_Feature_Spec_v1_2_1]].
