"""Per-session lock: mutating endpoints serialize; a held lock returns 423."""
import threading

from api.v1.session_helpers import locked_session
from api.v1.session_manager import Session


def test_session_has_lock():
    session = Session("test-id")
    assert isinstance(session.lock, type(threading.Lock()))


def test_locked_session_acquires_and_releases():
    session = Session("test-id")
    with locked_session(session):
        assert session.lock.locked()
    assert not session.lock.locked()


def test_locked_session_raises_423_when_held(monkeypatch):
    import api.v1.session_helpers as helpers
    from fastapi import HTTPException
    import pytest

    monkeypatch.setattr(helpers, "LOCK_TIMEOUT_SECONDS", 0.05)
    session = Session("test-id")
    session.lock.acquire()
    try:
        with pytest.raises(HTTPException) as exc_info:
            with locked_session(session):
                pass
        assert exc_info.value.status_code == 423
    finally:
        session.lock.release()
