---
title: "Explicación del Código: Pipeline de Entrenamiento e Inferencia"
description: "Visión panorámica del subsistema de modelos de ExpresaT: extractor canónico feature_extractor.py v1.3.0, red SignLanguageGRU en PyTorch, exportación ONNX opset 17, cuantización INT8 y clase InferenceEngine."
version: "2.3.0"
category: "Código / IA & Modelado"
status: "Producción"
target_agents: ["ml-engineer", "mlops-engineer", "data-scientist"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `mlops-engineer`, `data-engineering-data-pipeline`)"
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`python-performance-optimization`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_3_0]]"
  - "[[ENTRENO Y EXPORTACION]]"
  - "[[INFERENCIA]]"
  - "[[../../Caracteristicas]]"
  - "[[../../Flujo de datos]]"
---

# 🧠 Explicación del Código: Pipeline de Entrenamiento e Inferencia

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Modelos** > **Training & Inference**

El directorio `expresat/models/` y el directorio `tests/` gestionan el ciclo completo de inteligencia artificial de **ExpresaT**, desde la extracción canónica de 178 características bajo [[../../Especificacion_Feature_Spec_v1_3_0|FEATURE_SPEC v1.3.0]] hasta el entrenamiento supervisado y la inferencia cuantizada con ONNX Runtime en CPU.

---

## 1. Conceptos Clave

- **Extractor Canónico (`feature_extractor.py`):** Implementación de referencia en Python que implementa `extract_canonical_features(pose, left_hand, right_hand)` y `extract_window(frames)`. Aplica normalización por centroide 3D de hombros ($C$), escala euclidiana inter-humeral ($D \ge 0.08$), desacoplamiento del eje $Z$ en manos respecto a su propia muñeca y relleno de 63 ceros exactos en ausencia de mano.
- **Verificación Criptográfica (`config_hash`):** Control estricto de integridad SHA-256 en `InferenceEngine` que valida tanto la configuración dimensional como el digest de `tests/fixtures/feature_spec_cases.json`.
- **Cuantización Dinámica a INT8:** Reducción del modelo flotante de ~193 KB a tan solo **~4 KB de grafo**, acelerando la inferencia en CPU a **2.02 ms**.
- **Red Neuronal `SignLanguageGRU`:** Modelo recurrente compacto (~12,000 parámetros) que procesa tensores de entrada `(1, 15, 178)` en `float32`.

---

## 2. Mapa de Archivos (`expresat/models` y `tests/`)

| Archivo | Responsabilidad Técnica | Estado |
|---|---|---|
| **`feature_extractor.py`** | Extractor canónico v1.3.0: `extract_canonical_features`, `extract_window`, asignación conjunta de manos y filtro EMA por bloques. | **Producción** |
| **`train_and_export.py`** | Pipeline automatizado de entrenamiento: PyTorch `SignLanguageGRU` → Exportación ONNX opset 17 → Cuantización INT8 dinámica → Sellado de metadatos. | **Producción** |
| **`inference_engine.py`** | Motor de inferencia en CPU con ONNX Runtime, validación de compatibilidad `major.minor` y ejecución no bloqueante. | **Producción** |
| **`tests/test_feature_spec.py`** | Suite de pruebas de paridad matemática contra `feature_spec_cases.json` con tolerancia $\|v_{\text{obtenido}} - v_{\text{esperado}}\|_\infty \le 10^{-6}$. | **Tests** |
| **`exported_model/`** | Directorio de artefactos de producción: `expresat_gru_int8.onnx`, `expresat_gru_float32.onnx` y `model_metadata.json`. | **Artefactos** |
| **`inference.py`** | Script CLI antiguo. | **[OBSOLETO] Reemplazado por `inference_engine.py`** |

---

## 3. Flujo del Pipeline de Exportación

```mermaid
flowchart LR
    A["Dataset v2 / Raw Captures\n(Excluye quarantine/)"] --> B["Extractor Canónico\n(feature_extractor.py v1.3.0)"]
    B --> C["Entrenamiento PyTorch\n(SignLanguageGRU)"]
    C --> D["Checkpoint\n(expresat_gru.pt)"]
    D -->|"torch.onnx.export"| E["ONNX Float32\n(~193 KB)"]
    E -->|"quantize_dynamic"| F["ONNX INT8\n(~4 KB grafo)"]
    F --> G["Sellado con config_hash\n(model_metadata.json)"]
    G --> H["Despliegue\n(FastAPI / main.py)"]

    style A fill:#6b2d1a,color:#fff
    style B fill:#1a3a6b,color:#fff
    style C fill:#6b5a1a,color:#fff
    style D fill:#4a2d6b,color:#fff
    style E fill:#2b4a6b,color:#fff
    style F fill:#1d5b4a,color:#fff
    style G fill:#2d5a27,color:#fff
    style H fill:#1e293b,color:#fff
```

---

## 🤖 Guía de Operación para Agentes ML

- **Verificar Paridad Numérica:**
  ```bash
  pytest tests/test_feature_spec.py -v
  ```
- **Reentrenar y Exportar el Modelo:**
  ```bash
  python expresat/models/train_and_export.py --epochs 50 --output ./exported_model
  ```
- **Auditar el Estado del Motor de Inferencia:**
  ```bash
  python -c "from expresat.models.inference_engine import InferenceEngine; e = InferenceEngine('exported_model'); print(e.get_info())"
  ```
