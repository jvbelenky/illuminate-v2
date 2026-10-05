"""Jinja2 → HTML → WeasyPrint PDF. WeasyPrint is imported lazily so the API
boots on hosts without Pango; the endpoint reports 503 in that case."""
from __future__ import annotations

import base64
import logging
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .context import ReportContext

TEMPLATES = Path(__file__).parent / "templates"

# WeasyPrint subsets the embedded fonts through fontTools, which logs every
# table at INFO; that is noise for an API server.
logging.getLogger("fontTools").setLevel(logging.WARNING)


class WeasyPrintUnavailable(RuntimeError):
    pass


def _num(value, places: int = 1) -> str:
    if value is None:
        return "—"
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "—"
    if v != v:  # NaN
        return "—"
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    return f"{v:.{int(places)}f}"


def _hours(value) -> str:
    if value is None:
        return "—"
    if value >= 8:
        return f"Indefinite ({value:.1f} h)"
    if value >= 1:
        return f"{value:.1f} h"
    return f"{value * 60:.0f} min"


def _pct(value) -> str:
    """A fraction as a percentage at its own precision: 0.078 → '7.8 %', 0.1 → '10 %'."""
    if value is None:
        return "—"
    try:
        v = float(value) * 100
    except (TypeError, ValueError):
        return "—"
    if v != v:
        return "—"
    return f"{v:.10g} %"


def _seconds(value) -> str:
    if value is None:
        return "—"
    if value < 60:
        return f"{value:.0f} s"
    if value < 3600:
        return f"{value / 60:.1f} min"
    return f"{value / 3600:.1f} h"


def _img(ctx: ReportContext, key: str) -> str:
    raw = ctx.images.get(key)
    return "data:image/png;base64," + base64.b64encode(raw).decode() if raw else ""


def _env() -> Environment:
    env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=select_autoescape(["html"]))
    env.filters["num"] = _num
    env.filters["hours"] = _hours
    env.filters["seconds"] = _seconds
    env.filters["pct"] = _pct
    return env


def render_html(ctx: ReportContext) -> str:
    env = _env()
    css = (TEMPLATES / "report.css").read_text(encoding="utf-8")
    wordmark = (TEMPLATES / "wordmark.svg").read_text(encoding="utf-8")
    return env.get_template("report.html").render(
        ctx=ctx, css=css, wordmark=wordmark, img=lambda key: _img(ctx, key),
        fonts_url=TEMPLATES.joinpath("fonts").as_uri(),
    )


_MIME_BY_SUFFIX = {".ttf": "font/ttf", ".otf": "font/otf", ".woff2": "font/woff2", ".svg": "image/svg+xml",
                   ".png": "image/png", ".css": "text/css", ".txt": "text/plain"}


def restricted_url_fetcher(url: str, *args, **kwargs) -> dict:
    """WeasyPrint URL fetcher that refuses everything except data: URIs and files
    inside the bundled templates directory. The HTML carries user text (title,
    notes), so no stylesheet or image reference may reach the network or the
    wider filesystem, whatever ends up in the document."""
    if url.startswith("data:"):
        from weasyprint import default_url_fetcher  # lazy, see render_pdf
        return default_url_fetcher(url, *args, **kwargs)
    if url.startswith("file://"):
        path = Path(url2pathname(urlparse(url).path)).resolve()
        root = TEMPLATES.resolve()
        if root in path.parents and path.is_file():
            return {"file_obj": open(path, "rb"),
                    "mime_type": _MIME_BY_SUFFIX.get(path.suffix.lower(), "application/octet-stream")}
    raise ValueError(f"Blocked URL in report: {url[:80]}")


def render_pdf(ctx: ReportContext) -> bytes:
    try:
        from weasyprint import HTML  # lazy: needs libpango at import time
    except (ImportError, OSError) as e:
        raise WeasyPrintUnavailable(f"PDF rendering is unavailable on this server: {e}")
    html = render_html(ctx)
    return HTML(string=html, base_url=str(TEMPLATES), url_fetcher=restricted_url_fetcher).write_pdf()
