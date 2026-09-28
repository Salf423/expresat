---
title: "Dataset Generator C++: Motor de Aumentación de Datos Sintéticos"
description: "Generación de variantes sintéticas de señas con ruido gaussiano, escalado espacial, rotaciones 2D y jittering temporal con interpolación lineal."
version: "2.0.0"
category: "Código / Dataset Generator"
target_agents: ["cpp-pro", "ml-engineer", "data-scientist"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`data-engineering-data-pipeline`, `ml-engineer`)"
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[Cpp_Generator]]"
  - "[[02_Extraccion_y_Normalizacion]]"
  - "[[04_Interfaz_Grafica_ImGui]]"
---

# Fase 3: Motor de Aumentación de Datos Sintéticos (DataAugmenter)

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[Cpp_Generator|🛠️ Dataset Generator]] > **Fase 3: Motor de Aumentación**

## Propósito y Justificación Técnica

Capturar manualmente cientos de repeticiones de una misma seña es una tarea físicamente agotadora, propensa a inconsistencias y que consume semanas de trabajo humano.

El componente **`DataAugmenter`** (`src/data_augmenter.h` y `src/data_augmenter.cpp`) resuelve este desafío mediante un motor de síntesis estocástica: toma **una única secuencia real base de 15 fotogramas** (una matriz de $15 \times 178$) y genera instantáneamente $N$ variantes aumentadas (por ejemplo, 500 o 3000 muestras) aplicando transformaciones matemáticas rigurosas que preservan la semántica del gesto mientras introducen variabilidad anatómica, espacial y temporal.

---

## Pipeline de Transformaciones Secuenciales

Cada muestra sintética es producida aplicando cuatro transformaciones en orden estricto sobre una copia en memoria de la secuencia base:

```text
Secuencia Base (15x178)
         │
         ▼
[ 1. Ruido Gaussiano ]      ── Coordenadas P' = P + N(0, σ²)
         │
         ▼
[ 2. Escalado Espacial ]    ── P'' = P' * s  (s ∈ [0.9, 1.1])
         │
         ▼
[ 3. Rotación 2D XY ]       ── Rotación plana θ ∈ [-5°, +5°]
         │
         ▼
[ 4. Jittering Temporal ]   ── Resampling e interpolación (15 frames)
         │
         ▼
Secuencia Sintética Final (15x178)
```

---

### 1. Ruido Gaussiano (Jittering de Coordenadas)

Simula las micro-variaciones de la estimación de MediaPipe, el temblor natural de los músculos del usuario y las condiciones de ruido en la iluminación:

- **Fórmula**:
  $$P' = P + \mathcal{N}(0, \sigma^2)$$
- **Distribución**: Para cada muestra, se selecciona un factor $\sigma \sim \mathcal{U}(0.005, 0.020)$.
- **Implementación**: Se aplica independientemente a cada componente de coordenadas flotantes, simulando imprecisiones estocásticas de hasta un 2% del rango espacial normalizado.

```cpp
Sequence DataAugmenter::applyNoise(const Sequence& seq, float sigma) {
    std::normal_distribution<float> noise(0.f, sigma);
    Sequence out;
    out.reserve(seq.size());
    for (const auto& frame : seq) {
        FeatureVector fv = frame;
        for (auto& v : fv) v += noise(rng_);
        out.push_back(std::move(fv));
    }
    return out;
}
```

---

### 2. Escalado Espacial (Anatomía del Usuario)

Simula personas con diferentes dimensiones corporales (brazos más largos o más cortos, manos más grandes o más pequeñas):

- **Fórmula**:
  $$P'' = P' \cdot s$$
- **Distribución**: Factor de escala uniforme $s \sim \mathcal{U}(0.90, 1.10)$ (variación de $\pm 10\%$).
- **Regla de integridad**: En el bloque de Upper Pose, las coordenadas $x, y, z$ se multiplican por $s$, pero **el canal de visibilidad (índice 3 de cada cuarteto) no se escala**, garantizando que permanezca en su rango probabilístico original.

```cpp
Sequence DataAugmenter::applyScale(const Sequence& seq, float scale) {
    Sequence out;
    out.reserve(seq.size());
    for (const auto& frame : seq) {
        FeatureVector fv = frame;
        // Pose: escalar x, y, z; ignorar visibilidad
        for (int pt = 0; pt < POSE_UPPER_COUNT; ++pt) {
            int base = pt * POSE_COORDS;
            fv[base + 0] *= scale;
            fv[base + 1] *= scale;
            fv[base + 2] *= scale;
        }
        // Manos: coordenadas puras x, y, z
        for (size_t i = POSE_FEATURE_DIM; i < fv.size(); ++i) {
            fv[i] *= scale;
        }
        out.push_back(std::move(fv));
    }
    return out;
}
```

---

### 3. Rotación 2D en el Plano Frontal (XY)

Simula ligeras inclinaciones de postura del usuario respecto a la vertical de la cámara:

- **Fórmula**:
  $$\begin{bmatrix} x' \\ y' \end{bmatrix} = \begin{bmatrix} \cos\theta & -\sin\theta \\ \sin\theta & \cos\theta \end{bmatrix} \begin{bmatrix} x \\ y \end{bmatrix}$$
- **Distribución**: Ángulo $\theta \sim \mathcal{U}(-5.0^\circ, +5.0^\circ)$.
- **Detalle**: Solo se rotan los pares $(x, y)$. La coordenada de profundidad $z$ y la visibilidad no sufren rotación planar, manteniendo la estabilidad tridimensional.

---

### 4. Deformación Temporal (Temporal Warping con Interpolación Lineal)

En la vida real, una persona nunca ejecuta un gesto exactamente a la misma velocidad en cada repetición: puede iniciar más despacio y acelerar al final, o viceversa.

El motor aplica un re-muestreo temporal estocástico manteniendo estrictamente el tamaño de **15 fotogramas**:

1. Se genera un desplazamiento continuo con factor de curvatura $\text{warp} \in [-0.10, +0.10]$.
2. Para cada fotograma destino $i \in [0, 14]$, se calcula una posición fuente flotante:
   $$\text{srcF} = i + \text{offset} \cdot \left( \frac{i}{N - 1} \right)$$
3. Se realiza una **interpolación lineal continua** entre los fotogramas discretos $\text{lo} = \lfloor \text{srcF} \rfloor$ y $\text{hi} = \text{lo} + 1$:
   $$\alpha = \text{srcF} - \text{lo}$$
   $$F_{\text{destino}}[i] = (1 - \alpha) \cdot F_{\text{base}}[\text{lo}] + \alpha \cdot F_{\text{base}}[\text{hi}]$$

```cpp
Sequence DataAugmenter::applyTemporalWarp(const Sequence& seq, float warpFactor) {
    int N = static_cast<int>(seq.size());
    std::uniform_real_distribution<float> drift(-warpFactor, warpFactor);
    float offset = drift(rng_) * N;

    Sequence out;
    out.reserve(N);

    for (int i = 0; i < N; ++i) {
        float srcF = std::clamp(i + offset * (static_cast<float>(i) / (N - 1)),
                                0.f, static_cast<float>(N - 1));
        int   lo    = static_cast<int>(srcF);
        int   hi    = std::min(lo + 1, N - 1);
        float alpha = srcF - lo;

        FeatureVector interp(seq[lo].size());
        for (size_t j = 0; j < interp.size(); ++j)
            interp[j] = seq[lo][j] * (1.f - alpha) + seq[hi][j] * alpha;

        out.push_back(std::move(interp));
    }
    return out;
}
```

---

## Retroalimentación en Tiempo Real y Multihilo

Para procesar miles de muestras sin causar caídas de cuadros (*frame drops*) en la interfaz gráfica:

1. **RNG Autónomo**: Cada instancia utiliza su propio motor Mersenne Twister (`std::mt19937`) inicializado con entropía de hardware (`std::random_device`).
2. **Callback de Progreso**: La configuración acepta un callback `std::function<void(int done, int total)>`:
   ```cpp
   augCfg.onProgress = [this, count](int done, int total) {
       progress_.store(static_cast<float>(done) / static_cast<float>(total));
   };
   ```
   El valor se actualiza en una variable atómica (`std::atomic<float>`), permitiendo que el hilo principal de renderizado pinte una barra de progreso suave (`ImGui::ProgressBar`) en tiempo real.
