#!/usr/bin/env bash
# build.sh — Configure and build expresat-dataset-generator
# Usage:
#   bash scripts/build.sh              # Debug build, stub extractor
#   bash scripts/build.sh release      # Release build
#   bash scripts/build.sh mediapipe    # Release + real MediaPipe

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

MODE="${1:-debug}"
BUILD_DIR="$ROOT/build_${MODE}"
JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

CMAKE_ARGS=(
    "-DCMAKE_BUILD_TYPE=Release"
    "-DUSE_STUB_EXTRACTOR=ON"
    "-DUSE_MEDIAPIPE=OFF"
)

case "$MODE" in
    debug)
        CMAKE_ARGS[0]="-DCMAKE_BUILD_TYPE=Debug"
        ;;
    release)
        CMAKE_ARGS[0]="-DCMAKE_BUILD_TYPE=Release"
        ;;
    mediapipe)
        CMAKE_ARGS[0]="-DCMAKE_BUILD_TYPE=Release"
        CMAKE_ARGS[1]="-DUSE_STUB_EXTRACTOR=OFF"
        CMAKE_ARGS[2]="-DUSE_MEDIAPIPE=ON"
        if [ -z "${MEDIAPIPE_ROOT:-}" ]; then
            echo "[build] ERROR: MEDIAPIPE_ROOT env var must be set for MediaPipe mode."
            exit 1
        fi
        ;;
    *)
        echo "Usage: $0 [debug|release|mediapipe]"
        exit 1
        ;;
esac

echo "[build] Mode: $MODE | Jobs: $JOBS | Dir: $BUILD_DIR"
echo "[build] CMake args: ${CMAKE_ARGS[*]}"

mkdir -p "$BUILD_DIR"
cmake -S "$ROOT" -B "$BUILD_DIR" "${CMAKE_ARGS[@]}"
cmake --build "$BUILD_DIR" --parallel "$JOBS"

BINARY="$BUILD_DIR/expresat_dataset_generator"
if [ -f "$BINARY" ]; then
    echo ""
    echo "✓ Build succeeded: $BINARY"
    echo "  Run: $BINARY"
else
    echo "✗ Build failed — binary not found."
    exit 1
fi
