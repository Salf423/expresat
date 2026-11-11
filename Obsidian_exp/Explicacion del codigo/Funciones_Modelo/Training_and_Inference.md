---
title: "Explicación del Código: Pipeline de Entrenamiento e Inferencia"
description: "Visión panorámica del subsistema de modelos: extractor canónico feature_extractor.py v1.2.1, SignLanguageGRU en PyTorch, exportación ONNX, cuantización INT8 e interfaz InferenceEngine."
version: "2.2.1"
category: "Código / IA & Modelado"
status: "Producción"
target_agents: ["ml-engineer", "mlops-engineer", "data-scientist"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `mlops-engineer`, `data-engineering-data-pipeline`)"
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`python-performance-optimization`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_2_1]]"
  - "[[ENTRENO Y EXPORTACION]]"
  - "[[INFERENCIA]]"
  - "[[../../Caracteristicas]]"
  - "[[../../Flujo de datos]]"
---

# 🧠 Explicación del Código: Pipeline de Entrenamiento e Inferencia

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Modelos** > **Training & Inference**

El directorio `expresat/models/` y el directorio `tests/` gestionan el ciclo completo de modelado de inteligencia artificial de **ExpresaT**, desde la extracción geométrica canónica hasta el entrenamiento supervisado y la inferencia cuantizada con ONNX Runtime.

---

## 1. Conceptos Clave

- **Extractor Canónico (`feature_extractor.py`):** Implementación canónica en Python de [[../../Especificacion_Feature_Spec_v1_2_1|FEATURE_SPEC v1.2.1]]. Gestiona la normalización de hombros 3D, el desacoplamiento de $Z$ en manos relativo a muñeca, asignación conjunta de manos y filtro EMA de ventana.
- **Verificación de Contrato y Config Hash:** Comprobación automática de `feature_spec_version = "1.2.1"` y validación de hash SHA-256 (`config_hash`) en `InferenceEngine` y en el exportador para evitar incompatibilidades numéricas en producción.
- **Cuantización Dinámica INT8:** Reducción de tamaño del grafo a tan solo **4 KB + 193 KB de datos**, manteniendo inferencias ultrarrápidas de **2.02 ms** en CPU.
- **Arquitectura Recurrente GRU:** La red `SignLanguageGRU` procesa tensores estandarizados de entrada `(1, 15, 178)` en `float32`.

---

## 2. Mapa de Archivos (`expresat/models` y `tests/`)

1. **`feature_extractor.py`:** Extractor canónico v1.2.1:
   - Funciones `extract_canonical_features(pose, left_hand, right_hand)` y `extract_window_features(frames, fps)`.
   - Normalización 3D y asignación húngara por costo mínimo.
2. **`tests/test_feature_spec.py`:** Suite de pruebas que verifica la conformidad con fixtures canónicas (TC-01 a TC-05C) con tolerancia $|\Delta| \le 10^{-6}$.
3. **`train_and_export.py`:** Pipeline continuo: carga de datasets válidos (excluyendo los que están en `dataset/quarantine/`), entrenamiento de `SignLanguageGRU`, exportación a ONNX (Float32 e INT8) y generación de `model_metadata.json`.
4. **`inference_engine.py`:** Wrapper en Python que carga el grafo ONNX cuantizado, valida el `config_hash` y expone el método `predict(frames)`.
5. **`inference.py`:** Herramienta CLI para benchmarking de latencia y pruebas de humo en local.
6. **`exported_model/`:** Directorio de artefactos compilados: `expresat_gru_int8.onnx`, `expresat_gru_float32.onnx` y `model_metadata.json`.

---

## 3. Flujo del Pipeline de Exportación

```mermaid
flowchart LR
    A["Dataset v2 / Raw Captures\n(Excluye quarantine/)"] --> B["Extractor Canónico\n(feature_extractor.py v1.2.1)"]
    B --> C["Entrenamiento PyTorch\n(SignLanguageGRU)"]
    C --> D["Checkpoint\n(expresat_gru.pt)"]
    D -->|"torch.onnx.export"| E["ONNX Float32\n(~193 KB)"]
    E -->|"quantize_dynamic"| F["ONNX INT8\n(~4 KB grafo)"]
    F --> G["Verificación config_hash\n(model_metadata.json)"]
    G --> H["Despliegue\n(FastAPI / C++ Nativo)"]

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

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Extracción y Contratos de Datos:** Consultar [[../../Especificacion_Feature_Spec_v1_2_1]] e invocar **`data-engineering-data-pipeline`**.
- **Para Entrenamiento y Optimización de Redes:** Invocar **`ml-engineer`** y **`mlops-engineer`** (ver [[../../Skills/MachineLearning_y_Vision]]).
- **Para Pruebas Unitarias de Tensores:** Ejecutar `pytest tests/test_feature_spec.py -v`.
