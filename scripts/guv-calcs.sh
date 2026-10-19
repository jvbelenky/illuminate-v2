#!/usr/bin/env bash
# The API pins guv-calcs to a git commit in api/pyproject.toml; CI, Docker and
# production use exactly that commit. In dev, a local guv-calcs checkout is put
# on PYTHONPATH ahead of the pinned install, so edits there are live without
# touching api/uv.lock.
#
# Which checkout (first match):
#   GUV_CALCS_DIR=<path>     that checkout
#   GUV_CALCS_DIR=pinned     none: run against the pinned commit, as CI does
#   in an illuminate worktree named <name>, guv-calcs/.claude/worktrees/<name>
#   otherwise the guv-calcs checkout next to the main illuminate checkout
#
# Usage:
#   scripts/guv-calcs.sh status        pinned commit vs the local checkout
#   scripts/guv-calcs.sh exec CMD...   run CMD with the local checkout on PYTHONPATH
#   scripts/guv-calcs.sh pythonpath    print the overlay path (empty if none)
#   scripts/guv-calcs.sh bump [REF]    pin REF (default: local HEAD) and relock
set -euo pipefail

REPO_URL="https://github.com/jvbelenky/guv-calcs"
repo_root=$(git rev-parse --show-toplevel)
main_root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
pyproject="$repo_root/api/pyproject.toml"

die() { echo "Error: $*" >&2; exit 1; }

local_dir() {
  if [ -n "${GUV_CALCS_DIR:-}" ]; then
    [ "$GUV_CALCS_DIR" = pinned ] && return 0
    [ -d "$GUV_CALCS_DIR/src/guv_calcs" ] || die "GUV_CALCS_DIR=$GUV_CALCS_DIR has no src/guv_calcs"
    (cd "$GUV_CALCS_DIR" && pwd)
    return 0
  fi
  local sibling paired
  sibling="$(dirname "$main_root")/guv-calcs"
  if [ "$repo_root" != "$main_root" ]; then
    paired="$sibling/.claude/worktrees/$(basename "$repo_root")"
    if [ -d "$paired/src/guv_calcs" ]; then echo "$paired"; return 0; fi
  fi
  if [ -d "$sibling/src/guv_calcs" ]; then echo "$sibling"; fi
}

pinned_sha() {
  grep -oP "guv-calcs @ git\+\Q$REPO_URL\E@\K[0-9a-f]{40}" "$pyproject" \
    || die "no guv-calcs git pin found in $pyproject"
}

cmd_status() {
  local pin dir head
  pin=$(pinned_sha)
  echo "guv-calcs pinned: ${pin:0:7}"
  dir=$(local_dir)
  if [ -z "$dir" ]; then
    echo "guv-calcs in use: pinned commit (no local overlay)"
    return 0
  fi
  head=$(git -C "$dir" rev-parse HEAD)
  echo "guv-calcs in use: $dir ($(git -C "$dir" rev-parse --abbrev-ref HEAD) @ ${head:0:7})"
  if [ "$head" != "$pin" ]; then
    if git -C "$dir" merge-base --is-ancestor "$pin" "$head" 2>/dev/null; then
      echo "  $(git -C "$dir" rev-list --count "$pin..$head") commit(s) ahead of the pin; 'make bump-guv-calcs' to ship them"
    else
      echo "  local HEAD has diverged from the pin (or the pin isn't fetched)"
    fi
  fi
  if [ -n "$(git -C "$dir" status --porcelain --untracked-files=no)" ]; then
    echo "  uncommitted changes in the local checkout"
  fi
}

cmd_exec() {
  local dir
  dir=$(local_dir)
  if [ -n "$dir" ]; then
    export PYTHONPATH="$dir/src${PYTHONPATH:+:$PYTHONPATH}"
  fi
  exec "$@"
}

cmd_bump() {
  local dir ref sha old
  dir=$(local_dir)
  [ -n "$dir" ] || die "no local guv-calcs checkout (set GUV_CALCS_DIR)"
  ref=${1:-HEAD}
  sha=$(git -C "$dir" rev-parse --verify "$ref^{commit}") || die "unknown ref $ref in $dir"
  old=$(pinned_sha)
  [ "$sha" != "$old" ] || { echo "Already pinned to ${sha:0:7}"; return 0; }

  [ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ] \
    || echo "Warning: $dir has uncommitted changes; they are NOT part of ${sha:0:7}" >&2
  # CI and Docker fetch the pin from GitHub, so it must be pushed
  git -C "$dir" fetch -q origin
  [ -n "$(git -C "$dir" branch -r --contains "$sha")" ] \
    || die "${sha:0:7} is not on origin yet; push guv-calcs first"

  sed -i "s|guv-calcs @ git+$REPO_URL@$old|guv-calcs @ git+$REPO_URL@$sha|" "$pyproject"
  (cd "$repo_root/api" && uv lock)
  echo ""
  echo "Pinned guv-calcs ${old:0:7} -> ${sha:0:7}:"
  git -C "$dir" log --oneline "$old..$sha" 2>/dev/null || true
}

case "${1:-}" in
  status) cmd_status ;;
  exec) shift; [ $# -gt 0 ] || die "exec needs a command"; cmd_exec "$@" ;;
  pythonpath) dir=$(local_dir); [ -z "$dir" ] || echo "$dir/src" ;;
  bump) shift; cmd_bump "$@" ;;
  *) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
