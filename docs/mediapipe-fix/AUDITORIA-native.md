# MediaPipe Audit — Desktop / Native

**Scope:** `/home/adrian/Proyectos/expresat/expresat-native/`
**Project:** ExpresT — Desktop Sign Recognition Application
**Date:** 2026-11-08

---

## 1. Overview

The native desktop application is a C++/OpenGL/ImGui-based standalone app for sign language recognition. Key features:
- **Camera capture** via OpenCV (`cv::VideoCapture`)
- **ONNX Runtime inference** for sign classification (not MediaPipe Tasks)
- **Landmark extraction** from camera frames ( MediaPipe stub — TODO to replace)
- **Two-thread architecture**: camera thread + inference thread
- **UI** via ImGui rendered with OpenGL3

The app uses **ONNX Runtime** for inference, not MediaPipe Tasks. However, the `extract_landmarks()` method (a stub) is a placeholder for future MediaPipe C++ integration. The feature pipeline expects 178-dimensional feature vectors matching the frontend/backend.

Critical issues identified: MediaPipe stub not replaced, ONNX model path, landmark format consistency, thread safety.

---

## 2. File-by-File Audit

### `main.cpp` (desktop entry point)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **No MediaPipe integration currently** | The app uses ONNX Runtime for inference (`inference_thread.cpp`), not MediaPipe Tasks. The camera thread captures OpenCV frames, the inference thread extracts landmarks (stub) and runs ONNX model. No MediaPipe C++ API is linked or used. | Entire file |
| **Low** | **Model path hardcoded to ONNX, not MediaPipe** | Default model: `models/exported_model/expresat_gru_float32.onnx` (line 233). No MediaPipe `.task` or `.wasm` files are referenced. | 231-233 |
| **Low** | **Camera index configurable but no default check** | `camera_index` defaults to 0 (line 234). No check if camera is available before starting threads. | 234 |

### `core/src/inference_thread.cpp` (inference pipeline)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Critical** | **`extract_landmarks()` is a stub with TODO to replace with MediaPipe** | Lines 301-310: `<comment>MediaPipe stub (replace with MediaPipe Tasks C++ API)</comment>`. The method returns hardcoded empty `LandmarkFrame` with 33/21/21 landmark arrays filled with dummy data (or just default-constructed). If the app is used for sign recognition with the ONNX model, the features will be garbage/invalid because no real landmarks are extracted. | 302-310 |
| **High** | **Landmark feature extraction `extract_pose_upper()` and `extract_hand()`** | Lines 200-228: These methods extract upper-pose (52 dims) and hand (63 dims each) features from the `LandmarkFrame`. They expect the `LandmarkFrame` to be populated with real landmark coordinates. Since `extract_landmarks()` is a stub, these will output zeros or synthetic values. The feature vector dimension (POSE_UPPER_INDICES × 4 + HAND_POINTS × 3) must match the ONNX model's expected input of `NUM_FEATURES`. | 200-228 |
| **High** | **`preprocess_sequence()` assembles [1, 15, 178] tensor for ONNX** | Lines 170-198: The tensor shape is `[1, SEQUENCE_LENGTH, NUM_FEATURES]` = `[1, 15, 178]`. This matches the 178-feature pipeline (pose 52 + left hand 63 + right hand 63). **Critical**: If `extract_landmarks()` stub doesn't populate real landmarks, the ONNX input tensor will have wrong values (likely zeros or synthetic sine-waves). | 170-198 |
| **Medium** | **`normalize_to_shoulders()` normalizes relative to shoulders** | Lines 231-255: Uses shoulder landmarks 11 and 12 to compute center and scale. This matches the dataset generator and frontend `LandmarkTracker`. If the stub `extract_landmarks()` populates landmarks with the synthetic data from the dataset generator's stub, normalization will work but on fake data. | 231-255 |
| **Low** | **FPS calculation and latency tracking** | Lines 130-137: FPS is calculated from inference calls. Latency tracking for preprocess and inference is present. Useful for performance debugging. | 130-137 |
| **Low** | **Sequence buffer of 15 frames** | Lines 162-166: `push_landmark_frame()` stores frames in a circular buffer of `SEQUENCE_LENGTH` (15). Matches the frontend's 15-frame temporal window and the backend's `ConnectionManager.frame_buffer` deque maxlen=15. | 162-166 |

### `core/include/inference_thread.h` (header)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **`LandmarkFrame` struct must match frontend/backend format** | The header defines `LandmarkFrame` with `pose` (33), `left_hand` (21), `right_hand` (21). The `PoseLandmark` and `HandLandmark` structs likely have `x, y, z` fields. Must ensure this matches the MediaPipe Tasks output format if/when the stub is replaced. | Entire file — needs verification |
| **Low** | **`EngineInfo` struct returned by `engine_info()`** | Returns model file, ONNX version, input/output names, sequence length, number of features. Used for diagnostics. | Entire file |

### `core/src/types.h` (types definition)

| Severity | Finding | Evidence | Line(s) |
|----------|---------|----------|---------|
| **Low** | **Landmark struct fields** | Need to verify that `PoseLandmark` and `HandLandmark` have `x, y, z` (and possibly `visibility`) fields matching the MediaPipe Tasks C++ API. If the stub is replaced with real MediaPipe, the struct fields must match exactly for the feature extraction methods to compile and run correctly. | Entire file — needs verification against actual MediaPipe C++ API |
| **Low** | **`SIGN_LABELS` array** | Defines the signs the model can recognize. Must match the ONNX model's output classes. | Entire file |

### `desktop/main.cpp` (already audited above, no additional findings)

---

## 3. Pipeline Compatibility Issues

| Finding | Evidence |
|---------|----------|
| **178-feature invariant across all three platforms** | - **Desktop**: `inference_thread.cpp` expects to receive `LandmarkFrame` with 33 pose + 21 left hand + 21 right hand landmarks, then extracts features: 52 (upper pose) + 63 (left hand) + 63 (right hand) = 178 features via `extract_pose_upper()`, `extract_hand()`, and `normalize_to_shoulders()`.<br>- **Frontend**: `useMediaPipe.js` `buildPayload()` returns same structure, sent to backend as 15-frame batch.<br>- **Backend**: `main.py` `run_inference_async()` expects same 178-dim feature vector per frame.<br>**Risk**: If any platform's `extract_landmarks()` or feature extraction changes dimensions, the entire pipeline breaks. The desktop stub is the most likely point of failure since it's not connected to a real MediaPipe implementation. |
| **Normalization must match** | All three platforms use shoulder-center normalization (landmarks 11 and 12). The frontend `LandmarkTracker.normalizeLandmarks()` (landmarkTracker.js:148-182), the dataset generator `MediapipeExtractor.normalizePose()` (mediapipe_extractor.cpp:181-218), and the desktop `InferenceThread.normalize_to_shoulders()` (inference_thread.cpp:231-255) all use the same formula. This is consistent **as long as** the input landmarks have the same meaning (landmark 11 = left shoulder, 12 = right shoulder). |
| **MediaPipe Tasks C++ not linked in desktop** | The desktop app has a TODO stub (`extract_landmarks()` line 302-310) but no actual MediaPipe C++ integration. The app relies on ONNX Runtime alone. If the goal is to use MediaPipe for landmark detection, the desktop app needs a real MediaPipe Tasks C++ implementation or a bridge to the frontend worker approach. |

---

## 4. Severity Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 3 |
| Medium | 1 |
| Low | 7 |

**Priority order for fixes:**
1. **Replace `extract_landmarks()` stub with real MediaPipe Tasks C++ API** or integrate the frontend Web Worker approach (send frames to worker, receive landmarks). This is the highest priority because without real landmarks, the ONNX inference will produce garbage results.
2. Ensure `LandmarkFrame` / `PoseLandmark` / `HandLandmark` structs match the MediaPipe Tasks C++ API format if the stub is replaced.
3. Verify `NUM_FEATURES` = 178 matches the ONNX model's expected input dimension.
4. Ensure `normalize_to_shoulders()` formula consistency with frontend/dataset generator.
5. Add command-line or config option to switch between stub/synthetic landmarks and real MediaPipe input.

---

## 5. Evidence Collection

- **`extract_landmarks()` is a stub**: `inference_thread.cpp:301-310` — the method has a TODO comment and returns default-constructed `LandmarkFrame` without reading from the actual camera frame. The `// TODO: Replace with MediaPipe Tasks C++ API` comment confirms this is pending work.
- **ONNX model uses 178 features**: The tensor shape `[1, 15, 178]` (inference_thread.cpp:275) matches the 178-feature pipeline. If the stub produces wrong landmark data, the ONNX model will receive incorrect inputs.
- **Normalization consistency**: `normalize_to_shoulders()` (lines 231-255) uses the same shoulder-center + scale formula as the frontend and dataset generator, which is good for when the stub is eventually replaced.
- **No MediaPipe C++ integration**: The desktop app currently has zero MediaPipe Tasks C++ code. It's purely ONNX Runtime + OpenCV camera capture. MediaPipe would need to be added separately.