# Stage 1: Build frontend
FROM node:22-slim AS frontend
WORKDIR /build
RUN corepack enable
COPY ui/package.json ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY ui/ ./
ARG BASE_PATH=/v2
ARG VITE_API_URL=/v2/api/v1
RUN BASE_PATH=${BASE_PATH} VITE_API_URL=${VITE_API_URL} pnpm build

# Stage 2: Runtime
FROM python:3.12-slim
WORKDIR /app
COPY api/requirements.txt .
# Note: build-essential is not needed — scipy/numpy/matplotlib ship prebuilt wheels.
# If pip install fails with compilation errors, restore:
#   RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ .
COPY --from=frontend /build/build /app/frontend
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser
# Pre-warm matplotlib font cache so first plot request isn't slow
RUN python -c "import matplotlib.pyplot as plt; plt.figure(); plt.close()"
ENV STATIC_DIR=/app/frontend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')"
# Single worker required: in-memory session manager does not support multi-worker
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
