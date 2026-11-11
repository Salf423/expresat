---
title: "Skills Especializadas: Machine Learning, Visión por Computadora y Datos"
description: "Habilidades para entrenamiento de redes neuronales GRU en PyTorch, exportación a ONNX, cuantización INT8, MediaPipe Tasks Vision y especificación canónica 178D (FEATURE_SPEC v1.2.1)."
version: "2.2.1"
category: "Skills / IA & Visión"
target_agents: ["ml-engineer", "data-scientist", "mlops-engineer", "data-engineering-data-pipeline"]
related_docs:
  - "[[00_Matriz_General_Skills]]"
  - "[[../Caracteristicas]]"
  - "[[../Especificacion_Feature_Spec_v1_2_1]]"
  - "[[../Flujo de datos]]"
  - "[[../Explicacion del codigo/Funciones_Modelo/ENTRENO Y EXPORTACION]]"
  - "[[../Explicacion del codigo/Funciones_Modelo/INFERENCIA]]"
  - "[[../Explicacion del codigo/Dataset_Generator/06_Arquitectura_Dataset_Generator_v2]]"
---

# 🧠 Skills Especializadas: Machine Learning, Visión por Computadora y Datos

> **Navegación:** [[../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[00_Matriz_General_Skills|🧭 Matriz de Skills]] > **Machine Learning, Visión y Datos**

El núcleo de inteligencia artificial de **ExpresaT** combina visión por computadora geométrica (MediaPipe Tasks Vision en CPU) para la extracción de puntos de referencia corporales con una red neuronal recurrente compacta (**`SignLanguageGRU`**) optimizada para inferencia en CPU en menos de 3 milisegundos, bajo el contrato matemático estricto de [[../Especificacion_Feature_Spec_v1_2_1|FEATURE_SPEC v1.2.1]].

---

## 🛠️ Catálogo de Skills Instaladas en este Dominio

### 1. `ml-engineer` & `ai-engineer`
- **Ubicación:**
  - `~/.gemini/config/skills/ml-engineer/SKILL.md`
  - `~/.gemini/config/skills/ai-engineer/SKILL.md`
- **Objetivo:** Definición de arquitecturas neuronales con PyTorch, selección de hiperparámetros, funciones de pérdida (CrossEntropyLoss), optimizadores (AdamW) y evaluación de métricas de clasificación (Precisión, Recall, F1-Score).
- **Cuándo invocar:**
  - Añadir nuevas clases/gestos al catálogo oficial de lengua de señas (`catalog/signs_catalog.json`).
  - Ajustar hiperparámetros de `SignLanguageGRU` o afinar el extractor `feature_extractor.py`.

### 2. `mlops-engineer` & `machine-learning-ops-ml-pipeline`
- **Ubicación:**
  - `~/.gemini/config/skills/mlops-engineer/SKILL.md`
  - `~/.gemini/config/skills/machine-learning-ops-ml-pipeline/SKILL.md`
- **Objetivo:** Orquestación de pipelines de reentrenamiento, versionado de modelos, exportación continua (PyTorch `.pt` → ONNX Float32 → ONNX INT8 dinámico → Benchmark de latencia) y verificación de `config_hash`.
- **Cuándo invocar:**
  - Automatizar pipelines CI/CD cuando se generen nuevos shards `.npy` con el generador v2.
  - Asegurar la compatibilidad del `opset_version` (opset 17) para ejecuciones tanto en Python como en C++.

### 3. `data-engineering-data-pipeline` & `data-quality-frameworks`
- **Ubicación:**
  - `~/.gemini/config/skills/data-engineering-data-pipeline/SKILL.md`
  - `~/.gemini/config/skills/data-quality-frameworks/SKILL.md`
- **Objetivo:** Validación de esquemas de datos vectoriales 178D, comprobación de integridad, detección de outliers y cuarentena de datasets corruptos.
- **Cuándo invocar:**
  - Auditar datasets entrantes contra el contrato [[../Especificacion_Feature_Spec_v1_2_1|FEATURE_SPEC v1.2.1]].
  - Asegurar que ningún pipeline de entrenamiento consuma archivos aislados en `dataset/quarantine/` (como `letra_a_derecha_2.json`).

### 4. `python-testing-patterns`
- **Ubicación:** `~/.gemini/config/skills/python-testing-patterns/SKILL.md`
- **Objetivo:** Creación y mantenimiento de suites de pruebas automáticas (`pytest tests/test_feature_spec.py`).

---

## 📐 Reglas Invariables del Vector de Características (178D v1.2.1)

Todo agente que manipule el modelo o los extractores de visión debe respetar la topología invariable:

```
[0 .. 51]   : Upper Pose (13 puntos × 4 coordenadas: x, y, z, visibilidad)
[52 .. 114] : Mano Izquierda (21 landmarks × 3 coordenadas: x, y, z)
[115 .. 177]: Mano Derecha (21 landmarks × 3 coordenadas: x, y, z)
Total       : 178 características flotantes por fotograma (15 frames = 2,670 valores)
```

> [!CRITICAL] Regla de Normalización Canónica (FEATURE_SPEC v1.2.1)
> 1. **Origen ($C$):** Punto medio 3D entre los hombros (`(pose[11] + pose[12]) / 2`).
> 2. **Escala ($D$):** Distancia euclidiana 3D inter-humeral $\text{dist3D}(P_{11}, P_{12})$. Requiere $D \ge 0.08$.
> 3. **Upper Pose:** $(x-C_x)/D, \; (y-C_y)/D, \; (z-C_z)/D, \; \text{clamp}(vis, 0, 1)$.
> 4. **Manos:** En $XY$, relativas al centro de hombros. En el eje $Z$, **relativas a la propia muñeca de la mano** escalada por $D$: $(z - z_{wrist})/D$.
> 5. **Manos Ausentes:** Estrictamente **63 ceros exactos (`0.0f`)** (`OK_HAND_MISSING`).
> 6. **Tolerancia Numérica:** Toda implementación debe verificar la suite TC-01 a TC-05C con tolerancia $|\Delta| \le 10^{-6}$.
