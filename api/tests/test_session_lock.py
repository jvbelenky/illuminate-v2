"""Per-session lock: mutating endpoints serialize; a held lock returns 423."""
import threading

import api.v1.zone_session_routers as zone_session_routers
from api.v1.session_helpers import locked_session
from api.v1.session_manager import Session
from tests.conftest import API


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


def test_zone_update_lookup_happens_under_lock(monkeypatch, initialized_session):
    """The entity lookup in update_session_zone must happen after the lock is
    acquired, not before — otherwise a concurrent request could replace/remove
    the zone between the lookup and the lock, causing a lost update against a
    stale object (see zone_session_routers.update_session_zone).
    """
    client, headers = initialized_session
    status = client.get(f"{API}/session/status", headers=headers).json()
    zone_id = status["zone_ids"][0]

    original_get_zone_or_404 = zone_session_routers._get_zone_or_404
    observed_lock_states = []

    def wrapper(session, zid):
        observed_lock_states.append(session.lock.locked())
        return original_get_zone_or_404(session, zid)

    monkeypatch.setattr(zone_session_routers, "_get_zone_or_404", wrapper)

    resp = client.patch(
        f"{API}/session/zones/{zone_id}",
        json={"height": 1.5},
        headers=headers,
    )
    assert resp.status_code == 200
    # Wrapper must have run, and the lock must have been held each time.
    assert observed_lock_states == [True]
