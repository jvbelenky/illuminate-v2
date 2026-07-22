"""_log_and_raise must not leak internal exception details to clients."""
import json

import pytest
from fastapi import HTTPException

from api.v1.session_helpers import _log_and_raise


def test_value_error_message_passes_through():
    with pytest.raises(HTTPException) as exc_info:
        _log_and_raise("Failed to update zone", ValueError("x2 must be greater than x1"))
    assert exc_info.value.status_code == 400
    assert "x2 must be greater than x1" in exc_info.value.detail


def test_http_exception_reraised_unchanged():
    original = HTTPException(status_code=404, detail="Zone 'foo' not found")
    with pytest.raises(HTTPException) as exc_info:
        _log_and_raise("Failed to update zone", original)
    assert exc_info.value is original


def test_internal_exception_detail_is_generic():
    with pytest.raises(HTTPException) as exc_info:
        _log_and_raise(
            "Failed to update zone",
            RuntimeError("secret internal state at /home/user/guv-calcs/room.py:123"),
        )
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Failed to update zone"
    assert "secret" not in exc_info.value.detail


def test_value_error_subclass_detail_is_generic():
    try:
        json.loads("{not valid json")
    except json.JSONDecodeError as decode_error:
        with pytest.raises(HTTPException) as exc_info:
            _log_and_raise("Failed to load project", decode_error)
        assert exc_info.value.detail == "Failed to load project"
