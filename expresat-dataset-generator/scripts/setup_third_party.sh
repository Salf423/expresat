#!/usr/bin/env bash
# setup_third_party.sh — Fetch vendored dependencies for expresat-dataset-generator
# Usage: bash scripts/setup_third_party.sh
#
# Downloads:
#   - Dear ImGui v1.91 (docking branch)
#   - GLAD (OpenGL 3.3 Core, no extensions)
#   - nlohmann/json v3.11.3 (single header)
#
# All deps land in ./third_party/ and are gitignored by default.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
TP="$ROOT/third_party"

mkdir -p "$TP"
cd "$TP"

# ─── Dear ImGui ───────────────────────────────────────────────────────────────
IMGUI_VERSION="v1.91.1"
IMGUI_DIR="$TP/imgui"

if [ ! -d "$IMGUI_DIR/.git" ]; then
    echo "[setup] Cloning Dear ImGui $IMGUI_VERSION..."
    git clone --depth 1 --branch "$IMGUI_VERSION" \
        https://github.com/ocornut/imgui.git "$IMGUI_DIR"
else
    echo "[setup] Dear ImGui already present, skipping."
fi

# ─── GLAD ─────────────────────────────────────────────────────────────────────
# Pre-generated for OpenGL 3.3 Core Profile (no extensions needed).
GLAD_DIR="$TP/glad"

if [ ! -f "$GLAD_DIR/src/glad.c" ]; then
    echo "[setup] Downloading GLAD (OpenGL 3.3 Core)..."
    mkdir -p "$GLAD_DIR/include/glad" "$GLAD_DIR/include/KHR" "$GLAD_DIR/src"

    # Use the GLAD REST API to generate on-the-fly
    GLAD_ARCHIVE="$TP/glad.zip"
    curl -sL \
        "https://glad.dav1d.de/generated/tmpv0wXWBglad/glad.zip" \
        -o "$GLAD_ARCHIVE" || \
    # Fallback: direct download from a known-good generated snapshot
    curl -sL \
        "https://github.com/Dav1dde/glad/releases/download/v0.1.36/glad_opengl_3.3_core_profile.zip" \
        -o "$GLAD_ARCHIVE" 2>/dev/null || \
    (echo "[setup] GLAD download failed — you can generate manually at https://glad.dav1d.de/"; true)

    if [ -f "$GLAD_ARCHIVE" ]; then
        unzip -q -o "$GLAD_ARCHIVE" -d "$GLAD_DIR"
        rm "$GLAD_ARCHIVE"
        echo "[setup] GLAD extracted."
    fi
else
    echo "[setup] GLAD already present, skipping."
fi

# ─── nlohmann/json (single header) ───────────────────────────────────────────
JSON_DIR="$TP/json/include/nlohmann"
JSON_HEADER="$JSON_DIR/json.hpp"

if [ ! -f "$JSON_HEADER" ]; then
    echo "[setup] Downloading nlohmann/json v3.11.3..."
    mkdir -p "$JSON_DIR"
    curl -sL \
        "https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp" \
        -o "$JSON_HEADER"
    echo "[setup] nlohmann/json downloaded."
else
    echo "[setup] nlohmann/json already present, skipping."
fi

echo ""
echo "✓ Third-party setup complete."
echo "  CMake will use vendored copies; FetchContent is a fallback."
