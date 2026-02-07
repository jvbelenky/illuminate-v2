#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "=== Pulling latest code ==="
git pull --rebase

echo "=== Building frontend ==="
cd ui
BASE_PATH=/v2 VITE_API_URL=/v2/api/v1 pnpm build
cd ..

echo "=== Building backend Docker image ==="
docker build -t illuminate-v2-api -f api/Dockerfile api/

echo "=== Restarting backend container ==="
docker stop illuminate-v2-api || true
docker rm illuminate-v2-api || true
docker run --name illuminate-v2-api --detach \
  -p 127.0.0.1:8000:8000 \
  -e CORS_ORIGINS=https://illuminate.osluv.org \
  --restart=unless-stopped \
  illuminate-v2-api

echo "=== Deploying frontend static files ==="
sudo mkdir -p /var/www/illuminate-v2
sudo rsync -a --delete ui/build/ /var/www/illuminate-v2/

echo "=== Done ==="
echo "Backend: docker logs illuminate-v2-api"
echo "Frontend: /var/www/illuminate-v2/"
echo "URL: https://illuminate.osluv.org/v2/"
