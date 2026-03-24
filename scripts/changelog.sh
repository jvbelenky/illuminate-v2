#!/bin/bash
# Generate changelog entries from conventional commits since the last tag.
#
# Usage:
#   scripts/changelog.sh          # commits since last tag
#   scripts/changelog.sh v0.1.0   # commits since a specific tag
#
# Conventional commit prefixes → Keep a Changelog categories:
#   feat:      → Added
#   fix:       → Fixed
#   refactor:  → Changed
#   perf:      → Changed
#   docs:      → Changed
#   remove:    → Removed
#   deprecate: → Deprecated
#   security:  → Security
#   (other)    → Uncategorized
#
# Paste the output into CHANGELOG.md under [Unreleased].

set -euo pipefail

SINCE="${1:-$(git describe --tags --abbrev=0 2>/dev/null || echo "")}"

if [ -z "$SINCE" ]; then
    echo "No tags found. Showing all commits." >&2
    RANGE="HEAD"
else
    echo "Commits since ${SINCE}:" >&2
    RANGE="${SINCE}..HEAD"
fi

# Collect commits: hash + subject
commits=$(git log --oneline --no-merges "$RANGE" 2>/dev/null || git log --oneline --no-merges)

if [ -z "$commits" ]; then
    echo "No commits found." >&2
    exit 0
fi

added=""
changed=""
fixed=""
removed=""
deprecated=""
security=""
other=""

while IFS= read -r line; do
    # Strip the short hash
    msg="${line#* }"

    # Extract prefix (everything before the first colon)
    if [[ "$msg" =~ ^([a-zA-Z]+)\:\ (.+)$ ]]; then
        prefix="${BASH_REMATCH[1]}"
        body="${BASH_REMATCH[2]}"
    else
        prefix=""
        body="$msg"
    fi

    entry="- ${body}"

    case "$prefix" in
        feat|add)       added+="${entry}"$'\n' ;;
        fix)            fixed+="${entry}"$'\n' ;;
        refactor|perf|docs|style|change)
                        changed+="${entry}"$'\n' ;;
        remove)         removed+="${entry}"$'\n' ;;
        deprecate)      deprecated+="${entry}"$'\n' ;;
        security)       security+="${entry}"$'\n' ;;
        # Common prefixes that aren't changelog-worthy
        test|ci|chore|build)
                        ;; # skip
        *)              other+="${entry}"$'\n' ;;
    esac
done <<< "$commits"

# Print sections that have entries
print_section() {
    local title="$1"
    local entries="$2"
    if [ -n "$entries" ]; then
        echo "### ${title}"
        echo "$entries"
    fi
}

print_section "Added" "$added"
print_section "Changed" "$changed"
print_section "Fixed" "$fixed"
print_section "Removed" "$removed"
print_section "Deprecated" "$deprecated"
print_section "Security" "$security"
print_section "Uncategorized" "$other"
