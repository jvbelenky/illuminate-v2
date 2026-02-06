"""
Illuminate Desktop — launches the FastAPI backend in a background thread
and opens a pywebview window pointing at it.

Usage (dev):
    cd ui && pnpm build:desktop
    cd desktop && python main.py

The web version is unaffected — this file is only used for desktop builds.
"""

import os
import sys
import socket
import threading
import time
import logging

import uvicorn
import webview

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Port selection
# ---------------------------------------------------------------------------

PORT_RANGE_START = 8000
PORT_RANGE_END = 8020


def find_free_port() -> int:
    """Return the first available port in the range, or raise RuntimeError."""
    for port in range(PORT_RANGE_START, PORT_RANGE_END + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(
        f"No free port found in range {PORT_RANGE_START}-{PORT_RANGE_END}. "
        "Close other applications and try again."
    )


# ---------------------------------------------------------------------------
# App configuration for desktop mode
# ---------------------------------------------------------------------------

def resolve_static_dir() -> str:
    """Return the path to the built SvelteKit frontend."""
    if getattr(sys, "frozen", False):
        # Running from PyInstaller bundle
        return os.path.join(sys._MEIPASS, "frontend")
    # Development: built frontend lives in ../ui/build
    return os.path.join(os.path.dirname(__file__), "..", "ui", "build")


def configure_app(app):
    """
    Modify the FastAPI app for desktop use:
    - Remove SecurityHeadersMiddleware (CSP blocks inline scripts)
    - Mount built frontend as static files with SPA fallback
    """
    from starlette.staticfiles import StaticFiles
    from starlette.responses import FileResponse
    from starlette.types import ASGIApp, Receive, Scope, Send

    # --- Remove SecurityHeadersMiddleware ---
    # Starlette wraps middleware in a chain; we rebuild it without the security one.
    from app.main import SecurityHeadersMiddleware

    # Walk the middleware stack and remove SecurityHeadersMiddleware
    # FastAPI stores middleware as app.middleware_stack after first request,
    # but before startup we can manipulate app.user_middleware.
    app.user_middleware = [
        m for m in app.user_middleware
        if m.cls is not SecurityHeadersMiddleware
    ]
    # Force middleware stack rebuild on next request
    app.middleware_stack = None

    # --- Static file serving with SPA fallback ---
    static_dir = resolve_static_dir()
    if not os.path.isdir(static_dir):
        raise FileNotFoundError(
            f"Frontend build not found at {static_dir}. "
            "Run 'cd ui && pnpm build:desktop' first."
        )

    index_path = os.path.join(static_dir, "index.html")

    class SPAStaticFiles(StaticFiles):
        """StaticFiles with SPA fallback: unknown paths return index.html."""

        async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
            # Only intercept HTTP requests that aren't API calls
            if scope["type"] == "http" and not scope["path"].startswith("/api"):
                try:
                    await super().__call__(scope, receive, send)
                except Exception:
                    # File not found — serve index.html for client-side routing
                    response = FileResponse(index_path, media_type="text/html")
                    await response(scope, receive, send)
            else:
                await super().__call__(scope, receive, send)

    app.mount("/", SPAStaticFiles(directory=static_dir, html=True), name="frontend")


# ---------------------------------------------------------------------------
# Server lifecycle
# ---------------------------------------------------------------------------

def wait_for_server(port: int, timeout: float = 15.0) -> bool:
    """Poll the health endpoint until the server responds or timeout."""
    import urllib.request
    import urllib.error

    url = f"http://127.0.0.1:{port}/api/v1/health"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.2)
    return False


def main():
    # Find a free port
    try:
        port = find_free_port()
    except RuntimeError as e:
        webview.create_window("Illuminate — Error", html=f"<h2>{e}</h2>")
        webview.start()
        sys.exit(1)

    # Import and configure the FastAPI app
    from app.main import app

    configure_app(app)

    # Create uvicorn server (don't use uvicorn.run — we need the Server object)
    config = uvicorn.Config(
        app=app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )
    server = uvicorn.Server(config)

    # Start server in a daemon thread
    server_thread = threading.Thread(target=server.serve, daemon=True)
    server_thread.start()

    # Wait for server to be ready
    if not wait_for_server(port):
        webview.create_window(
            "Illuminate — Error",
            html="<h2>Server failed to start. Check logs for details.</h2>",
        )
        webview.start()
        sys.exit(1)

    logger.info(f"Server ready on port {port}")

    # Open the native window (blocks until closed)
    window = webview.create_window(
        "Illuminate",
        f"http://127.0.0.1:{port}/",
        width=1280,
        height=900,
        min_size=(800, 600),
    )
    webview.start()

    # Window closed — shut down server
    server.should_exit = True
    server_thread.join(timeout=3)
    sys.exit(0)


if __name__ == "__main__":
    main()
