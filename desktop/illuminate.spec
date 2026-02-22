# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for Illuminate Desktop.

Build:
    cd desktop
    pyinstaller illuminate.spec --noconfirm

Output: dist/illuminate/  (one-dir mode)
"""

import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Paths
DESKTOP_DIR = os.path.dirname(os.path.abspath(SPECPATH))
ROOT_DIR = os.path.dirname(DESKTOP_DIR)
API_DIR = os.path.join(ROOT_DIR, "api")
UI_BUILD_DIR = os.path.join(ROOT_DIR, "ui", "build")

# --- Hidden imports ---
# uvicorn needs its event loop and protocol implementations
hiddenimports = [
    # uvicorn internals
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    # API modules
    "app.main",
    "app.logging_config",
    "api",
    "api.v1",
    "api.v1.utility_routers",
    "api.v1.lamp_routers",
    "api.v1.session_routers",
    "api.v1.efficacy_routers",
    "api.v1.schemas",
    "api.v1.defaults",
    "api.v1.resource_limits",
    "api.v1.session_manager",
    "api.v1.utils",
    "api.v1.utils.plotting",
    # scipy / numpy (used by guv_calcs)
    "scipy.spatial",
    "scipy.spatial._qhull",
    "scipy.spatial.transform",
    # matplotlib backends
    "matplotlib",
    "matplotlib.backends",
    "matplotlib.backends.backend_agg",
    # multipart (for file uploads)
    "multipart",
]

# Also collect all guv_calcs submodules dynamically
hiddenimports += collect_submodules("guv_calcs")

# --- Data files ---
datas = []

# Built frontend -> 'frontend/' in the bundle
if os.path.isdir(UI_BUILD_DIR):
    datas.append((UI_BUILD_DIR, "frontend"))

# guv_calcs ships lamp data, spectra, etc.
datas += collect_data_files("guv_calcs")

# --- Analysis ---
a = Analysis(
    [os.path.join(DESKTOP_DIR, "main.py")],
    pathex=[API_DIR],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Reduce bundle size — not needed for this app
        "tkinter",
        "test",
        "xmlrpc",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="illuminate",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    # Set console=True for debug builds, False for release
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="illuminate",
)
