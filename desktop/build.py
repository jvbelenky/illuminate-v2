"""
Build orchestration for Illuminate Desktop.

Usage:
    python build.py                  # Full build (frontend + PyInstaller + installer)
    python build.py --skip-frontend  # Skip frontend build (use existing ui/build/)
    python build.py --skip-installer # Skip Inno Setup installer
"""

import argparse
import os
import subprocess
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI_DIR = os.path.join(ROOT_DIR, "ui")
DESKTOP_DIR = os.path.join(ROOT_DIR, "desktop")


def run(cmd: list[str], cwd: str | None = None, env: dict | None = None):
    """Run a command, streaming output. Exit on failure."""
    merged_env = {**os.environ, **(env or {})}
    print(f"\n{'='*60}")
    print(f"  {' '.join(cmd)}")
    print(f"  cwd: {cwd or os.getcwd()}")
    print(f"{'='*60}\n")
    result = subprocess.run(cmd, cwd=cwd, env=merged_env)
    if result.returncode != 0:
        print(f"\nERROR: Command failed with exit code {result.returncode}")
        sys.exit(result.returncode)


def build_frontend():
    """Build the SvelteKit frontend for desktop (static adapter + relative API URLs)."""
    print("\n>>> Building frontend for desktop...")

    # Verify node_modules exist
    if not os.path.isdir(os.path.join(UI_DIR, "node_modules")):
        run(["pnpm", "install"], cwd=UI_DIR)

    run(["pnpm", "build:desktop"], cwd=UI_DIR)

    # Verify output
    index = os.path.join(UI_DIR, "build", "index.html")
    if not os.path.isfile(index):
        print(f"ERROR: Expected {index} but it doesn't exist.")
        sys.exit(1)
    print(f"Frontend built successfully: {index}")


def build_pyinstaller():
    """Bundle with PyInstaller using the spec file."""
    print("\n>>> Running PyInstaller...")
    run(
        [sys.executable, "-m", "PyInstaller", "illuminate.spec", "--noconfirm"],
        cwd=DESKTOP_DIR,
    )

    exe_name = "illuminate.exe" if sys.platform == "win32" else "illuminate"
    exe_path = os.path.join(DESKTOP_DIR, "dist", "illuminate", exe_name)
    if not os.path.isfile(exe_path):
        print(f"ERROR: Expected {exe_path} but it doesn't exist.")
        sys.exit(1)
    print(f"PyInstaller bundle created: {exe_path}")


def build_installer():
    """Create Windows installer via Inno Setup."""
    if sys.platform != "win32":
        print("Skipping Inno Setup (not on Windows)")
        return

    iss_file = os.path.join(DESKTOP_DIR, "installer.iss")
    if not os.path.isfile(iss_file):
        print(f"Skipping installer: {iss_file} not found")
        return

    # Try common Inno Setup locations
    iscc_paths = [
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
    ]
    iscc = None
    for path in iscc_paths:
        if os.path.isfile(path):
            iscc = path
            break

    if not iscc:
        print("Skipping installer: Inno Setup (ISCC.exe) not found")
        return

    print("\n>>> Creating installer with Inno Setup...")
    run([iscc, iss_file], cwd=DESKTOP_DIR)
    print("Installer created in desktop/output/")


def main():
    parser = argparse.ArgumentParser(description="Build Illuminate Desktop")
    parser.add_argument("--skip-frontend", action="store_true", help="Skip frontend build")
    parser.add_argument("--skip-installer", action="store_true", help="Skip Inno Setup")
    args = parser.parse_args()

    if not args.skip_frontend:
        build_frontend()

    build_pyinstaller()

    if not args.skip_installer:
        build_installer()

    print("\n>>> Build complete!")


if __name__ == "__main__":
    main()
