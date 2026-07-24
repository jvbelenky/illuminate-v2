"""Canonical content hashing for lamp photometry + spectrum."""

import hashlib
import json


def lamp_content_hash(lamp) -> str | None:
    """Sha256 over canonical IES bytes + canonical spectrum serialization.

    Canonical = what guv_calcs re-serializes, so hashes are stable across
    upload -> save -> load round-trips regardless of original file formatting.
    Returns None when the lamp has no photometry.
    """
    ies = lamp.save_ies(original=True)
    if ies is None:
        return None
    if lamp.spectrum is not None:
        sd = lamp.spectrum.to_dict(as_string=True)
        keys = list(sd.keys())[:2]
        spec = json.dumps({k: sd[k] for k in keys}, sort_keys=True).encode()
    else:
        spec = b""
    return hashlib.sha256(ies + b"\x00" + spec).hexdigest()
