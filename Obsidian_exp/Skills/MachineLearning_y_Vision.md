---
title: "Skills Especializadas: Machine Learning, Visión por Computadora y Datos"
description: "Habilidades para entrenamiento de redes neuronales GRU en PyTorch, exportación a ONNX, cuantización INT8, MediaPipe Holistic y generación sintética de datasets."
version: "2.0.0"
category: "Skills / IA & Visión"
target_agents: ["ml-engineer", "data-scientist", "mlops-engineer"]
related_docs:
  - "[[00_Matriz_General_Skills]]"
  - "[[../Caracteristicas]]"
  - "[[../Flujo de datos]]"
  - "[[../Explicacion del codigo/Funciones_Modelo/ENTRENO Y EXPORTACION]]"
  - "[[../Explicacion del codigo/Funciones_Modelo/INFERENCIA]]"
  - "[[../Explicacion del codigo/Dataset_Generator/Cpp_Generator]]"
---

# 🧠 Skills Especializadas: Machine Learning, Visión por Computadora y Datos

> **Navegación:** [[../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[00_Matriz_General_Skills|🧭 Matriz de Skills]] > **Machine Learning, Visión y Datos**

El núcleo de inteligencia artificial de **ExpresaT** combina visión por computadora geométrica (MediaPipe Holistic) para la extracción de puntos de referencia corporales con una red neuronal recurrente compacta (**`SignLanguageGRU`**) optimizada para inferencia en CPU en menos de 3 milisegundos.

---

## 🛠️ Catálogo de Skills Instaladas en este Dominio

### 1. `ml-engineer` & `ai-engineer`
- **Ubicación:**
  - `~/.gemini/config/skills/ml-engineer/SKILL.md`
  - `~/.gemini/config/skills/ai-engineer/SKILL.md`
- **Objetivo:** Definición de arquitecturas neuronales con PyTorch, selección de hiperparámetros, funciones de pérdida (CrossEntropyLoss), optimizadores (AdamW) y evaluación de métricas de clasificación (Precisión, Recall, F1-Score).
- **Cuándo invocar:**
  - Añadir nuevas clases/gestos al vocabulario de lengua de señas.
  - Ajustar el tamaño oculto (`hidden_size`) o la tasa de dropout de `SignLanguageGRU`.

### 2. `mlops-engineer` & `machine-learning-ops-ml-pipeline`
- **Ubicación:**
  - `~/.gemini/config/skills/mlops-engineer/SKILL.md`
  - `~/.gemini/config/skills/machine-learning-ops-ml-pipeline/SKILL.md`
- **Objetivo:** Orquestación de pipelines de entrenamiento y exportación continua (PyTorch `.pt` → ONNX Float32 → ONNX INT8 dinámico → Benchmark de latencia).
- **Cuándo invocar:**
  - Automatizar re-entrenamientos cuando se suben nuevos archivos `dataset/*.json`.
  - Asegurar la compatibilidad del `opset_version` (opset 17) para ejecuciones tanto en Python como en C++.

### 3. `data-engineering-data-pipeline` & `data-quality-frameworks`
- **Ubicación:**
  - `~/.gemini/config/skills/data-engineering-data-pipeline/SKILL.md`
  - `~/.gemini/config/skills/data-quality-frameworks/SKILL.md`
- **Objetivo:** Validación de esquemas de datos vectoriales, detección de valores atípicos (outliers o pérdidas de tracking en MediaPipe), comprobación de integridad y contratos de datos.
- **Cuándo invocar:**
  - Validar los archivos generados por `expresat-dataset-generator`.
  - Auditar la normalización relativa al centro de los hombros ($C_{shoulder}$) para garantizar invariancia ante escala y posición.

### 4. `python-testing-patterns`
- **Ubicación:** `~/.gemini/config/skills/python-testing-patterns/SKILL.md`
- **Objetivo:** Creación de suites de pruebas unitarias (`pytest`) para el preprocesamiento de tensores y verificación de dimensiones de entrada `[1, 15, 178]`.

---

## 📐 Especificación del Vector de Características (178D)

Todo agente que manipule el modelo o los extractores de visión debe respetar la topología invariable:

```
[0 .. 51]   : Upper Pose (13 puntos × 4 coordenadas: x, y, z, visibilidad)
[52 .. 114] : Mano Izquierda (21 landmarks × 3 coordenadas: x, y, z)
[115 .. 177]: Mano Derecha (21 landmarks × 3 coordenadas: x, y, z)
Total       : 178 características flotantes por fotograma (15 frames = 2670 valores)
```

> [!CRITICAL] Regla de Normalización
> Todos los puntos espaciales deben trasladarse restando el punto medio entre los hombros (landmarks 11 y 12 de Pose) y escalarse según la distancia inter-humeral ($D_{shoulders}$) antes de alimentarse a la sesión de ONNX Runtime.
