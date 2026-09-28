# expresat-dataset-generator

Native C++ desktop tool for capturing **sign language gesture samples** in real-time, normalizing MediaPipe landmarks, and generating synthetic augmented datasets ready for training the ExpresaT GRU model via GitHub Actions.

---

## Architecture

```
expresat-dataset-generator/
├── CMakeLists.txt              # CMake build (OpenCV 5, GLFW, ImGui, nlohmann/json)
├── scripts/
│   ├── setup_third_party.sh   # Fetch ImGui, GLAD, nlohmann/json
│   └── build.sh               # One-command build (debug | release | mediapipe)
├── src/
│   ├── types.h                 # Shared constants & data structures (178D layout)
│   ├── camera_stream.h/.cpp    # Background OpenCV capture → GL texture
│   ├── mediapipe_extractor.h/.cpp  # Landmark extraction + shoulder normalization
│   ├── data_augmenter.h/.cpp   # Synthetic augmentation engine
│   ├── dataset_writer.h/.cpp   # JSON serializer compatible with train_and_export.py
│   ├── gui_manager.h/.cpp      # Dear ImGui GUI (GLFW/OpenGL 3.3)
│   └── main.cpp
└── dataset/                    # Generated JSON files land here
```

## Feature Vector Layout (178D per frame)

| Segment | Landmarks | Coords | Dim |
|---------|-----------|--------|-----|
| Upper Pose | 13 pts (0, 11–22) | x, y, z, visibility | **52** |
| Left Hand | 21 pts (0–20) | x, y, z | **63** |
| Right Hand | 21 pts (0–20) | x, y, z | **63** |
| **Total** | | | **178** |

**Normalization**: Shoulder-center subtraction — all x,y,z coordinates are shifted by the midpoint of landmarks 11 (left shoulder) and 12 (right shoulder). This makes the data invariant to user position and distance from the camera.

## Quick Start

### 1. Install system dependencies (Arch Linux)

```bash
sudo pacman -S opencv cmake base-devel libx11 libxrandr libxinerama libxcursor libxi
```

### 2. Fetch third-party libs

```bash
bash scripts/setup_third_party.sh
```

### 3. Build & run (stub mode — no MediaPipe required)

```bash
bash scripts/build.sh release
./build_release/expresat_dataset_generator
```

### 4. Build with real MediaPipe

```bash
export MEDIAPIPE_ROOT=/path/to/mediapipe
bash scripts/build.sh mediapipe
```

## GUI Workflow

1. **Configure** body parts (checkboxes), label name, number of synthetic samples, sequence length.
2. **Click "Grabar Muestra Base"** — 3-second countdown, then live recording of N frames.
3. **Click "Generar y Guardar Dataset Sintético"** — background worker applies augmentation and writes `./dataset/<label>.json`.
4. **Push to GitHub** — Actions automatically trains and exports the ONNX model.

## Data Augmentation Pipeline

Each synthetic sample is generated from the real base sequence by sequentially applying:

| Transform | Algorithm | Parameters |
|-----------|-----------|------------|
| Gaussian Noise | `P' = P + N(0, σ²)` | σ ∈ [0.005, 0.02] |
| Spatial Scale | `P'' = P' × s` | s ~ U(0.9, 1.1) |
| 2D XY Rotation | Standard 2D rotation matrix | θ ~ U(−5°, +5°) |
| Temporal Warp | Frame-index resampling with linear interpolation | ±10% speed |

## Output Format

```json
{
  "label": "hola",
  "num_samples": 500,
  "sequence_length": 15,
  "feature_dim": 178,
  "data": [
    [ [f0, f1, ..., f177], ... ],  // 15 frames × 178 features
    ...
  ]
}
```

One file per label: `./dataset/<label>.json`  
Combined: `./dataset/dataset.json` (for CI/training scripts)

## Build Modes

| Mode | Command | MediaPipe | Use case |
|------|---------|-----------|---------|
| `debug` | `bash scripts/build.sh debug` | Stub | Fast GUI iteration |
| `release` | `bash scripts/build.sh release` | Stub | Demo / testing |
| `mediapipe` | `bash scripts/build.sh mediapipe` | Real | Production |

## GitHub Actions

The workflow at `.github/workflows/train_model.yml` triggers automatically when JSON files are pushed to `expresat-dataset-generator/dataset/`:

1. Validates all label JSON files
2. Trains `SignLanguageGRU` with real labels
3. Exports `expresat_gru_float32.onnx` + quantizes to `expresat_gru_int8.onnx`
4. Uploads artifacts + optionally commits model back to `main`
