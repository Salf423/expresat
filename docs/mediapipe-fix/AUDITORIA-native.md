# Auditoría MediaPipe — Nativo / Desktop (`expresat-native`)

- **Ámbito:** `expresat-native/`
- **Proyecto:** ExpresaT — Aplicación Nativa de Escritorio para Reconocimiento de Señas
- **Fecha:** 2026-11-08
- **Estado:** **Histórico (Bloqueado posteriormente por conformidad `v1.3.0`)**

> [!NOTE]
> Posteriormente a esta auditoría inicial, el módulo `expresat-native/` fue marcado formalmente como **`NO_CONFORME_FEATURE_SPEC_1_3_0`**: aunque [`inference_thread.cpp`](../../expresat-native/core/src/inference_thread.cpp) calcula la escala 3D de hombros en `normalize_to_shoulders()`, no implementa `ExtractWindow` (`v1.3.0`) y rechaza activamente la ejecución devolviendo `ERR_CPP_NOT_CONFORMANT_FEATURE_SPEC_1_3_0`. Véase [FEATURE_SPEC.md](../dataset-generator/FEATURE_SPEC.md).

---

## 1. Resumen General

La aplicación de escritorio nativa es un cliente C++/OpenGL/ImGui con:
- **Captura de cámara** mediante OpenCV (`cv::VideoCapture`).
- **Inferencia ONNX Runtime** (`inference_thread.cpp`), sin MediaPipe Tasks C++ enlazado.
- **Extracción de landmarks** (`extract_landmarks()` implementado como stub pendiente de reemplazar).
- **Arquitectura multihilo:** hilo de captura + cola SPSC lock-free (`frame_queue.h`) + hilo de inferencia + bus de resultados (`result_bus.h`).
- **Interfaz gráfica** con Dear ImGui sobre OpenGL 3.

**Hallazgos críticos:** stub de `extract_landmarks()`, ruta del modelo ONNX, consistencia del formato de landmarks y seguridad entre hilos.

---

## 2. Auditoría Archivo por Archivo (Instantánea del 2026-11-08)

### `desktop/main.cpp` (punto de entrada de escritorio)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Baja** | **Sin integración real de MediaPipe** | Captura frames OpenCV y ejecuta ONNX Runtime; no enlaza MediaPipe Tasks C++. | Archivo completo |
| **Baja** | **Ruta de modelo ONNX cableada por defecto** | Apunta a `models/exported_model/expresat_gru_float32.onnx`; sin modelos `.task` ni WASM. | 231–233 |
| **Baja** | **Índice de cámara sin validación previa** | `camera_index` por defecto en `0` sin verificación previa antes de lanzar hilos. | 234 |

### `core/src/inference_thread.cpp` (pipeline de inferencia)

| Severidad | Hallazgo | Evidencia | Líneas (snapshot) |
|---|---|---|---|
| **Crítica** | **`extract_landmarks()` es un stub** | Marcado con comentario `TODO` de reemplazo por MediaPipe Tasks C++ API; retorna un `LandmarkFrame` vacío/sintético sin leer el frame real de cámara, produciendo entradas inválidas para ONNX. | 301–310 |
| **Alta** | **Extracción `extract_pose_upper()` y `extract_hand()`** | Extraen 52D de pose y 63D por mano esperando un `LandmarkFrame` poblado con coordenadas reales para alcanzar `NUM_FEATURES = 178`. | 200–228 |
| **Alta** | **`preprocess_sequence()` ensambla el tensor `[1, 15, 178]`** | Requiere 15 frames válidos; si `extract_landmarks()` permanece en stub, el modelo recibe ceros o datos sintéticos. | 170–198 |
| **Media** | **`normalize_to_shoulders()` normaliza respecto a hombros** | Usa landmarks 11 y 12 (`cx, cy, cz` y distancia 3D). *(Nota: sin `ExtractWindow` `v1.3.0`, el pipeline completo queda bloqueado por conformidad.)* | 231–255 |
| **Baja** | **Cálculo de FPS y latencias de preprocesamiento/inferencia** | Registra tiempos de inferencia para diagnóstico. | 130–137 |
| **Baja** | **Buffer circular de 15 frames** | `push_landmark_frame()` mantiene ventana de `SEQUENCE_LENGTH = 15`. | 162–166 |

### `core/include/inference_thread.h` (cabecera)

| Severidad | Hallazgo | Evidencia | Líneas |
|---|---|---|---|
| **Baja** | **Compatibilidad de `LandmarkFrame`** | Define `pose` (33), `left_hand` (21) y `right_hand` (21); debe coincidir con cualquier extractor MediaPipe futuro. | Archivo completo |
| **Baja** | **Estructura diagnóstica `EngineInfo`** | Expone archivo de modelo, versión ORT, nombres de tensores, longitud de secuencia y dimensión de features. | Archivo completo |

### `core/include/landmark_types.h` *(citado originalmente por error como `core/src/types.h`)*

| Severidad | Hallazgo | Evidencia | Líneas |
|---|---|---|---|
| **Baja** | **Campos de structs de landmarks** | `PoseLandmark` (`x, y, z, visibility`) y `HandLandmark` (`x, y, z`) en [`core/include/landmark_types.h`](../../expresat-native/core/include/landmark_types.h) deben coincidir exactamente con la salida de MediaPipe si se reemplaza el stub. | Archivo completo |
| **Baja** | **Constantes dimensionales del modelo** | `SEQUENCE_LENGTH = 15`, `NUM_FEATURES = 178`, `NUM_CLASSES = 15` y `POSE_UPPER_INDICES` deben mantenerse alineados con `model_metadata.json`. | Archivo completo |

---

## 3. Compatibilidad entre Plataformas (Análisis de 2026-11-08)

| Hallazgo | Evidencia |
|---|---|
| **Invariante 178D transversal** | Desktop (`extract_pose_upper` + `extract_hand`), web y backend requieren coincidir en `52 + 63 + 63 = 178` características por frame en ventanas de 15 frames. |
| **Normalización por hombros** | Desktop, generador C++ y modelo Python coinciden en el uso de hombros 11 y 12, aunque solo Python y JS implementan hoy `ExtractWindow` completo (`FEATURE_SPEC v1.3.0`). |
| **MediaPipe Tasks C++ no enlazado** | La app de escritorio opera únicamente con OpenCV + ONNX Runtime; el módulo nativo quedó formalmente bloqueado (`ERR_CPP_NOT_CONFORMANT_FEATURE_SPEC_1_3_0`) hasta implementar el extractor conforme. |

---

## 4. Resumen de Severidades y Prioridades Originales

| Severidad | Cantidad |
|---|---|
| Crítica | 1 |
| Alta | 3 |
| Media | 1 |
| Baja | 7 |

**Orden de prioridades registrado:**
1. Reemplazar el stub `extract_landmarks()` con extracción MediaPipe real o puente equivalente.
2. Verificar alineación de `LandmarkFrame` / `PoseLandmark` / `HandLandmark` con la API elegida.
3. Confirmar coincidencia de `NUM_FEATURES = 178` con el modelo ONNX activo.
4. Garantizar conformidad completa con [`FEATURE_SPEC.md`](../dataset-generator/FEATURE_SPEC.md) (`ExtractWindow`) antes de levantar el bloqueo `NO_CONFORME_FEATURE_SPEC_1_3_0`.

**Evidencia clave verificada:**
- `inference_thread.cpp`: `extract_landmarks()` retorna un `LandmarkFrame` vacío (stub); `preprocess_sequence()` genera tensores `[1, 15, 178]`; actualmente `InferenceThread::run()` aborta con `ERR_CPP_NOT_CONFORMANT_FEATURE_SPEC_1_3_0` salvo que `CPP_FEATURE_SPEC_CONFORMANCE == "CONFORME"`.
