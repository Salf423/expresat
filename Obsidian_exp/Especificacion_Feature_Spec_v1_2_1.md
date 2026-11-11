---
title: "Especificación Canónica del Vector de 178 Características (FEATURE_SPEC v1.2.1)"
description: "Contrato técnico estricto de ingeniería de características 178D: formulación matemática, normalización invariante, asignación conjunta de manos, suite de paridad TC-01 a TC-05C y cuarentena de datasets legacy."
version: "1.2.1"
category: "Especificación / IA & Visión"
status: "Producción / Contrato Obligatorio"
target_agents: ["ml-engineer", "cpp-pro", "frontend-developer", "data-engineering-data-pipeline"]
recommended_skills:
  - "[[Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `data-engineering-data-pipeline`)"
  - "[[Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`)"
  - "[[Skills/UI_UX_y_Frontend|UI_UX_y_Frontend]] (`react-modernization`)"
related_docs:
  - "[[00_INDICE_MAESTRO]]"
  - "[[Caracteristicas]]"
  - "[[Flujo de datos]]"
  - "[[Explicacion del codigo/Backend/Main C++]]"
  - "[[Explicacion del codigo/Frontend/Vite_React]]"
  - "[[Explicacion del codigo/Funciones_Modelo/Training_and_Inference]]"
  - "[[Explicacion del codigo/Dataset_Generator/02_Extraccion_y_Normalizacion]]"
  - "[[Explicacion del codigo/Dataset_Generator/06_Arquitectura_Dataset_Generator_v2]]"
---

# 📐 Especificación Canónica del Vector de 178 Características — ExpresaT

> **Navegación:** [[00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[Caracteristicas|⚙️ Características]] > **FEATURE_SPEC v1.2.1**

- **Versión de la especificación (`feature_spec_version`):** `1.2.1`
- **Estado:** Contrato técnico obligatorio e inmutable para modelos entrenados, generador v2 y motores de inferencia.
- **Ámbito:** Unificación matemática de extracción, filtrado, normalización y asignación anatómica en **Python** (`expresat/models/feature_extractor.py`), **C++** (`expresat-native/core/src/inference_thread.cpp`) y **JavaScript** (`expresat/frontend/src/engine/featureExtractor.js`).
- **Invariante del Modelo:** Tensor tridimensional continuo de entrada `(1, 15, 178)` en `float32`.

---

## 1. Evidencia Histórica y Cuarentena de `letra_a_derecha_2.json`

### 1.1 Causa Raíz del Archivo Legacy
La auditoría del código histórico (`docs/dataset-generator/AUDITORIA.md`) reveló que `dataset/letra_a_derecha_2.json` contenía anomalías geométricas severas:
- **Origen Sintético:** Generado mediante `MediapipeExtractor` en modo STUB senoidal artificial (`EXPRESAT_STUB_EXTRACTOR=1`).
- **Distorsión en Aumentación:** El método `DataAugmenter::applyScale` multiplicó uniformemente todos los canales por factores $[0.90, 1.10]$, provocando que el canal de visibilidad desbordara hasta $1.0201$ (la visibilidad debe estar estrictamente acotada a $[0.0, 1.0]$).
- **Falta de Escalado por Hombros:** Los hombros se situaron en $(\pm 0.0177, 0, 0)$ con distancia inter-humeral $D \approx 0.0459$ porque se omitió la división por la distancia $D$. En un espacio correctamente normalizado, los hombros frontales deben situarse exactamente en $(\pm 0.5000, 0, 0)$ con distancia $D = 1.0$.

### 1.2 Medidas Correctivas Obligatorias
1. **Aislamiento en Cuarentena:** El archivo fue trasladado a `dataset/quarantine/letra_a_derecha_2.json` y queda **estrictamente prohibido su uso para el entrenamiento de nuevos modelos**.
2. **Validación de Versión y Hash de Configuración:** `InferenceEngine` (`inference_engine.py`) y el pipeline de entrenamiento (`train_and_export.py`) comprueban compatibilidad por `major.minor` (`1.2`) y validan el hash criptográfico SHA-256 (`config_hash`) almacenado en `model_metadata.json` y `manifest.json`. Cualquier discrepancia aborta con `IncompatibleFeatureSpecError`.

---

## 2. Composición Topológica del Vector 178D

Cada fotograma genera un vector plano de **178 valores `float32`**:

| Segmento | Índices | Descripción | Dimensiones | Formato |
|---|---|---|---|---|
| **Upper Pose** | `[0 .. 51]` | 13 landmarks del torso superior (0: nariz, 11-22: hombros, codos, muñecas, torso) | **52D** | $13 \times (x, y, z, \text{visibility})$ |
| **Mano Izquierda** | `[52 .. 114]` | 21 articulaciones de la mano izquierda del firmante | **63D** | $21 \times (x, y, z)$ |
| **Mano Derecha** | `[115 .. 177]` | 21 articulaciones de la mano derecha del firmante | **63D** | $21 \times (x, y, z)$ |
| **TOTAL** | `[0 .. 177]` | Vector unificado por frame | **178D** | `float32` |

> [!IMPORTANT]
> **Ausencia de Manos:** Si una mano no está visible en el fotograma pero los hombros son válidos, dicho segmento se rellena con **estrictamente 63 ceros exactos (`0.0f`)** (`OK_HAND_MISSING`). Prohibido emitir `NaN`, `null` o aproximaciones.

---

## 3. Algoritmo de Normalización Matemática Canónica

Para garantizar invarianza ante la estatura del usuario, su distancia a la cámara y traslaciones 3D en el espacio:

### 3.1 Centro y Escala de Referencia (Hombros)
A partir de los hombros izquierdo ($P_{11}$) y derecho ($P_{12}$):
1. **Centroide de Hombros ($C$):**
   $$C_x = \frac{P_{11,x} + P_{12,x}}{2}, \quad C_y = \frac{P_{11,y} + P_{12,y}}{2}, \quad C_z = \frac{P_{11,z} + P_{12,z}}{2}$$
2. **Escala Inter-humeral 3D ($D$):**
   $$D = \sqrt{(P_{11,x} - P_{12,x})^2 + (P_{11,y} - P_{12,y})^2 + (P_{11,z} - P_{12,z})^2}$$
3. **Comprobación de Escala:** Si $D < 0.08$, se rechaza el frame con `ERR_SHOULDERS_TOO_SMALL`. Prohibido recortar con `std::max(D, 1e-6)`.
4. **Comprobación de Visibilidad:** Si $\text{vis}(P_{11}) < 0.40 \lor \text{vis}(P_{12}) < 0.40$, se rechaza el frame con `ERR_SHOULDER_VISIBILITY`.

### 3.2 Normalización de Upper Pose (`[0 .. 51]`)
Para cada uno de los 13 landmarks del torso superior:
$$x' = \frac{x - C_x}{D}, \quad y' = \frac{y - C_y}{D}, \quad z' = \frac{z - C_z}{D}, \quad \text{vis}' = \text{clamp}(\text{vis}, 0.0, 1.0)$$

### 3.3 Normalización Desacoplada de Manos (`[52 .. 114]` y `[115 .. 177]`)
Para asegurar la propiedad fundamental de **invarianza a traslación 3D** ($\text{Extract}(P + \delta) == \text{Extract}(P)$):
- **Plano $XY$ (Espacio Torácico):** Las manos se ubican respecto al centro de los hombros:
  $$x' = \frac{x_{\text{hand}, i} - C_x}{D}, \quad y' = \frac{y_{\text{hand}, i} - C_y}{D}$$
- **Eje $Z$ (Desacoplamiento Relativo a la Muñeca):** Se resta la propia coordenada $Z$ de la muñeca (Landmark 0 de esa mano) y se escala por $D$:
  $$z' = \frac{z_{\text{hand}, i} - z_{\text{hand}, \text{wrist}}}{D}$$

> [!NOTE] Garantía Matemática
> En MediaPipe Hands, $Z$ es relativo al recorte local de la mano. Al restar $z_{\text{wrist}}$, una traslación corporal $\delta_z$ se anula idénticamente: $(z_i + \delta_z) - (z_{\text{wrist}} + \delta_z) = z_i - z_{\text{wrist}}$.

---

## 4. Asignación Anatómica Conjunta de Manos (Joint Hand Assignment)

MediaPipe Hands entrega las manos en orden arbitrario. Para asignarlas con total precisión a la mano izquierda (`[52..114]`) o derecha (`[115..177]`):

1. **Distancias 2D a las Muñecas de Pose:** Se miden las distancias en el plano $XY$ entre la muñeca de la mano detectada ($H_{i,0}$) y las muñecas de pose ($P_{15}$ izquierda, $P_{16}$ derecha):
   $$d_{\text{left}}(H_i) = \text{dist2D}(H_{i,0}, P_{15}), \quad d_{\text{right}}(H_i) = \text{dist2D}(H_{i,0}, P_{16})$$
2. **Rechazo por Desconexión:** Si $\min(d_{\text{left}}, d_{\text{right}}) > 1.75 \cdot D$, la mano se descarta como artefacto espurio (`ERR_HAND_DISCONNECTED`).
3. **Asignación Conjunta (2 manos presentes):** Se evalúan las dos combinaciones posibles minimizando el coste total:
   $$\text{coste}_A = d_{\text{left}}(H_0) + d_{\text{right}}(H_1), \quad \text{coste}_B = d_{\text{left}}(H_1) + d_{\text{right}}(H_0)$$
   Si $\text{coste}_A \le \text{coste}_B \implies H_0 \to \text{Izquierda}, H_1 \to \text{Derecha}$.
4. **Desempate por Etiqueta MediaPipe en Casos Ambiguos:**
   Si sólo hay 1 mano detectada y $|d_{\text{left}} - d_{\text{right}}| < 0.15 \cdot D$ (mano en el centro del pecho) o si $\text{vis}(P_{15}) < 0.50 \lor \text{vis}(P_{16}) < 0.50$:
   - Se desempata con la propiedad `categoryName` entregada por MediaPipe en el fotograma **no espejado**:
     - MediaPipe `'Left'` $\to$ **Mano Derecha** del firmante (`[115..177]`).
     - MediaPipe `'Right'` $\to$ **Mano Izquierda** del firmante (`[52..114]`).

---

## 5. Algoritmo `ExtractWindow` y Tolerancia Temporal

En tomas o ventanas de inferencia de 15 frames:
1. **Validación de Hombros:** $P_{11}$ y $P_{12}$ presentes con visibilidad $\ge 0.40$.
2. **Remuestreo Temporal Equidistante:** Remuestreo a 15 frames con $\Delta t = 66.67 \text{ ms}$ ($1000 \text{ ms}$ total).
   - **Tolerancia a Brecha ($\text{Gap}$):** Máximo $100 \text{ ms}$ continuos de pérdida de tracking.
     - A 15 FPS: máx 1 frame perdido permitido (se interpola). 2 frames = $133 \text{ ms} \implies$ rechazo (`ERR_INVALID_FRAME_GAP_TOO_LARGE`).
     - A 30 FPS: máx 3 frames perdidos permitidos.
3. **Escala y Centro de Ventana:**
   - $C_{\text{ventana}} = \text{mediana}(C_1, \dots, C_{15})$
   - $D_{\text{ventana}} = \text{mediana}(D_1, \dots, D_{15})$
   - Si $D_{\text{ventana}} < 0.08 \implies$ rechazo con `ERR_SHOULDERS_TOO_SMALL`.
4. **Filtro EMA ($\alpha = 0.50$):** Suavizado exponencial sobre coordenadas remuestreadas con reinicio al inicio de ventana y cuando una mano reaparece.
5. **Normalización y Ensamble:** Formación del tensor `(1, 15, 178)`.

---

## 6. Catálogo Canónico de Códigos de Error

| Código | Causa Raíz | Acción del Pipeline |
|---|---|---|
| `ERR_POSE_MISSING` | Pose nula o menos de 23 landmarks | Rechazar frame (`valid: false`) |
| `ERR_SHOULDER_VISIBILITY` | Visibilidad de $P_{11}$ o $P_{12} < 0.40$ | Rechazar frame (`valid: false`) |
| `ERR_SHOULDERS_TOO_SMALL` | Distancia $D < 0.08$ | Rechazar frame (`valid: false`) |
| `ERR_OUT_OF_BOUNDS` | Hombros fuera del cuadro $(x, y \notin [0.0, 1.0])$ | Rechazar frame (`valid: false`) |
| `ERR_HAND_DISCONNECTED` | Distancia a muñecas $> 1.75 \cdot D$ | Descartar mano flotante falsa |
| `ERR_MAX_JITTER_EXCEEDED` | Velocidad articular interna $> 4.0 \text{ palmScale}/\text{s}$ | Rechazar toma completa |
| `ERR_INVALID_ASPECT_RATIO` | Aspect ratio de cámara difiere de 4:3 en $> 5\%$ | Rechazar captura de cámara |
| `ERR_INVALID_FRAME_GAP_TOO_LARGE` | Pérdida de tracking continua $> 100 \text{ ms}$ | Rechazar toma de entrenamiento |
| `OK_HAND_MISSING` | Hombros válidos pero mano ausente | Válido. Emitir 63 ceros exactos |

---

## 7. Suite de Conformidad y Paridad Numérica (TC-01 a TC-05C)

Todas las implementaciones (Python, C++, JavaScript) pasan la suite de pruebas unificada con tolerancia $|\Delta| \le 10^{-6}$:

- **TC-01:** Pose completa + 2 manos presentes. Verifica normalización exacta de pose y desacoplamiento de $Z$ en manos.
- **TC-02:** Mano izquierda ausente. Verifica que `[52..114]` sean 63 ceros exactos y `[115..177]` contenga la mano derecha normalizada.
- **TC-03:** Pose incompleta (`len(pose) < 23`). Emite `ERR_POSE_MISSING`.
- **TC-04:** Hombros colapsados ($D < 0.08$). Emite `ERR_SHOULDERS_TOO_SMALL`.
- **TC-05A:** Asignación conjunta óptima de 2 manos cruzadas por coste mínimo euclidiano.
- **TC-05B:** 1 mano centrada en el pecho. Desempata por `categoryName` MediaPipe.
- **TC-05C:** Mano flotante desconectada ($d > 1.75 \cdot D$). Se descarta con `ERR_HAND_DISCONNECTED`.

### Archivos de Prueba en el Repositorio
- Python: `tests/test_feature_spec.py`
- JavaScript: `expresat/frontend/src/engine/__tests__/featureExtractor.test.js`
- C++: `expresat-native/core/src/inference_thread.cpp` (alineado en commit `a149fc5`).
