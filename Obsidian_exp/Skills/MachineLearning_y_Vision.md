---
title: "Skills Especializadas: Machine Learning, Visión por Computadora y Datos"
description: "Habilidades para entrenamiento de redes neuronales GRU en PyTorch, exportación a ONNX opset 17, cuantización INT8, MediaPipe Tasks Vision CPU y especificación canónica 178D (FEATURE_SPEC v1.3.0)."
version: "2.3.0"
category: "Skills / IA & Visión"
status: "Producción"
target_agents: ["ml-engineer", "data-scientist", "mlops-engineer", "data-engineering-data-pipeline"]
recommended_skills:
  - "[[00_Matriz_General_Skills]]"
  - "[[../Caracteristicas]]"
  - "[[../Especificacion_Feature_Spec_v1_3_0]]"
  - "[[../Flujo de datos]]"
  - "[[../Explicacion del codigo/Funciones_Modelo/ENTRENO Y EXPORTACION]]"
  - "[[../Explicacion del codigo/Funciones_Modelo/INFERENCIA]]"
  - "[[../Explicacion del codigo/Dataset_Generator/06_Arquitectura_Dataset_Generator_v2]]"
---

# 🧠 Skills Especializadas: Machine Learning, Visión por Computadora y Datos

> **Navegación:** [[../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[00_Matriz_General_Skills|🧭 Matriz de Skills]] > **Machine Learning, Visión y Datos**

El núcleo de inteligencia artificial de **ExpresaT** combina visión por computadora geométrica (MediaPipe Tasks Vision en CPU) para la extracción de landmarks corporales con una red neuronal recurrente compacta (**`SignLanguageGRU`**) optimizada para inferencia en CPU en menos de 3 milisegundos, bajo el contrato matemático estricto de [[../Especificacion_Feature_Spec_v1_3_0|FEATURE_SPEC v1.3.0]].

---

## 🛠️ Catálogo de Skills Instaladas en este Dominio

### 1. `ml-engineer` & `ai-engineer`
- **Ubicación:**
  - `~/.gemini/config/skills/ml-engineer/SKILL.md`
  - `~/.gemini/config/skills/ai-engineer/SKILL.md`
- **Objetivo:** Definición de arquitecturas neuronales con PyTorch, selección de hiperparámetros, funciones de pérdida (`CrossEntropyLoss`), optimizadores (`AdamW`) y evaluación de métricas de clasificación (Precisión, Recall, F1-Score).
- **Cuándo invocar:**
  - Añadir nuevas clases/gestos al catálogo oficial de lengua de señas (`catalog/signs_catalog.json`).
  - Ajustar hiperparámetros de `SignLanguageGRU` o afinar el extractor canónico `feature_extractor.py`.

### 2. `mlops-engineer` & `machine-learning-ops-ml-pipeline`
- **Ubicación:**
  - `~/.gemini/config/skills/mlops-engineer/SKILL.md`
  - `~/.gemini/config/skills/machine-learning-ops-ml-pipeline/SKILL.md`
- **Objetivo:** Orquestación de pipelines de reentrenamiento, versionado de modelos, exportación continua (PyTorch `.pt` → ONNX Float32 → ONNX INT8 dinámico → Benchmark de latencia) y verificación de `config_hash`.
- **Cuándo invocar:**
  - Automatizar pipelines CI/CD cuando se generen nuevos shards `.npy` con el generador v2.
  - Asegurar la compatibilidad del `opset_version` (opset 17).

### 3. `data-engineering-data-pipeline` & `data-quality-frameworks`
- **Ubicación:**
  - `~/.gemini/config/skills/data-engineering-data-pipeline/SKILL.md`
  - `~/.gemini/config/skills/data-quality-frameworks/SKILL.md`
- **Objetivo:** Validación de esquemas de datos vectoriales 178D, comprobación de integridad, detección de outliers y cuarentena de datasets corruptos.
- **Cuándo invocar:**
  - Auditar datasets entrantes contra el contrato [[../Especificacion_Feature_Spec_v1_3_0|FEATURE_SPEC v1.3.0]].
  - Asegurar que ningún pipeline de entrenamiento consuma archivos aislados en `dataset/quarantine/` (como `letra_a_derecha_2.json`).

---

## 📐 Reglas Invariables del Vector de Características (178D v1.3.0)

Todo agente que manipule el modelo o los extractores de visión debe respetar la topología invariable:

```text
[0 .. 51]   : Upper Pose (13 puntos × 4 coordenadas: x, y, z, visibilidad)
[52 .. 114] : Mano Izquierda (21 landmarks × 3 coordenadas: x, y, z)
[115 .. 177]: Mano Derecha (21 landmarks × 3 coordenadas: x, y, z)
Total       : 178 características flotantes por fotograma (15 frames = 2,670 valores)
```

> [!CRITICAL] Invariantes Canónicas de Normalización (FEATURE_SPEC v1.3.0)
> 1. **Origen ($C$):** Centroide 3D entre hombros: $C = (P_{11} + P_{12}) / 2$.
> 2. **Escala ($D$):** Distancia euclidiana 3D inter-humeral $D = \text{dist3D}(P_{11}, P_{12}) \ge 0.08$. Prohibido recortar con `std::max`.
> 3. **Visibilidad:** Si $\text{vis}(P_{11}) < 0.40 \lor \text{vis}(P_{12}) < 0.40 \implies$ `ERR_SHOULDER_VISIBILITY`.
> 4. **Upper Pose:** $(x-C_x)/D, \; (y-C_y)/D, \; (z-C_z)/D, \; \text{clamp}(vis, 0, 1)$.
> 5. **Manos:** En $XY$ relativas a $C$. En el eje $Z$, **relativas a la propia muñeca de la mano** escalada por $D$: $(z - z_{wrist})/D$.
> 6. **Manos Ausentes:** Estrictamente **63 ceros exactos (`0.0f`)** (`OK_HAND_MISSING`).
> 7. **Tolerancia Numérica ($L_\infty$):** Toda implementación debe verificar la suite canónica con tolerancia elemento a elemento:
>    $$\|v_{\text{obtenido}} - v_{\text{esperado}}\|_\infty \le 10^{-6}$$

---

## 🧪 Comandos de Entrenamiento y Verificación

```bash
# 1. Pruebas de paridad matemática de features:
pytest tests/test_feature_spec.py -v

# 2. Re-entrenamiento y exportación a ONNX INT8:
python expresat/models/train_and_export.py --epochs 50 --output ./exported_model

# 3. Inspeccionar grabaciones de calibración:
python expresat-dataset-generator/scripts/inspect_recording.py \
  --input raw_captures/session_01/hola_001.raw.json \
  --segments reposo,solo_derecha,solo_izquierda,ambas,cruce
```
