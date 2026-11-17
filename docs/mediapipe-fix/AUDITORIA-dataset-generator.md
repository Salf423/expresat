# Auditoría MediaPipe — Dataset Generator (`expresat-dataset-generator`)

- **Ámbito:** `expresat-dataset-generator/`
- **Proyecto:** ExpresaT — Recolección de Datos de Señas y Entrenamiento de Modelo
- **Fecha:** 2026-11-08
- **Estado:** **Histórico** — Auditoría inicial previa a [AUDITORIA.md](../dataset-generator/AUDITORIA.md), [PLAN.md](../dataset-generator/PLAN.md) y [FEATURE_SPEC.md](../dataset-generator/FEATURE_SPEC.md)

> [!NOTE]
> Tras esta revisión inicial, los datos sintéticos previos (`letra_a_derecha_2.json`) fueron puestos en cuarentena y se unificó el extractor canónico `178D` (`v1.3.0`) entre Python y JavaScript, diseñando el generador v2 en dos etapas ([PLAN.md](../dataset-generator/PLAN.md) y [PLAN_MEJORA.md](../dataset-generator/PLAN_MEJORA.md)).

---

## 1. Resumen General

`expresat-dataset-generator` es una aplicación C++/OpenCV/ImGui pensada para capturar muestras y exportar tensores de 178 características compatibles con el entrenamiento GRU:
- **Modo MediaPipe real** (`EXPRESAT_USE_MEDIAPIPE` definido): previsto para MediaPipe Tasks C++ API.
- **Modo Stub** (activo por defecto): genera landmarks sintéticos mediante ondas senoidales para pruebas de interfaz y exportación.

**Problemas críticos detectados:** ejecución en modo stub por defecto, MediaPipe C++ no enlazado, riesgo de desalineación de vectores 178D y configuración de build CMake sin guía explícita.

---

## 2. Auditoría Archivo por Archivo (Instantánea del 2026-11-08)

### `src/mediapipe_extractor.cpp` (extracción de landmarks y normalización)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Crítica** | **MediaPipe real no enlazado; stub activo siempre** | La guarda `#if EXPRESAT_USE_MEDIAPIPE && !EXPRESAT_STUB_EXTRACTOR` en `open()` caía en modo stub registrando `"[MediapipeExtractor] Real MediaPipe mode not fully linked."`. | 51–65 |
| **Crítica** | **`process()` genera ondas senoidales sintéticas** | Produce coordenadas falsas no provenientes de cámara; los datasets resultantes no representan señas reales. *(Motivo posterior de cuarentena para `letra_a_derecha_2.json`.)* | 78–110 |
| **Alta** | **`extract()` depende del layout 178D** | Concatena Upper Pose (`13 x 4 = 52`), Mano Izquierda (`21 x 3 = 63`) y Mano Derecha (`21 x 3 = 63`). Cualquier cambio dimensional rompe el entrenamiento. | 119–178 |
| **Alta** | **`normalizePose()` usa centro y distancia de hombros (11 y 12)** | Fórmula 3D consistente solo si se mantienen los mismos índices anatómicos y transformación. *(Nota: posteriormente se observó que `z` y `visibility` requerían reglas estrictas documentadas en `FEATURE_SPEC v1.3.0`.)* | 181–218 |
| **Media** | **Dependencia de `BodyPartConfig`** | Banderas `upperPose`, `leftHand` y `rightHand` deben coincidir con los consumidores para no alterar la longitud del vector. | 137–174 |
| **Media** | **Tablas de conexión cableadas (`POSE_CONNECTIONS`, `HAND_CONNECTIONS`)** | Requieren actualizarse manualmente si cambia la topología de MediaPipe. | 15–40 |
| **Baja** | **Alineación de `FrameLandmarks`** | Estructuras `pose` (33), `leftHand` (21) y `rightHand` (21) respecto al formato de consumidor JS/Python. | `types.h`, `mediapipe_extractor.h` |
| **Baja** | **Opción CMake `EXPRESAT_USE_MEDIAPIPE` sin documentación operativa** | Compilación estándar siempre cae en stub si no se define externamente `MEDIAPIPE_ROOT`. | `CMakeLists.txt` |

### `src/types.h` (tipos de datos)

| Severidad | Hallazgo | Evidencia | Líneas |
|---|---|---|---|
| **Baja** | **Compatibilidad de campos en `Landmark`** | Requiere `x, y, z, visibility` alineados con el extractor real si se enlaza MediaPipe C++. | Archivo completo |
| **Baja** | **Dimensión fija `TOTAL_FEATURES = 178`** | Debe coincidir con `feature_extractor.py`, frontend y modelo ONNX. | Archivo completo |

### Otros Módulos (`camera_stream`, `data_augmenter`, `dataset_writer`, `gui_manager`, `main.cpp`)

| Severidad | Módulo | Hallazgo | Líneas |
|---|---|---|---|
| **Baja** | `camera_stream.*` | Captura frames BGR vía OpenCV; desacoplado de las capturas `<video>` del navegador. | Archivo completo |
| **Baja** | `data_augmenter.*` | Aplica transformaciones sobre secuencias exportadas *(posteriormente se detectó que `applyScale` escalaba también `visibility` por encima de `1.0`)*. | Archivo completo |
| **Baja** | `dataset_writer.*` | Serializa secuencias 178D a JSON indentado con alto consumo de RAM (`nlohmann::json`). | Archivo completo |
| **Baja** | `gui_manager.*` / `main.cpp` | Sin selector en tiempo de ejecución ni bandera CLI (`--mediapipe` / `--stub`) para alternar extractores. | Archivos completos |

---

## 3. Compatibilidad de Pipeline (Instantánea del 2026-11-08)

| Hallazgo | Evidencia Histórica |
|---|---|
| **Dimensión 178D compartida** | Generador C++, frontend web y backend FastAPI dependen del layout `52 + 63 + 63 = 178`. |
| **Normalización por hombros** | La fórmula centrada en hombros 11 y 12 coincide conceptualmente, pero la falta de extracción temporal unificada (`ExtractWindow`) motivó desacoplar la captura web del pipeline offline en Python. |
| **Índices anatómicos** | Pose (33 puntos) y manos (21 puntos) requieren versionado estricto si se actualizan modelos MediaPipe. |

---

## 4. Resumen de Severidades y Prioridades Originales

| Severidad | Cantidad |
|---|---|
| Crítica | 3 |
| Alta | 3 |
| Media | 5 |
| Baja | 5 |

**Prioridades originales reportadas:**
1. Definir la estrategia entre enlazar MediaPipe C++ o migrar la captura real al navegador (**decisión posterior:** captura web en navegador + pipeline offline en Python en [PLAN.md](../dataset-generator/PLAN.md)).
2. Asegurar `TOTAL_FEATURES = 178` y consistencia numérica multiplataforma (`FEATURE_SPEC v1.3.0`).
3. Validar esquemas de entrada/salida (`validate_dataset.py` e `inspect_recording.py`).
4. Evitar contaminación del entrenamiento con datos sintéticos del stub (`quarantine/letra_a_derecha_2.json`).
