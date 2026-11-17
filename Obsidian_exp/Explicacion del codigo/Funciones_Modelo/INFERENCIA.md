---
title: "Explicación del Código: Motor de Inferencia en Tiempo Real (InferenceEngine)"
description: "Implementación detallada de la inferencia en tiempo real en Python y C++: sesiones ONNX Runtime en CPU, normalización canónica con ExtractWindow v1.3.0 y evaluación del umbral de confianza."
version: "2.3.0"
category: "Código / IA & Inferencia"
status: "Producción"
target_agents: ["ml-engineer", "cpp-pro", "fastapi-pro"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`)"
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`, `fastapi-pro`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_3_0]]"
  - "[[Training_and_Inference]]"
  - "[[ENTRENO Y EXPORTACION]]"
  - "[[../Backend/Main C++]]"
  - "[[../../Caracteristicas]]"
---

# ⚡ Explicación del Código: Motor de Inferencia en Tiempo Real

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Modelos** > **Inferencia**

La inferencia de señas en **ExpresaT** (`expresat/models/inference_engine.py`) está diseñada para ejecutarse exclusivamente en CPUs estándar con una latencia inferior a 3 milisegundos, operando bajo el contrato matemático estricto de [[../../Especificacion_Feature_Spec_v1_3_0|FEATURE_SPEC v1.3.0]].

---

## 1. Conceptos Clave

1. **Sesión ONNX Runtime CPU:** Carga del grafo cuantizado `expresat_gru_int8.onnx` optimizado con SIMD (AVX2/NEON), prescindiendo de dependencias de GPU (CUDA/PyTorch en producción).
2. **Algoritmo `extract_window`:** Procesa la ventana deslizante de 15 frames aplicando la secuencia por bloques: validación de hombros, asignación de manos, remuestreo, escala y centro por mediana de ventana, y filtro EMA ($\alpha = 0.50$).
3. **Verificación de Versión e Integridad Criptográfica:** Comprueba que `feature_spec_version == "1.3.0"` y que el `config_hash` coincida con el cálculo SHA-256.
4. **Filtro de Umbral de Confianza (*Confidence Threshold*):** Las predicciones sólo se emiten si la probabilidad calculada tras el *Softmax* supera el valor configurado (por defecto `0.50`).

---

## 2. Inferencia en Python (`expresat/models/inference_engine.py`)

```python
import os
import json
import time
import threading
import numpy as np
import onnxruntime as ort

from models.feature_extractor import extract_window, FEATURE_SPEC_VERSION

class InferenceEngine:
    def __init__(self, model_dir: str, confidence_threshold: float = 0.50):
        self.model_dir = model_dir
        self.confidence_threshold = confidence_threshold
        self._lock = threading.Lock()
        
        # 1. Cargar y verificar metadatos
        self.load_metadata()
        self.verify_spec_compatibility()
        
        # 2. Iniciar sesión ONNX Runtime CPU
        model_file = os.path.join(model_dir, "expresat_gru_int8.onnx")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = min(4, os.cpu_count() or 1)
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = ort.InferenceSession(model_file, opts, providers=["CPUExecutionProvider"])
        
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name

    def predict(self, raw_frames: list[dict]) -> dict:
        t0 = time.perf_counter()
        
        # 3. Extracción y normalización canónica v1.3.0
        window_result = extract_window(raw_frames)
        if not window_result["valid"]:
            return {
                "label": None,
                "confidence": 0.0,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
                "error": window_result["error"]
            }

        # 4. Inferencia con ONNX Runtime
        tensor_178 = window_result["features"]  # Forma: (15, 178)
        input_data = np.expand_dims(tensor_178, axis=0).astype(np.float32)

        with self._lock:
            outputs = self.session.run([self.output_name], {self.input_name: input_data})
        
        # 5. Softmax y evaluación de umbral
        logits = outputs[0][0]
        exp_logits = np.exp(logits - np.max(logits))
        probs = exp_logits / np.sum(exp_logits)
        
        best_idx = int(np.argmax(probs))
        confidence = float(probs[best_idx])
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)

        all_probs = {self.labels[i]: round(float(probs[i]), 4) for i in range(len(self.labels))}

        if confidence >= self.confidence_threshold:
            return {
                "label": self.labels[best_idx],
                "confidence": round(confidence, 4),
                "latency_ms": latency_ms,
                "all_probabilities": all_probs
            }
        
        return {
            "label": None,
            "confidence": round(confidence, 4),
            "latency_ms": latency_ms,
            "all_probabilities": all_probs
        }
```

---

## 3. Estado de la Inferencia en C++ (`expresat-native`)

En `expresat-native/core/src/inference_thread.cpp`, el método `run()` implementa la inferencia en C++ mediante la API de ONNX Runtime C++.
- **Advertencia v1.3.0:** Como se documenta en [[../../Especificacion_Feature_Spec_v1_3_0|FEATURE_SPEC v1.3.0]], el motor C++ no implementa actualmente la secuencia por bloques de `extract_window` y emitirá códigos de error explícitos (`ERR_CPP_NOT_CONFORMANT` o `ERR_SHOULDERS_TOO_SMALL`) si se invoca con datos no preprocesados.

---

## 🤖 Guía de Operación para Agentes

- **Para Pruebas Rápidas de Inferencia:**
  ```python
  from expresat.models.inference_engine import InferenceEngine
  engine = InferenceEngine("exported_model")
  print(engine.get_info())
  ```
- **Paridad con JavaScript:** Comprobar que cualquier actualización a `predict()` preserve idéntico resultado contra el frontend (`src/engine/featureExtractor.js`).
