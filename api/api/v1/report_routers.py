"""POST /session/report/pdf — the designed PDF report."""
import logging
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from guv_calcs import WHOLE_ROOM_FLUENCE, EYE_LIMITS, SKIN_LIMITS

from api.report.context import build_report_context, Versions, ReportDataError
from api.report.plots import attach_plots
from api.report.render import render_pdf, WeasyPrintUnavailable
from api.report.validation import decode_images, ReportValidationError
from .session_helpers import InitializedSessionDep, locked_session, _log_and_raise
from .session_schemas import ReportRequest

logger = logging.getLogger(__name__)
router = APIRouter()


def _slug(title: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", title).strip("_")
    return s[:60] or "report"


@router.post("/report/pdf", summary="Generate the PDF design report",
             responses={200: {"content": {"application/pdf": {}}}})
def generate_report_pdf(body: ReportRequest, session: InitializedSessionDep, request: Request):
    room = session.room
    for zid in (WHOLE_ROOM_FLUENCE, SKIN_LIMITS, EYE_LIMITS):
        zone = room.calc_zones.get(zid)
        if zone is None or zone.get_values() is None:
            raise HTTPException(status_code=400,
                                detail=f"Calculate the room before generating a report ({zid} has no results).")
    try:
        images = decode_images(body.images)
    except ReportValidationError as e:
        raise HTTPException(status_code=422, detail=e.detail)
    try:
        from guv_calcs import __version__ as guv_version
    except ImportError:
        guv_version = "unknown"
    versions = Versions(app=request.app.version, guv_calcs=guv_version)
    try:
        with locked_session(session):
            try:
                ctx = build_report_context(room, body, images, versions)
            except ReportDataError as e:
                raise HTTPException(status_code=422, detail=str(e))
            attach_plots(ctx, room)
        logger.info(f"Rendering PDF report for session {session.id[:8]}... ({len(images)} images)")
        pdf = render_pdf(ctx)
    except HTTPException:
        raise
    except WeasyPrintUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        _log_and_raise("Report generation failed", e)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{_slug(body.meta.title)}_report.pdf"'})
