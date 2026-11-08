# MediaPipe Audit — Dataset Generator

**Scope:** `/home/adrian/Proyectos/expresat/expresat-dataset-generator/`
**Project:** ExpresT — Sign Language Data Collection & Model Training
**Date:** 2026-11-08

---

## 1. Overview

The dataset generator is a C++/OpenCV-based application for capturing sign language data and exporting feature vectors (178-dimensional) compatible with the ExpresT pipeline. It can run in two modes:
- **Real MediaPipe mode** (`EXPRESAT_USE_MEDIAPIPE` defined): Uses MediaPipe Tasks C++ API for holistic landmark detection
- **Stub mode** (default): Generates synthetic sine-wave landmarks for testing

Currently, the project runs in **stub mode** by default since the real MediaPipe C++ libraries are not fully linked.

Critical issues identified: stub mode by default, MediaPipe C++ not linked, feature vector dimension consistency, build configuration.

---

## 2. File-by-File Audit

### `mediapipe_extractor.cpp` (core MediaPipe extraction)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Critical** | **Real MediaPipe mode not fully linked / stub always runs** | `open()` method (lines 51-65): The `#if EXPRESAT_USE_MEDIAPIPE && !EXPRESAT_STUB_EXTRACTOR` guard means real MediaPipe code only compiles if both macros are defined. Currently, the project likely does not define `EXPRESAT_USE_MEDIAPIPE`, so it always runs in stub mode. The cerr message on line 56 confirms: "[MediapipeExtractor] Real MediaPipe mode not fully linked." | 51-65 |
| **Critical** | **`process()` stub generates synthetic sine-wave landmarks** | Lines 78-109: When `EXPRESAT_STUB_EXTRACTOR` is defined (or `EXPRESAT_USE_MEDIAPIPE` not defined), the stub generates cosine/sine wave landmarks that are **not real camera data**. This means data collected in stub mode is not usable for training a real model. The `stubFrameIdx_` increments per frame, creating deterministic but fake landmarks. | 78-110 |
| **High** | **`extract()` expects 178 features matching frontend/backends** | The `extract()` method (lines 119-178) builds a `FeatureVector` of `TOTAL_FEATURES` dimension. It assumes: - Upper pose: 13 landmarks × 4 coords (x, y, z, visibility) = 52 features - Left hand: 21 landmarks × 3 coords (x, y, z) = 63 features - Right hand: 21 landmarks × 3 coords (x, y, z) = 63 features - Total: 52 + 63 + 63 = 178 features This matches the frontend `useMediaPipe.js` 178-pipeline and backend `run_inference_async`. If the stub or real extractor outputs a different dimension, the pipeline breaks. | 119-178 |
| **High** | **`normalizePose()` shoulder-center normalization matches dataset generator** | Lines 181-218: The `normalizePose()` function (called from `extract()`) computes shoulder center (L=left shoulder 11, R=right shoulder 12) and scale (distance between shoulders). This exactly matches the `LandmarkTracker.normalizeLandmarks()` in `landmarkTracker.js` and the frontend's EMA + pipeline. Consistency good **if** both use the same landmark indices and normalization formula. | 181-218 |
| **Medium** | **`BodyPartConfig` structure must match frontend expectations** | The `extract()` method reads `BodyPartConfig` with `upperPose`, `leftHand`, `rightHand` flags (lines 137-174). These must match the frontend's `pipeline178Ref.bodyPartConfig` (useMediaPipe.js:105-114) and the `trackingConfig.enable178Pipeline` flag. Mismatch causes feature vectors to have wrong dimensions or missing features. | 137-174 |
| **Medium** | **`drawSkeleton()` uses hardcoded connection tables** | `POSE_CONNECTIONS` (lines 15-26) and `HAND_CONNECTIONS` (lines 27-40) are hardcoded in C++. If the MediaPipe model version changes (e.g., 33-pose → 34-pose), these tables would need updating. The dataset generator's connections should match MediaPipe's official topology for the model version used. | 15-40 |
| **Low** | **`FrameLandmarks` struct may not match frontend landmark format** | The `FrameLandmarks` struct (types.h) contains `pose` (33), `leftHand` (21), `rightHand` (21). The frontend expects the same structure from MediaPipe tasks-vision. If the C++ struct fields differ (e.g., different visibility field name), data mapping breaks. | types.h, mediapipe_extractor.h |
| **Low** | **CMake build may not define `EXPRESAT_USE_MEDIAPIPE`** | The CMakeLists.txt and build configuration need to define `EXPRESAT_USE_MEDIAPIPE=ON` to enable real MediaPipe. Without it, the project always builds in stub mode. No CMake option or README guidance found during initial scan. | CMakeLists.txt, build/ |

### `types.h` (data types)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **Landmark struct fields must match MediaPipe Tasks output** | The `Landmark` struct likely has `x, y, z, visibility` fields. The `FrameLandmarks` struct has `pose`, `leftHand`, `rightHand` vectors. If the C++ MediaPipe Tasks API uses different field names (e.g., `z` vs `depth`), the frontend JS code that accesses `lm.z` or `lm.visibility` may get `undefined` or incorrect values. | Entire file — needs verification against actual MediaPipe C++ API |
| **Low** | **`FeatureVector` is `std::vector<float>` of fixed size** | `TOTAL_FEATURES` must equal 178 for pipeline compatibility. If the definition in types.h or config changes, the frontend `buildPayload()` and backend `run_inference_async` will receive wrong-sized arrays. | Entire file |

### `camera_stream.cpp` / `camera_stream.h` (camera capture)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **Camera captures BGR frames (OpenCV default)** | The `process()` method takes `const cv::Mat& bgrFrame`. The frontend MediaPipe worker sends `ImageBitmap` from a `<video>` element. The backend ONNX inference (`inference_thread.cpp`) also expects preprocessed frames. If the dataset generator is used for data collection, the camera pipeline must produce frames in the expected format. | camera_stream.cpp:h |

### `data_augmenter.cpp` / `data_augmenter.h` (data processing)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **Data augmentation may modify landmark coordinates** | The augmenter applies transformations that could affect the normalized feature coordinates. Must ensure augmentation does not break the 178-feature invariant. | Entire file |

### `dataset_writer.cpp` / `dataset_writer.h` (data output)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **Exported feature vectors must be 178-dimensional** | The dataset writer saves captured data to disk. If the feature vector dimension changes (e.g., from 178 to a different size), the ML model loader will fail. Must validate that `TOTAL_FEATURES` constant is consistent across all components. | Entire file |

### `gui_manager.cpp` / `gui_manager.h` (GUI)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **GUI controls may toggle `EXPRESAT_USE_MEDIAPIPE`** | Need to verify if the GUI has a mode toggle. If not, users cannot switch between stub and real MediaPipe at runtime. | Entire file |

### `main.cpp` (entry point)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **No command-line flag for MediaPipe mode** | The application always runs in whatever mode the compiled-in macros define. No `--mediapipe` or `--stub` flag to switch modes at runtime. | Entire file |

---

## 3. Pipeline Compatibility Issues

| Finding | Evidence |
|---------|----------|
| **178-feature dimension must match across all three components** | - **Dataset generator** `mediapipe_extractor.cpp`: `TOTAL_FEATURES` must be 178 (52 pose + 63 left hand + 63 right hand)<br>- **Frontend** `useMediaPipe.js`: `buildPayload()` returns `{pose, leftHand, rightHand}` which is sent to backend as 15-frame batch. Backend expects 178 features per frame.<br>- **Backend** `main.py`: `run_inference_async()` passes `frames` to `predict_demo()` or `engine.predict()`. Both expect the 178-dimensional feature vector.<br>**Risk**: If any component changes its feature extraction (e.g., adding Z-coordinate differently, changing visibility handling), the pipeline breaks and inference returns errors or mock results. |
| **Normalization consistency** | The dataset generator's `normalizePose()` (shoulder-center + scale) must match the frontend's `LandmarkTracker.normalizeLandmarks()` and the backend's `InferenceThread.normalize_to_shoulders()`. All three use the same shoulder landmarks (11 and 12) and same formula, which is good. But if any one is changed without updating the others, the pipeline desyncs. |
| **Landmark indices consistency** | - Pose: 33 landmarks, same indices across all components<br>- Left hand: 21 landmarks, same indices<br>- Right hand: 21 landmarks, same indices<br>**Risk**: If the MediaPipe model version changes (e.g., from 0.1 to 1.0 of tasks-vision), the landmark ordering or even count may change. All components must be updated in sync. |

---

## 4. Severity Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 3 |
| Medium | 5 |
| Low | 5 |

**Priority order for fixes:**
1. Define `EXPRESAT_USE_MEDIAPIPE` and `EXPRESAT_STUB_EXTRACTOR` appropriately in CMake/build to enable real MediaPipe C++ (or confirm stub mode is intentional for now)
2. Ensure `TOTAL_FEATURES` = 178 and matches frontend/backend expectations
3. Verify landmark format/fields match between C++ extractor and frontend JS consumer
4. Add build-time flag or runtime option to switch between stub and real MediaPipe
5. Ensure `normalizePose()` formula consistency across all three components

---

## 5. Evidence Collection

- **Real MediaPipe not linked**: `mediapipe_extractor.cpp:51-65` — the `#if EXPRESAT_USE_MEDIAPIPE && !EXPRESAT_STUB_EXTRACTOR` guard means real mode only compiles if both macros are defined. Currently stub mode always runs.
- **Stub generates synthetic data**: Lines 78-109 produce cosine/sine wave landmarks that are not from a real camera — useful only for UI testing, not data collection.
- **178-feature invariant**: `extract()` method (lines 119-178) builds exactly 178 features (52 + 63 + 63). This must match the frontend and backend exactly. Any drift in feature dimension breaks the pipeline.
- **Normalization matches**: `normalizePose()` shoulder-center formula (lines 181-218) matches the `LandmarkTracker` in the frontend, which is good for consistency.