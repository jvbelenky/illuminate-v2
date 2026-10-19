#!/usr/bin/env bash
# Dev/e2e ports for this checkout, so worktrees can run side by side.
# The main checkout uses 8000 (API) and 5173 (UI); a worktree gets a fixed
# offset derived from its name. API_PORT / UI_PORT in the environment win.
#
# Usage: scripts/dev-ports.sh api|ui
set -euo pipefail

repo_root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
main_root=$(dirname "$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir)")

offset=0
if [ "$repo_root" != "$main_root" ]; then
  offset=$(( 1 + $(basename "$repo_root" | cksum | cut -d' ' -f1) % 500 ))
fi

case "${1:-}" in
  api) echo "${API_PORT:-$((8000 + offset))}" ;;
  ui) echo "${UI_PORT:-$((5173 + offset))}" ;;
  *) echo "Usage: $0 api|ui" >&2; exit 1 ;;
esac
