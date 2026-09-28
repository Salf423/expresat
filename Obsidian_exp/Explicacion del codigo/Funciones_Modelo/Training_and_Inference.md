---
title: "Explicación del Código: Pipeline de Entrenamiento e Inferencia"
description: "Visión panorámica del subsistema de modelos: definición de SignLanguageGRU en PyTorch, exportación a formato ONNX, cuantización dinámica a INT8 e interfaz InferenceEngine."
version: "2.0.0"
category: "Código / IA & Modelado"
status: "Producción"
target_agents: ["ml-engineer", "mlops-engineer", "data-scientist"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `mlops-engineer`)"
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`python-performance-optimization`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[ENTRENO Y EXPORTACION]]"
  - "[[INFERENCIA]]"
  - "[[../../Caracteristicas]]"
  - "[[../../Flujo de datos]]"
---

# 🧠 Explicación del Código: Pipeline de Entrenamiento e Inferencia

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Modelos** > **Training & Inference**

El directorio `expresat/models/` contiene el ciclo completo de modelado de inteligencia artificial de **ExpresaT**, desde el entrenamiento en PyTorch hasta la exportación y ejecución optimizada con ONNX Runtime.

---

## 1. Conceptos Clave

- **PyTorch a ONNX:** Flujo de trabajo reproducible para definir la red neuronal en PyTorch, entrenarla y exportarla al formato universal ONNX para su ejecución multiplataforma.
- **Cuantización Dinámica INT8:** Reducción de la precisión de los pesos de punto flotante de 32 bits a enteros de 8 bits, reduciendo el tamaño a tan solo **4 KB** y manteniendo la exactitud de clasificación.
- **Arquitectura Recurrente GRU:** La red `SignLanguageGRU` modela dependencias temporales sobre secuencias de 15 fotogramas con vectores de 178 puntos geométricos.

---

## 2. Mapa de Archivos (`expresat/models`)

1. **`train_and_export.py`:** Pipeline integral: instanciación del modelo, generación de muestras sintéticas, entrenamiento con CrossEntropyLoss, guardado de checkpoints y exportación a ONNX (Float32 e INT8).
2. **`inference_engine.py`:** Wrapper en Python que carga el modelo ONNX cuantizado y su archivo `model_metadata.json`, realizando normalización de tensores e inferencia en CPU.
3. **`inference.py`:** Herramienta de línea de comandos para realizar pruebas de verificación y benchmarks de latencia.
4. **`exported_model/`:** Directorio de distribución que almacena los binarios compilados listos para producción.

---

## 3. Flujo del Pipeline de Exportación

```mermaid
flowchart LR
    A["PyTorch Model\n(SignLanguageGRU)"] -->|"train_and_export.py"| B["Checkpoint PyTorch\n(expresat_gru.pt)"]
    B -->|"torch.onnx.export (opset 17)"| C["ONNX Float32\n(~193 KB)"]
    C -->|"quantize_dynamic (INT8)"| D["ONNX INT8 Producción\n(~4 KB grafo)"]
    D -->|"Consumido por"| E["Backend FastAPI / C++ Nativo"]

    style A fill:#6b5a1a,color:#fff
    style B fill:#6b2d1a,color:#fff
    style C fill:#1a3a6b,color:#fff
    style D fill:#1d5b4a,color:#fff
    style E fill:#2d5a27,color:#fff
```

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Entrenamiento y Optimización de Redes:** Invocar **`ml-engineer`** y **`mlops-engineer`** (ver [[../../Skills/MachineLearning_y_Vision]]).
- **Para Validación de Tensores y Pruebas Unitarias:** Invocar **`python-testing-patterns`**.
