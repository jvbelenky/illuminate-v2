"""Request-side checks for the PDF report that Pydantic cannot express."""
import base64
import io

from PIL import Image

IMAGE_KEYS = ("cover", "plan")
VOLUME_KEY_PREFIX = "volume:"
MAX_IMAGE_BYTES = 4 * 1024 * 1024
# base64 inflates by 4/3; anything longer than this cannot decode to <= MAX_IMAGE_BYTES
MAX_ENCODED_CHARS = (MAX_IMAGE_BYTES * 4 + 2) // 3 + 4
MAX_IMAGE_PIXELS = 40_000_000  # 40 MP; a 4 MB capture is far below this
# Declared data-URL type → the Pillow format the bytes must actually decode as.
# The browser sends JPEG (a rendered 3D scene compresses 5-10× smaller than PNG,
# which keeps the request under a typical reverse proxy's body cap); PNG stays
# accepted for older clients and tests.
_FORMATS = {"data:image/png;base64,": "PNG", "data:image/jpeg;base64,": "JPEG"}


class ReportValidationError(ValueError):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def _valid_key(key: str) -> bool:
    return key in IMAGE_KEYS or (key.startswith(VOLUME_KEY_PREFIX) and len(key) > len(VOLUME_KEY_PREFIX))


def decode_images(images: dict[str, str]) -> dict[str, bytes]:
    """Decode `key → PNG/JPEG data URL` into raw bytes, rejecting anything that is
    not a small, well-formed image of its declared type under a known key. Errors
    name the offending key."""
    out: dict[str, bytes] = {}
    for key, data_url in images.items():
        if not _valid_key(key):
            raise ReportValidationError(f"Unknown image key '{key}'")
        prefix = next((p for p in _FORMATS if data_url.startswith(p)), None)
        if prefix is None:
            raise ReportValidationError(f"Image '{key}' must be a PNG or JPEG data URL")
        expected = _FORMATS[prefix]
        encoded = data_url[len(prefix):]
        # Size cap on the encoded text first, so an oversized body is never decoded
        if len(encoded) > MAX_ENCODED_CHARS:
            raise ReportValidationError(f"Image '{key}' exceeds 4 MB")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            raise ReportValidationError(f"Image '{key}' is not valid base64")
        if len(raw) > MAX_IMAGE_BYTES:
            raise ReportValidationError(f"Image '{key}' exceeds 4 MB")
        try:
            with Image.open(io.BytesIO(raw)) as im:
                if im.format != expected:
                    raise ReportValidationError(f"Image '{key}' is not a {expected}")
                # Dimensions come from the header; reject a decompression bomb
                # before verify()/decode can allocate for it
                if im.width * im.height > MAX_IMAGE_PIXELS:
                    raise ReportValidationError(f"Image '{key}' has too many pixels ({im.width}×{im.height})")
                im.verify()
        except ReportValidationError:
            raise
        except Image.DecompressionBombError:
            # Pillow refuses to even open images past its own (larger) pixel limit
            raise ReportValidationError(f"Image '{key}' has too many pixels")
        except Exception:
            raise ReportValidationError(f"Image '{key}' could not be decoded")
        out[key] = raw
    return out
