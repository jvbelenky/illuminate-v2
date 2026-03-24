# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Conventional Commits](https://www.conventionalcommits.org/) —
run `scripts/changelog.sh` to generate entries from git history.

## [Unreleased]

### Added
- Point-and-click position and aim point picking for lamps (matches calcpoint interface)

### Fixed
- Point-and-click placement/aiming no longer opens scene objects underneath the click target
- CalcPoint3D marker uses sqrt-based scaling instead of linear, preventing oversized markers in large rooms
- Add missing `aim_x`/`aim_y`/`aim_z` fields to `SessionZoneState` and `LoadedZone` backend schemas

## [0.1.0] - 2026-03-24

Initial versioned release. Retroactive summary of features present at tagging.

### Added
- Room geometry editor with 2D polygon drawing
- Lamp placement with corner, edge, horizontal, and downlight modes
- Mass lamp operations: batch placement, aiming, and height adjustment
- Calculation volume (CalcVol) 3D visualization with isosurface rendering
- Zone statistics panel with fluence rate plots
- Session persistence via sessionStorage with auto-recovery
- Docker single-image production build
- Security headers middleware (CSP, X-Frame-Options, etc.)

### Dependencies
- guv_calcs == 0.6.5
