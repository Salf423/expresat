#!/bin/bash
set -e

# Change directory to where this script is located
cd "$(dirname "$0")"

echo "=== Expresat Native Docker Runner ==="

# Check for xhost and allow local connections to the X server
if command -v xhost &> /dev/null; then
    echo "[Info] Giving local docker containers access to the X11 server..."
    xhost +local:docker || xhost +local:root || true
else
    echo "[Warning] 'xhost' not found. GUI might fail to open if X11 permissions are strict."
fi

# Run docker-compose
echo "[Info] Building and running the docker container..."
docker compose up --build

# Revoke X11 access for security after exiting
if command -v xhost &> /dev/null; then
    echo "[Info] Revoking X11 server access..."
    xhost -local:docker || xhost -local:root || true
fi

echo "=== Done ==="
