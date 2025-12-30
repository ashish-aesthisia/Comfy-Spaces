#!/bin/bash

mkdir -p spaces

if [ ! -d data/nodes ]; then
  mkdir -p data/nodes
fi

if [ ! -d spaces/v1 ]; then
  mkdir -p spaces/v1
fi

# Create ComfyUI directory in space
if [ ! -d spaces/v1/ComfyUI ]; then
  cp -r ComfyUI spaces/v1/ComfyUI
fi

# Create nodes directory in space
if [ ! -d spaces/v1/nodes ]; then
  mkdir -p spaces/v1/nodes
fi

# Create venv in space
if [ ! -d spaces/v1/venv ]; then
    python3 -m venv spaces/v1/venv
fi

# Create space.json with initial structure
if [ ! -f spaces/v1/space.json ]; then
  cat > spaces/v1/space.json << EOF
{
  "nodes": [],
  "dependencies": []
}
EOF
fi

# Create log files
touch spaces/v1/logs.txt
touch spaces/v1/comfy-logs.txt

if [ ! -f spaces/selected_version.txt ]; then
  echo "v1" > spaces/selected_version.txt
fi
