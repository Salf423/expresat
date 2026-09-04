# expresat-native

> Native C++ inference engine for Expresat - Spanish Sign Language Recognition

## Prerequisites

| Tool | Minimum Version | Notes |
|---|---|---|
| CMake | 3.24 | `cmake --version` |
| Ninja | 1.11 | `ninja --version` |
| GCC/Clang | GCC 10 / Clang 12 | C++17 required |
| vcpkg | latest | Cloned automatically |
| GLFW3 | 3.3 | Installed via vcpkg |
| OpenCV | 4.x | Installed via vcpkg |
| ONNX Runtime | 1.19.2 | Prebuilt binaries |

## Quick Start - Linux

```bash
# 1. Clone with submodules
git clone --recurse-submodules <repo>
cd expresat-native

# 2. Update submodules
git submodule update --init --recursive

# 3. Download ONNX Runtime
mkdir -p third_party
wget https://github.com/microsoft/onnxruntime/releases/download/v1.19.2/onnxruntime-linux-x64-1.19.2.tgz
tar -xzf onnxruntime-linux-x64-1.19.2.tgz
mv onnxruntime-linux-x64-1.19.2 third_party/onnxruntime

# 4. Bootstrap vcpkg
git clone https://github.com/microsoft/vcpkg.git vcpkg
./vcpkg/bootstrap-vcpkg.sh -disableMetrics
export VCPKG_ROOT=$(pwd)/vcpkg

# 5. Build (Debug)
cmake --preset linux-debug
cmake --build --preset linux-debug

# 6. Run
./build/linux-debug/bin/expresat_desktop \
    ../expresat/models/exported_model/expresat_gru_float32.onnx \
    0
```

## Quick Start - Windows (PowerShell)

```powershell
# 1. Download ONNX Runtime
Invoke-WebRequest `
    "https://github.com/microsoft/onnxruntime/releases/download/v1.19.2/onnxruntime-win-x64-1.19.2.zip" `
    -OutFile ort.zip
Expand-Archive ort.zip -DestinationPath .
Move-Item onnxruntime-win-x64-1.19.2 third_party\onnxruntime

# 2. Bootstrap vcpkg
git clone https://github.com/microsoft/vcpkg.git vcpkg
.\vcpkg\bootstrap-vcpkg.bat -disableMetrics
$env:VCPKG_ROOT = "$(pwd)\vcpkg"

# 3. Build
cmake --preset windows-release
cmake --build --preset windows-release

# 4. Run
.\build\windows-release\bin\Release\expresat_desktop.exe `
    ..\expresat\models\exported_model\expresat_gru_float32.onnx
```

## Project Structure

```
expresat-native/
├── CMakeLists.txt          # Root build file
├── CMakePresets.json       # Build presets
├── vcpkg.json              # Dependencies
├── core/                   # Shared core library
│   ├── include/
│   │   ├── frame_queue.h       # Lock-free SPSC ring buffer
│   │   ├── result_bus.h        # Atomic result bus
│   │   ├── landmark_types.h    # Data types (178 features)
│   │   └── inference_thread.h  # Inference pipeline
│   └── src/
│       └── inference_thread.cpp # C++ port of inference engine
├── desktop/                # Windows / Linux target
│   ├── main.cpp            # ImGui + GLFW
│   └── CMakeLists.txt
├── android/                # Android target
│   ├── app/build.gradle    # Gradle build file
│   └── app/src/main/
│       ├── cpp/android_main.cpp  # JNI bridge
│       └── java/.../MainActivity.java
└── .github/workflows/
    └── build.yml           # CI workflow
```

## Model Specification

The model `expresat_gru_float32.onnx` expects:
- **Input**: `[1, 15, 178]` float32 tensor (15 frames x 178 features)
  - Pose upper (13 landmarks x 4 coords = 52)
  - Left hand (21 landmarks x 3 coords = 63)
  - Right hand (21 landmarks x 3 coords = 63)
  - Shoulder-relative normalization
- **Output**: `[1, 15]` logits (15 LSE sign language classes)
