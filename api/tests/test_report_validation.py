import base64
import io
import pytest
from PIL import Image
from pydantic import ValidationError

from api.v1.session_schemas import ReportRequest
from api.report.validation import decode_images, ReportValidationError


def _png(w=4, h=4) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (10, 20, 30)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_request_defaults_and_limits():
    req = ReportRequest(meta={"title": "Lab 3"}, pathogens=["Human coronavirus"])
    assert req.options.include_lamp_appendix is True
    assert req.options.page_size == "auto"
    assert req.meta.client == ""
    with pytest.raises(ValidationError):
        ReportRequest(meta={"title": "x" * 121}, pathogens=["Human coronavirus"])
    with pytest.raises(ValidationError):
        ReportRequest(meta={"title": "ok"}, pathogens=[])
    with pytest.raises(ValidationError):
        ReportRequest(meta={"title": "ok"}, pathogens=["a"], images={f"volume:{i}": _png() for i in range(13)})


def _jpeg(w=4, h=4) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (10, 20, 30)).save(buf, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def test_decode_images_accepts_png_and_names_bad_keys():
    out = decode_images({"cover": _png(), "volume:abc": _png()})
    assert set(out) == {"cover", "volume:abc"}
    assert out["cover"][:8] == b"\x89PNG\r\n\x1a\n"
    with pytest.raises(ReportValidationError) as e:
        decode_images({"plan": "data:image/jpeg;base64,/9j/4AAQ"})  # truncated
    assert "plan" in e.value.detail
    with pytest.raises(ReportValidationError) as e:
        decode_images({"plan": "data:image/gif;base64,R0lGODlh"})
    assert "plan" in e.value.detail


def test_decode_images_accepts_jpeg():
    out = decode_images({"cover": _jpeg(), "plan": _png()})
    assert out["cover"][:2] == b"\xff\xd8"
    assert out["plan"][:8] == b"\x89PNG\r\n\x1a\n"


def test_declared_type_must_match_the_bytes():
    png_bytes = _png()[len("data:image/png;base64,"):]
    with pytest.raises(ReportValidationError) as e:
        decode_images({"cover": "data:image/jpeg;base64," + png_bytes})
    assert "cover" in e.value.detail and "JPEG" in e.value.detail
    with pytest.raises(ReportValidationError) as e:
        decode_images({"weird": _png()})
    assert "weird" in e.value.detail


def test_decode_images_rejects_oversize():
    big = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * (4 * 1024 * 1024 + 1)).decode()
    with pytest.raises(ReportValidationError) as e:
        decode_images({"cover": big})
    assert "4 MB" in e.value.detail


def test_oversize_data_url_is_rejected_before_decoding():
    # Longer than 4 MB of base64 text, but not even valid base64: the length cap
    # must fire first so a hostile body is never decoded.
    huge = "data:image/png;base64," + "!" * (6 * 1024 * 1024)
    with pytest.raises(ReportValidationError) as e:
        decode_images({"cover": huge})
    assert "4 MB" in e.value.detail


def _png_header_claiming(width: int, height: int) -> str:
    import struct, zlib
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    chunk = struct.pack(">I", len(ihdr)) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr) & 0xFFFFFFFF)
    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND") & 0xFFFFFFFF)
    raw = b"\x89PNG\r\n\x1a\n" + chunk + iend
    return "data:image/png;base64," + base64.b64encode(raw).decode()


def test_png_with_huge_dimensions_is_rejected():
    with pytest.raises(ReportValidationError) as e:
        decode_images({"cover": _png_header_claiming(60000, 60000)})
    assert "cover" in e.value.detail and "pixels" in e.value.detail


def test_request_rejects_overlong_image_strings_at_parse_time():
    from api.report.validation import MAX_ENCODED_CHARS
    too_long = "data:image/png;base64," + "A" * (MAX_ENCODED_CHARS + 1)
    with pytest.raises(ValidationError) as e:
        ReportRequest(meta={"title": "ok"}, pathogens=["a"], images={"cover": too_long})
    assert "cover" in str(e.value)
