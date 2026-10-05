# Stage 1: Build frontend
FROM node:22-slim AS frontend
WORKDIR /build
# Pin pnpm: bare `corepack enable` pulls the latest pnpm (currently 11), which no
# longer reads pnpm.onlyBuiltDependencies from package.json and makes ignored
# build scripts (esbuild) a fatal error. Pin to the version the config targets.
RUN npm install -g pnpm@10.32.1
COPY ui/package.json ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY ui/ ./
ARG BASE_PATH=
ARG VITE_API_URL=/api/v1
RUN BASE_PATH=${BASE_PATH} VITE_API_URL=${VITE_API_URL} pnpm build

# Stage 2: Runtime
FROM python:3.12-slim
WORKDIR /app
# WeasyPrint (PDF report) needs Pango + HarfBuzz; fontconfig for the bundled fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 fontconfig \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
COPY api/pyproject.toml api/uv.lock ./
RUN uv lock --no-sources && uv sync --no-sources --no-dev --no-editable
COPY VERSION .
# Test deployments pass e.g. "-test.abc1234" so the status bar shows which
# deployment a tester is on. Empty (the default) leaves VERSION untouched.
ARG VERSION_SUFFIX=
RUN if [ -n "${VERSION_SUFFIX}" ]; then printf '%s%s\n' "$(tr -d '\n' < VERSION)" "${VERSION_SUFFIX}" > VERSION; fi
COPY api/ .
COPY --from=frontend /build/build /app/frontend
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser
# Pre-warm matplotlib font cache so first plot request isn't slow
RUN uv run --no-sources python -c "import matplotlib.pyplot as plt; plt.figure(); plt.close()"
# Fail the build if WeasyPrint cannot render (missing system libraries)
RUN uv run --no-sources python -c "from weasyprint import HTML; assert HTML(string='<p>ok</p>').write_pdf()[:4] == b'%PDF'"
ENV STATIC_DIR=/app/frontend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')"
# Single worker required: in-memory session manager does not support multi-worker
CMD ["uv", "run", "--no-sources", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
