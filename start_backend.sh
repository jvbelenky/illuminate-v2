#!/bin/bash

# Activate conda environment
source ~/miniconda3/etc/profile.d/conda.sh
conda activate guv

# Start the backend
cd "$(dirname "$0")/api"
uvicorn app.main:app --reload --port 8000
