---
title: "Dataset Generator C++: Extracción de Características y Normalización"
description: "Empaquetado del vector plano de 178D, normalización espacial invariante respecto al centro de hombros y renderizado del skeleton."
version: "2.0.0"
category: "Código / Dataset Generator"
target_agents: ["cpp-pro", "ml-engineer"]
recommended_skills:
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `data-quality-frameworks`)"
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[Cpp_Generator]]"
  - "[[01_Arquitectura_y_Compilacion]]"
  - "[[03_Motor_Aumentacion_Sintetica]]"
  - "[[../../Caracteristicas]]"
---

# Fase 2: Extracción de Características y Normalización

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[Cpp_Generator|🛠️ Dataset Generator]] > **Fase 2: Extracción y Normalización**

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
   - Se seleccionan 13 puntos específicos del modelo Holistic de MediaPipe:
     - `0`: Nariz (referencia facial central).
     - `11, 12`: Hombros izquierdo y derecho.
     - `13, 14`: Codos izquierdo y derecho.
     - `15, 16`: Muñecas izquierda y derecha.
     - `17, 18, 19, 20, 21, 22`: Extremos de las manos y nudillos de referencia del torso.
   - Cada punto contiene 4 canales: $(x, y, z, \text{visibility})$.
   - $13 \times 4 = 52$ dimensiones.
   - *Razón de diseño*: Se omiten intencionalmente las piernas, rodillas y pies (landmarks 23–32) para reducir en un 60% la dimensionalidad y evitar que el modelo aprenda ruido espurio del tren inferior.

2. **Left Hand (63 dimensiones)**:
   - 21 articulaciones completas de la mano izquierda (muñeca, pulgar, índice, medio, anular y meñique).
   - Cada articulación contiene 3 coordenadas espaciales: $(x, y, z)$.
   - $21 \times 3 = 63$ dimensiones.

3. **Right Hand (63 dimensiones)**:
   - 21 articulaciones completas de la mano derecha.
   - Cada articulación contiene 3 coordenadas: $(x, y, z)$.
   - $21 \times 3 = 63$ dimensiones.

**Total por fotograma:** $52 + 63 + 63 = 178$ características.

---

## Algoritmo de Normalización Relativa a Hombros

En una aplicación de visión por computadora en el mundo real, los usuarios se sitúan a diferentes distancias de la cámara y en distintas posiciones dentro del fotograma (a la izquierda, a la derecha, más arriba o más abajo). Sin una normalización espacial, una red neuronal aprendería a memorizar la posición absoluta de la persona en lugar del movimiento intrínseco del gesto.

### Formulación Matemática

1. Se obtienen las coordenadas 3D de los hombros del Pose:
   - Hombro izquierdo: $P_{11} = (x_{11}, y_{11}, z_{11})$
   - Hombro derecho: $P_{12} = (x_{12}, y_{12}, z_{12})$

2. Se calcula el **centro de masa de los hombros** ($C_{\text{shoulder}}$):
   $$C_{\text{shoulder}} = \left( \frac{x_{11} + x_{12}}{2}, \;\frac{y_{11} + y_{12}}{2}, \;\frac{z_{11} + z_{12}}{2} \right)$$

3. Se sustrae este centroide a todas las coordenadas espaciales $(x, y, z)$ del Upper Pose, de la mano izquierda y de la mano derecha:
   $$P_{\text{norm}} = P_{\text{raw}} - C_{\text{shoulder}}$$

4. **Regla para la visibilidad**: El canal de visibilidad ($visibility$) de los landmarks de pose describe la probabilidad de que el punto esté ocluido y toma valores en el intervalo $[0.0, 1.0]$. Por lo tanto, **la visibilidad no se traslada**, permaneciendo intacta.

### Implementación en C++ (`mediapipe_extractor.cpp`)

```cpp
void MediapipeExtractor::normalizePose(std::vector<Landmark>& pose,
                                       std::vector<Landmark>& leftHand,
                                       std::vector<Landmark>& rightHand) {
    const auto& L = pose[SHOULDER_LEFT];  // Índice 11
    const auto& R = pose[SHOULDER_RIGHT]; // Índice 12
    float cx = (L.x + R.x) * 0.5f;
    float cy = (L.y + R.y) * 0.5f;
    float cz = (L.z + R.z) * 0.5f;

    // Desplazar landmarks del torso superior
    for (int idx : POSE_UPPER_INDICES) {
        if (idx < (int)pose.size()) {
            pose[idx].x -= cx;
            pose[idx].y -= cy;
            pose[idx].z -= cz;
            // lm.visibility permanece inalterado
        }
    }

    // Desplazar articulaciones de la mano izquierda
    for (auto& lm : leftHand) {
        lm.x -= cx; lm.y -= cy; lm.z -= cz;
    }

    // Desplazar articulaciones de la mano derecha
    for (auto& lm : rightHand) {
        lm.x -= cx; lm.y -= cy; lm.z -= cz;
    }
}
```

---

## Modo Extractor STUB (Generador Senoidal)

Para posibilitar el desarrollo ágil, pruebas unitarias y validaciones de interfaz sin requerir la cámara web activa o los binarios pesados de MediaPipe, `MediapipeExtractor` incluye un modo simulado sintético (`EXPRESAT_STUB_EXTRACTOR`):

- Utiliza un oscilador senoidal coherente basado en el número de fotograma ($t = \text{frame} \times 0.1$).
- El torso se estabiliza alrededor de $(0.5, 0.3)$ y las manos describen órbitas suaves en $(0.3, 0.6)$ y $(0.7, 0.6)$.
- Genera landmarks continuos que pasan por el mismo pipeline de normalización y aumentación, garantizando que el flujo de datos sea idéntico al de producción.

---

## Renderizado de Skeleton sobre OpenCV (`drawSkeleton`)

El método estático `MediapipeExtractor::drawSkeleton` proyecta las conexiones anatómicas sobre la imagen capturada para retroalimentación visual en tiempo real:

```cpp
void MediapipeExtractor::drawSkeleton(cv::Mat& frame,
                                       const FrameLandmarks& lm,
                                       const BodyPartConfig& parts) {
    if (!parts.showSkeleton) return;
    
    // Proyección de coordenadas normalizadas [0,1] a píxeles
    auto toPixel = [&](float nx, float ny) {
        return cv::Point(static_cast<int>(nx * frame.cols),
                         static_cast<int>(ny * frame.rows));
    };

    // 1. Torso: Líneas verdes (0, 255, 0) y nodos azules (255, 0, 0)
    // 2. Mano Izquierda: Conexiones naranja cálido (255, 165, 0)
    // 3. Mano Derecha: Conexiones azul celeste (0, 165, 255)
}
```

Las conexiones se dibujan con antialiasing (`cv::LINE_AA`) y se actualizan a la tasa de fotogramas de la cámara antes de ser enviadas a la textura OpenGL.
