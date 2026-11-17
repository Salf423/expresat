---
title: "Explicación del Código: Generador de Datasets (C++ Legacy v1 & Web+Python v2)"
description: "Visión general de las herramientas de generación de datasets: app de escritorio C++17 ImGui y nueva arquitectura v2 desacoplada con Tasks Vision y Python sharding."
version: "2.2.1"
category: "Código / Generador de Datasets"
status: "Producción"
target_agents: ["cpp-pro", "ml-engineer", "data-engineering-data-pipeline"]
recommended_skills:
  - "[[../../Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`)"
  - "[[../../Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`data-engineering-data-pipeline`, `mlops-engineer`)"
  - "[[../../Skills/UI_UX_y_Frontend|UI_UX_y_Frontend]] (`ui-ux-designer`, `react-modernization`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_2_1]]"
  - "[[06_Arquitectura_Dataset_Generator_v2]]"
  - "[[01_Arquitectura_y_Compilacion]]"
  - "[[02_Extraccion_y_Normalizacion]]"
  - "[[03_Motor_Aumentacion_Sintetica]]"
  - "[[04_Interfaz_Grafica_ImGui]]"
  - "[[05_Serializacion_JSON_y_CICD]]"
  - "[[../../Caracteristicas]]"
---

# 🛠️ Generador de Datasets (`expresat-dataset-generator`)

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Generador de Datasets**

---

## 1. Visión General y Evolución

El ecosistema de generación y síntesis de secuencias para **ExpresaT** ha evolucionado en dos etapas clave:

1. **Generador Nativo C++17 (v1 Legacy):** Aplicación de escritorio desarrollada con **Dear ImGui**, **OpenGL 3.3 / GLFW** y **OpenCV 4/5**, con motor multihilo de aumentación estocástica (`std::thread`).
2. **Dataset Generator v2 (Plan v2.2.1):** Arquitectura desacoplada en dos etapas: captura web a tasa nativa con `SignEngine` (Tasks Vision CPU, 640×480 4:3, `smoothLandmarks: false`) y pipeline offline headless en Python con particionado estratificado, aumentación sobre puntos crudos y guardado en shards binarios `.npy` contiguos con `manifest.json`.

```mermaid
flowchart LR
    subgraph Generador_v1 ["v1 Legacy (C++ ImGui)"]
        A1["OpenCV VideoCapture"] --> B1["MediapipeExtractor C++"]
        B1 --> C1["DataAugmenter (std::thread)"]
        C1 --> D1["JSON por clase (*.json)"]
    end

    subgraph Generador_v2 ["v2 Recomendado (Web + Python Sharding)"]
        A2["Webcam 640×480 (4:3)"] --> B2["SignEngine (Tasks Vision CPU)"]
        B2 --> C2["POST local atómico (raw_captures/)"]
        C2 --> D2["Pipeline Python Headless (.npy Shards + manifest.json)"]
    end

    style Generador_v1 fill:#3b2d1a,color:#fff
    style Generador_v2 fill:#1d5b4a,color:#fff
```

> [!CAUTION] Alerta de Cuarentena
> El archivo `dataset/quarantine/letra_a_derecha_2.json` fue aislado tras detectarse que fue producido con el generador v1 en modo STUB senoidal con un bug de escala que omitió la división por hombros ($D$). Todos los nuevos modelos deben entrenarse con datasets conformes a [[../../Especificacion_Feature_Spec_v1_2_1|FEATURE_SPEC v1.2.1]].

---

## 2. Módulos Técnicos Detallados

La documentación técnica detallada está dividida en las siguientes guías modulares:

1. **[[06_Arquitectura_Dataset_Generator_v2]]**: Nueva arquitectura desacoplada en dos etapas (Captura Web Tasks Vision + Pipeline Offline Python NPY sharding).
2. **[[01_Arquitectura_y_Compilacion]]**: Sistema de compilación CMake 3.20+, C++17, dependencias vendored/FetchContent, scripts de automatización (`build.sh`, `setup_third_party.sh`).
3. **[[02_Extraccion_y_Normalizacion]]**: Layout del vector plano de 178D, evolución matemática de normalización y comparativa histórica.
4. **[[03_Motor_Aumentacion_Sintetica]]**: Motor estocástico en `std::thread`, transformaciones espaciales (Jitter, Escalado, Rotación) y temporales (Warping).
5. **[[04_Interfaz_Grafica_ImGui]]**: Arquitectura de Dear ImGui + GLFW3 + OpenGL 3.3, subprocesos desacoplados (`CameraStream` y worker de generación).
6. **[[05_Serializacion_JSON_y_CICD]]**: Estructura JSON por etiqueta (`./dataset/<label>.json`), archivo compilado `dataset.json`, y pipeline de integración continua en GitHub Actions.

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para el Pipeline Moderno v2:** Consultar [[06_Arquitectura_Dataset_Generator_v2]] e invocar **`data-engineering-data-pipeline`** y **`mlops-engineer`**.
- **Para Compilación y Mantenimiento C++ v1:** Invocar **`cpp-pro`** (ver [[../../Skills/Backend_APIs_y_Sistemas]]).
- **Para la Especificación Matemática:** Consultar [[../../Especificacion_Feature_Spec_v1_2_1]].
