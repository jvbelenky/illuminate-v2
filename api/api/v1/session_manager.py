"""
Session Manager - Handles multi-user session storage.

Each session is identified by a unique session ID (UUID). Sessions are stored
in memory with optional timeout-based cleanup. This enables multiple users/tabs
to work independently without interference.

Security: Sessions use server-generated tokens for authentication. The token
is hashed before storage to prevent token extraction if memory is dumped.
"""

import hashlib
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from uuid import uuid4
import logging

from guv_calcs.room import Room
from guv_calcs.lamp import Lamp

from .resource_limits import MAX_CONCURRENT_SESSIONS

logger = logging.getLogger(__name__)


# Session timeout in seconds (30 minutes of inactivity)
SESSION_TIMEOUT_SECONDS = 30 * 60


@dataclass
class Session:
    """A single user session with a Room and ID mappings."""
    id: str
    token_hash: Optional[str] = None  # SHA-256 hash of session token
    room: Optional[Room] = None
    lamp_id_map: Dict[str, Lamp] = field(default_factory=dict)
    zone_id_map: Dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    last_accessed: float = field(default_factory=time.time)

    def touch(self):
        """Update last access time."""
        self.last_accessed = time.time()

    def is_expired(self, timeout: float = SESSION_TIMEOUT_SECONDS) -> bool:
        """Check if session has expired due to inactivity."""
        return time.time() - self.last_accessed > timeout

    def verify_token(self, token: str) -> bool:
        """Verify the provided token matches the stored hash."""
        if not self.token_hash:
            return False
        return hashlib.sha256(token.encode()).hexdigest() == self.token_hash

    @staticmethod
    def hash_token(token: str) -> str:
        """Hash a token for storage."""
        return hashlib.sha256(token.encode()).hexdigest()

    @staticmethod
    def generate_token() -> str:
        """Generate a cryptographically secure session token."""
        return secrets.token_urlsafe(32)


class SessionManager:
    """
    Thread-safe session manager for multi-user support.

    Stores sessions by ID and provides cleanup for expired sessions.
    """

    def __init__(self, cleanup_interval: float = 60.0):
        """
        Initialize session manager.

        Args:
            cleanup_interval: How often to run cleanup (in seconds)
        """
        self._sessions: Dict[str, Session] = {}
        self._lock = threading.RLock()
        self._cleanup_interval = cleanup_interval
        self._cleanup_thread: Optional[threading.Thread] = None
        self._running = False

    def start_cleanup(self):
        """Start background cleanup thread."""
        if self._cleanup_thread is not None:
            return

        self._running = True
        self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleanup_thread.start()
        logger.info("Session cleanup thread started")

    def stop_cleanup(self):
        """Stop background cleanup thread."""
        self._running = False
        if self._cleanup_thread:
            self._cleanup_thread.join(timeout=5.0)
            self._cleanup_thread = None

    def _cleanup_loop(self):
        """Background loop that cleans up expired sessions."""
        while self._running:
            time.sleep(self._cleanup_interval)
            self.cleanup_expired()

    def cleanup_expired(self) -> int:
        """
        Remove expired sessions.

        Returns:
            Number of sessions removed
        """
        with self._lock:
            expired = [
                sid for sid, session in self._sessions.items()
                if session.is_expired()
            ]
            for sid in expired:
                del self._sessions[sid]
                logger.info(f"Cleaned up expired session: {sid[:8]}...")
            return len(expired)

    def create_session(self, session_id: Optional[str] = None, token_hash: Optional[str] = None) -> Session:
        """
        Create a new session.

        Args:
            session_id: Optional session ID (generated if not provided)
            token_hash: Optional hashed token for session authentication

        Returns:
            The new Session object

        Raises:
            RuntimeError: If server is at capacity (too many concurrent sessions)
        """
        with self._lock:
            if len(self._sessions) >= MAX_CONCURRENT_SESSIONS:
                logger.warning(
                    f"Session creation rejected: at capacity "
                    f"({len(self._sessions)}/{MAX_CONCURRENT_SESSIONS})"
                )
                raise RuntimeError(
                    f"Server at capacity ({MAX_CONCURRENT_SESSIONS} sessions). "
                    "Please try again later."
                )

            if session_id is None:
                session_id = str(uuid4())

            session = Session(id=session_id, token_hash=token_hash)
            self._sessions[session_id] = session
            logger.info(f"Created new session: {session_id[:8]}...")
            return session

    def get_session(self, session_id: str, auto_create: bool = False) -> Optional[Session]:
        """
        Get a session by ID.

        Args:
            session_id: The session ID to look up
            auto_create: If True, create session if it doesn't exist

        Returns:
            Session if found (or created), None otherwise
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if session is not None:
                session.touch()
                return session

            if auto_create:
                return self.create_session(session_id)

            return None

    def delete_session(self, session_id: str) -> bool:
        """
        Delete a session.

        Args:
            session_id: The session ID to delete

        Returns:
            True if deleted, False if not found
        """
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                logger.info(f"Deleted session: {session_id[:8]}...")
                return True
            return False

    def get_or_create(self, session_id: str) -> Session:
        """
        Get existing session or create new one.

        Args:
            session_id: The session ID

        Returns:
            The session (existing or new)
        """
        return self.get_session(session_id, auto_create=True)

    def session_count(self) -> int:
        """Get the number of active sessions."""
        with self._lock:
            return len(self._sessions)

    def list_sessions(self) -> Dict[str, dict]:
        """
        List all sessions with basic info.

        Returns:
            Dict mapping session ID to info dict
        """
        with self._lock:
            return {
                sid: {
                    "created_at": session.created_at,
                    "last_accessed": session.last_accessed,
                    "has_room": session.room is not None,
                    "lamp_count": len(session.lamp_id_map),
                    "zone_count": len(session.zone_id_map),
                }
                for sid, session in self._sessions.items()
            }


# Global session manager instance
_session_manager = SessionManager()


def get_session_manager() -> SessionManager:
    """Get the global session manager instance."""
    return _session_manager


def init_session_manager():
    """Initialize session manager and start cleanup thread."""
    _session_manager.start_cleanup()
    logger.info("Session manager initialized")
