#!/bin/bash
set -e
cd "$(dirname "$0")"

CONTAINER_NAME="illuminate-v2"
IMAGE_NAME="illuminate-v2"
KEEP_IMAGES=20

# --- Determine action ---
action="${1:-deploy}"

case "$action" in
  deploy)
    # Preflight checks
    git diff --quiet && git diff --cached --quiet \
        || { echo "Error: Working tree is dirty. Commit or stash changes first."; exit 1; }
    [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] \
        || { echo "Error: Must be on main branch (currently on $(git rev-parse --abbrev-ref HEAD))."; exit 1; }

    echo "=== Pulling latest code ==="
    git pull --rebase

    # Auto-bump patch version if HEAD doesn't already have a version tag
    if ! git tag --points-at HEAD | grep -q '^v'; then
      VERSION=$(cat VERSION)
      IFS='.' read -r major minor patch <<< "$VERSION"
      NEW_VERSION="$major.$minor.$((patch + 1))"
      echo "=== Auto-bumping version: v${VERSION} -> v${NEW_VERSION} ==="
      echo "$NEW_VERSION" > VERSION
      git add VERSION
      git commit -m "Release v${NEW_VERSION}"
      git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
      git push origin main
      git push origin "v${NEW_VERSION}"
    fi

    VERSION=$(cat VERSION)
    echo "=== Deploying ${IMAGE_NAME} v${VERSION} ==="

    echo "=== Building Docker image ==="
    docker build -t "${IMAGE_NAME}:v${VERSION}" -t "${IMAGE_NAME}:latest" .

    echo "=== Restarting container ==="
    docker stop "${CONTAINER_NAME}" || true
    docker rm "${CONTAINER_NAME}" || true
    docker run --name "${CONTAINER_NAME}" --detach \
      -p 127.0.0.1:8000:8000 \
      -e CORS_ORIGINS=https://illuminate.osluv.org \
      --restart=unless-stopped \
      "${IMAGE_NAME}:v${VERSION}"

    echo "=== Cleaning up old images (keeping last ${KEEP_IMAGES}) ==="
    # List version-tagged images oldest first, skip the most recent ones, remove the rest
    docker images "${IMAGE_NAME}" --format '{{.Tag}} {{.ID}}' \
      | grep '^v' \
      | sort -V \
      | head -n -"${KEEP_IMAGES}" \
      | awk '{print $2}' \
      | xargs -r docker rmi 2>/dev/null || true
    # Clean up any dangling images
    docker image prune -f

    echo ""
    echo "=== Done ==="
    echo "Deployed: ${IMAGE_NAME} v${VERSION}"
    echo "Logs:     docker logs ${CONTAINER_NAME}"
    echo "URL:      https://illuminate.osluv.org/"
    echo "Rollback: bash deploy.sh rollback <version>"
    ;;

  rollback)
    target="${2:-}"
    if [ -z "$target" ]; then
      echo "Usage: bash deploy.sh rollback <version>"
      echo ""
      echo "Available versions:"
      docker images "${IMAGE_NAME}" --format '  {{.Tag}}  ({{.CreatedSince}})' \
        | grep '^  v' \
        | sort -Vr
      exit 1
    fi

    # Normalize: accept both "0.1.0" and "v0.1.0"
    target="v${target#v}"

    # Verify image exists
    if ! docker image inspect "${IMAGE_NAME}:${target}" &>/dev/null; then
      echo "Error: No image found for ${IMAGE_NAME}:${target}"
      echo ""
      echo "Available versions:"
      docker images "${IMAGE_NAME}" --format '  {{.Tag}}  ({{.CreatedSince}})' \
        | grep '^  v' \
        | sort -Vr
      exit 1
    fi

    echo "=== Rolling back to ${IMAGE_NAME}:${target} ==="
    docker stop "${CONTAINER_NAME}" || true
    docker rm "${CONTAINER_NAME}" || true
    docker run --name "${CONTAINER_NAME}" --detach \
      -p 127.0.0.1:8000:8000 \
      -e CORS_ORIGINS=https://illuminate.osluv.org \
      --restart=unless-stopped \
      "${IMAGE_NAME}:${target}"

    echo ""
    echo "=== Done ==="
    echo "Rolled back to: ${IMAGE_NAME}:${target}"
    echo "Logs: docker logs ${CONTAINER_NAME}"
    ;;

  versions)
    echo "Available versions:"
    docker images "${IMAGE_NAME}" --format '  {{.Tag}}  ({{.Size}}, {{.CreatedSince}})' \
      | grep '^  v' \
      | sort -Vr
    ;;

  *)
    echo "Usage: bash deploy.sh [deploy|rollback <version>|versions]"
    echo ""
    echo "Commands:"
    echo "  deploy              Build and deploy the current version (default)"
    echo "  rollback <version>  Revert to a previously deployed version"
    echo "  versions            List available versions"
    exit 1
    ;;
esac
