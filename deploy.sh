#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "=== Pulling latest code ==="
git pull --rebase

echo "=== Building Docker image ==="
docker build -t illuminate-v2 .

echo "=== Restarting container ==="
docker stop illuminate-v2 || true
docker rm illuminate-v2 || true
docker run --name illuminate-v2 --detach \
  -p 127.0.0.1:8000:8000 \
  -e CORS_ORIGINS=https://illuminate.osluv.org \
  --restart=unless-stopped \
  illuminate-v2

echo "=== Cleaning up old images ==="
docker image prune -f

echo "=== Done ==="
echo "Logs: docker logs illuminate-v2"
echo "URL:  https://illuminate.osluv.org/v2/"
