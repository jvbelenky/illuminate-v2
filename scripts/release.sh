#!/usr/bin/env bash
#
# release.sh — cut a versioned release of illuminate-v2.
#
# The single source of truth for the app version is the repo-root VERSION file:
#   - the backend reads it (api/app/main.py:_read_version) and serves it at
#     /api/v1/version, which the UI shows in the status bar;
#   - the Dockerfile COPYs it; and
#   - scripts/deploy.sh tags the Docker image from it.
# (api/pyproject.toml and ui/package.json also carry version strings, but nothing
#  reads them at runtime — VERSION is canonical.)
#
# This script bumps VERSION *and* — the step that matters — promotes the
# CHANGELOG's [Unreleased] section into a dated release section, so the git tag
# and the changelog can never drift apart. v0.1.1–v0.1.3 were cut WITHOUT this
# step (via deploy.sh's auto-bump), which is why their entries had to be
# reconstructed from git history after the fact.
#
# Usage:
#   scripts/release.sh <major|minor|patch|X.Y.Z> [--dry-run] [--yes] [--no-push]
#   make release VERSION=minor
#   make release VERSION=minor RELEASE_FLAGS=--dry-run
#
#   --dry-run    Show exactly what would change; touch nothing.
#   -y, --yes    Push without the interactive confirmation.
#   --no-push    Create the commit + tag locally, but do not push.
#
# Intended flow:
#   1. Land changes on main (CI green). Keep CHANGELOG's [Unreleased] section
#      up to date as you go (a line per user-facing change, at commit time).
#   2. `make release VERSION=<bump>`  → bumps VERSION, dates the changelog
#      section, commits, tags, and (after you confirm) pushes.
#   3. `make deploy`  → builds and ships the tagged version. Because a tag now
#      exists on HEAD, deploy does NOT auto-bump.
#
set -euo pipefail

# Operate from the repo root regardless of where we were invoked from.
cd "$(git rev-parse --show-toplevel)" || {
    echo "Error: not inside a git repository." >&2
    exit 1
}

VERSION_FILE="VERSION"      # source of truth (backend serves it, Docker copies it)
CHANGELOG="CHANGELOG.md"
PKG_JSON="ui/package.json"  # kept in sync for consistency; nothing reads it at runtime
SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+$'

die() { echo "Error: $*" >&2; exit 1; }
warn() { echo "Warning: $*" >&2; }
# A blocked precondition is fatal for a real release, but in --dry-run we report
# it and keep going so the preview works from any branch / dirty tree.
require() { if [ "$dry_run" -eq 1 ]; then warn "$* (would block a real release)"; else die "$*"; fi; }

usage() {
    local current="${1:-?.?.?}"
    cat >&2 <<EOF
Usage: scripts/release.sh <major|minor|patch|X.Y.Z> [--dry-run] [--yes] [--no-push]

Current version: $current

  major   bump to the next major (X+1.0.0)
  minor   bump to the next minor (X.Y+1.0)
  patch   bump to the next patch (X.Y.Z+1)
  X.Y.Z   set an explicit version

  --dry-run    show what would change; touch nothing
  -y, --yes    push without the interactive confirmation
  --no-push    commit + tag locally, but do not push
EOF
}

# --- Parse arguments -------------------------------------------------------
bump=""
dry_run=0
assume_yes=0
no_push=0
for arg in "$@"; do
    case "$arg" in
        --dry-run)  dry_run=1 ;;
        -y|--yes)   assume_yes=1 ;;
        --no-push)  no_push=1 ;;
        -h|--help)  usage "$(tr -d '[:space:]' < "$VERSION_FILE" 2>/dev/null)"; exit 0 ;;
        -*)         die "Unknown option: $arg" ;;
        *)          [ -z "$bump" ] && bump="$arg" || die "Unexpected extra argument: $arg" ;;
    esac
done

# --- Read & validate the current version -----------------------------------
[ -f "$VERSION_FILE" ] || die "$VERSION_FILE not found."
current=$(tr -d '[:space:]' < "$VERSION_FILE")
[[ "$current" =~ $SEMVER_RE ]] || die "$VERSION_FILE is not X.Y.Z: '$current'"
IFS='.' read -r major minor patch <<< "$current"

# --- Determine the new version ---------------------------------------------
case "$bump" in
    major)    new_version="$((major + 1)).0.0" ;;
    minor)    new_version="$major.$((minor + 1)).0" ;;
    patch)    new_version="$major.$minor.$((patch + 1))" ;;
    v[0-9]*)  new_version="${bump#v}" ;;
    [0-9]*)   new_version="$bump" ;;
    "")       usage "$current"; exit 1 ;;
    *)        die "Unrecognized version spec: '$bump'" ;;
esac

# --- Validate the new version ----------------------------------------------
[[ "$new_version" =~ $SEMVER_RE ]] || die "Not a valid X.Y.Z version: '$new_version'"
[ "$new_version" != "$current" ]  || die "New version equals the current version ($current)."
greater=$(printf '%s\n%s\n' "$current" "$new_version" | sort -V | tail -1)
[ "$greater" = "$new_version" ]   || die "New version $new_version is not greater than current $current."

# --- Preflight: branch, clean tree, free tag, remote in sync ---------------
# In --dry-run these downgrade to warnings so you can preview from anywhere.
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || require "Must be on main (currently on '$branch')."

git diff --quiet && git diff --cached --quiet \
    || require "Working tree is dirty. Commit or stash first."

if git rev-parse -q --verify "refs/tags/v$new_version" >/dev/null; then
    require "Tag v$new_version already exists."
fi

echo "Fetching origin/main..."
if git fetch --quiet origin main 2>/dev/null; then
    local_head=$(git rev-parse @)
    remote_head=$(git rev-parse origin/main)
    base=$(git merge-base @ origin/main)
    if [ "$local_head" != "$remote_head" ]; then
        if   [ "$local_head" = "$base" ];  then require "Local main is BEHIND origin/main — pull first."
        elif [ "$remote_head" = "$base" ]; then require "Local main is AHEAD of origin/main — push (and let CI pass) first."
        else require "Local main has DIVERGED from origin/main — reconcile first."
        fi
    fi
else
    require "Could not fetch origin (offline?). Releases must be cut from an in-sync main."
fi

# --- Changelog: [Unreleased] must exist and carry content ------------------
grep -q '^## \[Unreleased\]' "$CHANGELOG" \
    || die "$CHANGELOG has no '## [Unreleased]' section."

unreleased=$(awk '
    /^## \[Unreleased\]/ { grab=1; next }
    /^## \[/            { grab=0 }
    grab && NF          { print }
' "$CHANGELOG")
[ -n "$unreleased" ] \
    || require "CHANGELOG [Unreleased] is empty. Add entries before releasing."

today=$(date +%Y-%m-%d)

# --- Preview ---------------------------------------------------------------
echo
echo "  Release:  v$current  ->  v$new_version   ($today)"
if [ -n "$unreleased" ]; then
    echo "  The following [Unreleased] entries will be dated as [$new_version]:"
    echo
    echo "$unreleased" | sed 's/^/      /'
else
    echo "  (no [Unreleased] entries)"
fi
echo

if [ "$dry_run" -eq 1 ]; then
    echo "Dry run — no files changed, nothing committed."
    exit 0
fi

# Undo working-tree edits if anything fails before the commit lands.
trap 'git checkout -- "$VERSION_FILE" "$CHANGELOG" "$PKG_JSON" 2>/dev/null || true' ERR

# --- Apply -----------------------------------------------------------------
echo "$new_version" > "$VERSION_FILE"

# Sync the UI package version (safe: pnpm-lock does not record the root version).
# api/pyproject.toml is intentionally NOT synced — its version is pinned in
# api/uv.lock, so bumping it would force a lockfile regeneration every release.
sed -i "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$new_version\"/" "$PKG_JSON"

# Insert the dated header right after [Unreleased], leaving [Unreleased] in
# place (now empty) for the next cycle. awk edits only the first match.
awk -v ver="$new_version" -v date="$today" '
    !done && /^## \[Unreleased\]/ {
        print
        print ""
        print "## [" ver "] - " date
        done = 1
        next
    }
    { print }
' "$CHANGELOG" > "$CHANGELOG.tmp" && mv "$CHANGELOG.tmp" "$CHANGELOG"

git add "$VERSION_FILE" "$CHANGELOG" "$PKG_JSON"
git commit -m "Release v$new_version"
git tag -a "v$new_version" -m "Release v$new_version"
trap - ERR   # commit + tag now exist locally and are recoverable; stop auto-rollback.

echo
echo "Committed and tagged v$new_version locally."

# --- Push: the one outbound, hard-to-undo step -----------------------------
do_push() {
    git push origin main
    git push origin "v$new_version"
    echo
    echo "Pushed v$new_version. Deploy with: make deploy"
}

manual_hint() {
    echo "    git push origin main && git push origin v$new_version"
}

if [ "$no_push" -eq 1 ]; then
    echo
    echo "Not pushing (--no-push). When ready:"; manual_hint
elif [ "$assume_yes" -eq 1 ]; then
    do_push
elif [ -t 0 ]; then
    read -r -p "Push main and tag v$new_version to origin? [y/N] " reply
    case "$reply" in
        [yY]|[yY][eE][sS]) do_push ;;
        *) echo "Not pushed. Local commit + tag remain — push when ready:"; manual_hint ;;
    esac
else
    echo
    echo "Non-interactive shell; not pushing. Re-run with --yes, or push manually:"; manual_hint
fi
