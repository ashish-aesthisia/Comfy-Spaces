#!/bin/bash

mkdir -p data/revisions

if [ ! -d data/nodes ]; then
  mkdir -p data/nodes
fi

if [ ! -d data/revisions/v1 ]; then
  mkdir -p data/revisions/v1
fi

if [ ! -d data/revisions/v1/venv ]; then
    python3 -m venv data/revisions/v1/venv
fi

cp ComfyUI/requirements.txt data/revisions/v1/requirements.txt
touch data/revisions/v1/nodes_status.json

if [ ! -f data/revisions/selected_version.txt ]; then
  echo "v1" > data/revisions/selected_version.txt
fi