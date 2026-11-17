---
title: "Dataset Generator: Extracción de Características y Normalización (v1 vs v1.3.0)"
description: "Empaquetado del vector plano de 178D, evolución matemática de la normalización, causa de cuarentena de letra_a_derecha_2.json y contrato canónico FEATURE_SPEC v1.3.0."
version: "2.3.0"
category: "Código / Dataset Generator"
target_agents: ["cpp-pro", "ml-engineer", "data-engineering-data-pipeline"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `data-quality-frameworks`)"
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_3_0]]"
  - "[[Cpp_Generator]]"
  - "[[06_Arquitectura_Dataset_Generator_v2]]"
  - "[[01_Arquitectura_y_Compilacion]]"
  - "[[03_Motor_Aumentacion_Sintetica]]"
  - "[[../../Caracteristicas]]"
---

# Fase 2: Extracción de Características y Normalización

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[Cpp_Generator|🛠️ Dataset Generator]] > **Fase 2: Extracción y Normalización**

---

## Empaquetado del Vector de Características (178D)

Para que el dataset generado sea 100% compatible con el modelo neuronal `SignLanguageGRU` definido en `expresat/models/train_and_export.py`, cada fotograma capturado se transforma en un vector plano unidimensional de **178 números flotantes** (`std::vector<float>`):

```text
┌─────────────────────────┬───────────────────────┬────────────────────────┐
│    Upper Pose (52D)     │    Left Hand (63D)    │    Right Hand (63D)    │
│  13 pts × 4 (x,y,z,vis) │    21 pts × 3 (x,y,z) │     21 pts × 3 (x,y,z) │
│       Índices 0..51     │     Índices 52..114   │     Índices 115..177   │
└─────────────────────────┴───────────────────────┴────────────────────────┘
```

### 1. Desglose de Puntos Clave

1. **Upper Pose (52 dimensiones)**:
   - Se seleccionan 13 puntos específicos del modelo Holistic / Pose de MediaPipe:
     - `0`: Nariz (referencia facial central).
     - `11, 12`: Hombros izquierdo y derecho.
     - `13, 14`: Codos izquierdo y derecho.
     - `15, 16`: Muñecas izquierda y derecha.
     - `17, 18, 19, 20, 21, 22`: Extremos de las manos y nudillos de referencia del torso.
   - Cada punto contiene 4 canales: $(x, y, z, \text{visibility})$.
   - $13 \times 4 = 52$ dimensiones.

2. **Left Hand (63 dimensiones)**:
   - 21 articulaciones completas de la mano izquierda del firmante.
   - Cada articulación contiene 3 coordenadas espaciales: $(x, y, z)$.
   - $21 \times 3 = 63$ dimensiones.

3. **Right Hand (63 dimensiones)**:
   - 21 articulaciones completas de la mano derecha del firmante.
   - Cada articulación contiene 3 coordenadas: $(x, y, z)$.
   - $21 \times 3 = 63$ dimensiones.

**Total por fotograma:** $52 + 63 + 63 = 178$ características.

---

## 2. Evolución de la Normalización y Cuarentena de Datos Legacy

> [!WARNING] Causa de Cuarentena de `letra_a_derecha_2.json`
> La implementación temprana en C++ de `MediapipeExtractor::normalizePose` únicamente restaba el centroide $C_{\text{shoulder}}$ **sin dividir por la distancia inter-humeral $D$**. Sumado a una aumentación estocástica lineal que multiplicó la visibilidad superando $1.0$, los datos producidos tenían anomalías geométricas ($D \approx 0.0459$ en vez del estándar $D = 1.0$).
> Por este motivo, el archivo fue aislado en `dataset/quarantine/letra_a_derecha_2.json` y se promulgó la [[../../Especificacion_Feature_Spec_v1_3_0|FEATURE_SPEC v1.3.0]].

---

## 3. Algoritmo Canónico de Normalización (FEATURE_SPEC v1.3.0)

Para garantizar invarianza estricta ante distancia, traslación 3D y ángulo:

### A. Centroide y Escala de Hombros 3D
1. **Centroide de Hombros ($C$):**
   $$C_x = \frac{x_{11} + x_{12}}{2}, \quad C_y = \frac{y_{11} + y_{12}}{2}, \quad C_z = \frac{z_{11} + z_{12}}{2}$$
2. **Escala Inter-humeral Euclidiana 3D ($D$):**
   $$D = \sqrt{(x_{11} - x_{12})^2 + (y_{11} - y_{12})^2 + (z_{11} - z_{12})^2}$$
   - Si $D < 0.08 \implies$ rechazo con `ERR_SHOULDERS_TOO_SMALL`.
   - Si $\text{vis}(P_{11}) < 0.40 \lor \text{vis}(P_{12}) < 0.40 \implies$ rechazo con `ERR_SHOULDER_VISIBILITY`.

### B. Transformación de Pose (`[0..51]`)
$$x' = \frac{x - C_x}{D}, \quad y' = \frac{y - C_y}{D}, \quad z' = \frac{z - C_z}{D}, \quad \text{vis}' = \text{clamp}(\text{vis}, 0.0, 1.0)$$

### C. Desacoplamiento Fundamental del Eje Z en Manos (`[52..114]` y `[115..177]`)
- **Plano $XY$ (Espacio Torácico):**
   $$x' = \frac{x_{\text{hand}, i} - C_x}{D}, \quad y' = \frac{y_{\text{hand}, i} - C_y}{D}$$
- **Eje $Z$ (Relativo a la Muñeca):** Se resta la coordenada $Z$ del Landmark 0 (muñeca) de esa mano y se escala por $D$:
   $$z'_i = \frac{z_{\text{hand}, i} - z_{\text{hand}, \text{wrist}}}{D}$$
- **Mano Ausente:** Se emiten **63 ceros exactos (`0.0f`)** (`OK_HAND_MISSING`).

---

## 4. Modo Extractor STUB y Renderizado de Skeleton

### Modo STUB Senoidal (`EXPRESAT_STUB_EXTRACTOR`)
- Genera ondas senoidales temporales $0.5 + 0.15 \cos(t + 0.3i)$.
- **Precaución:** Este modo sintético no debe utilizarse para compilar datasets de producción. Los datasets reales deben capturarse mediante la Etapa 1 del [[06_Arquitectura_Dataset_Generator_v2|Dataset Generator v2]].

### Renderizado de Skeleton sobre OpenCV (`drawSkeleton`)
Proyecta las conexiones anatómicas sobre la imagen capturada para retroalimentación visual en tiempo real:
- Torso: Verde `cv::Scalar(0, 255, 0)`
- Mano Izquierda: Naranja `cv::Scalar(255, 165, 0)`
- Mano Derecha: Celeste `cv::Scalar(0, 165, 255)`
- Antialiasing con `cv::LINE_AA`.

---

## 🤖 Guía de Operación para Agentes

- **Para la Especificación Matemática Canónica:** Consultar [[../../Especificacion_Feature_Spec_v1_3_0]].
- **Para la Nueva Arquitectura de Datasets v2:** Consultar [[06_Arquitectura_Dataset_Generator_v2]].
- **Para Auditoría y Calidad de Datasets:** Invocar **`data-engineering-data-pipeline`** (ver [[../../Skills/MachineLearning_y_Vision]]).
