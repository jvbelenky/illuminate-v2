# Claude Code Notes

Notes for Claude when working on this project.

## Workflow

- **Commit frequently**: After completing each logical batch of changes (e.g., a feature, a refactor phase, a bug fix), commit the changes before moving on. Don't accumulate large uncommitted changesets.

## Project Context

This project is a rewrite/port of the original Illuminate frontend located at /mnt/c/data/business/work/uvc/repos/illuminate. The backend relies heavily on the **guv_calcs** library (located at /mnt/c/data/business/work/uvc/repos/guv-calcs), which is quite opinionated about how UV calculations work (room geometry, lamp positioning, calculation zones, safety standards, etc.). When making changes, be aware that many design decisions stem from guv_calcs conventions rather than arbitrary choices.

## Pre-Release Checklist

### localStorage Persistence
The localStorage auto-save/restore functionality in `ui/src/lib/stores/project.ts` is **intentionally disabled** during development/testing. Before release:

1. In `loadFromStorage()`: Uncomment the localStorage restore logic
2. In `saveToStorage()`: Uncomment the localStorage save logic

Look for `/* DISABLED FOR TESTING - restore before release:` comments.

This allows projects to persist across browser sessions.
