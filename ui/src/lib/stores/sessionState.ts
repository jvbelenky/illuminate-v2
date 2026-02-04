/**
 * Session state management for API client.
 *
 * This module manages the client-side session state that coordinates
 * with the backend session API. It encapsulates:
 * - Session ID and token management (server-generated credentials)
 * - Reinitialization coordination (prevents duplicate reinit attempts)
 * - Session expiration callback management
 * - Secure token storage in sessionStorage (clears on tab close)
 */

const SESSION_STORAGE_KEY = 'illuminate_session';

interface SessionCredentials {
  sessionId: string;
  token: string;
}

interface SessionState {
  sessionId: string | null;
  token: string | null;
  isReinitializing: boolean;
  reinitPromise: Promise<void> | null;
  onSessionExpired: (() => Promise<void>) | null;
}

function createSessionStateStore() {
  let state: SessionState = {
    sessionId: null,
    token: null,
    isReinitializing: false,
    reinitPromise: null,
    onSessionExpired: null,
  };

  // Try to restore session from sessionStorage on init
  if (typeof window !== 'undefined') {
    try {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as SessionCredentials;
        if (parsed.sessionId && parsed.token) {
          state.sessionId = parsed.sessionId;
          state.token = parsed.token;
          console.log('[session] Restored session from storage:', parsed.sessionId.slice(0, 8) + '...');
        }
      }
    } catch (e) {
      console.warn('[session] Failed to restore session from storage:', e);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  function saveToStorage() {
    if (typeof window !== 'undefined' && state.sessionId && state.token) {
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
          sessionId: state.sessionId,
          token: state.token,
        }));
      } catch (e) {
        console.warn('[session] Failed to save session to storage:', e);
      }
    }
  }

  function clearStorage() {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  return {
    // Session ID management
    getSessionId: () => state.sessionId,
    getToken: () => state.token,

    setSession: (sessionId: string, token: string) => {
      state.sessionId = sessionId;
      state.token = token;
      console.log('[session] Set session:', sessionId.slice(0, 8) + '...');
      saveToStorage();
    },

    clearSession: () => {
      state.sessionId = null;
      state.token = null;
      clearStorage();
      console.log('[session] Cleared session');
    },

    hasSession: () => state.sessionId !== null && state.token !== null,

    // Legacy: generate client-side session ID (for DEV_MODE compatibility)
    generateSessionId: () => {
      state.sessionId = crypto.randomUUID();
      state.token = null; // No token for client-generated sessions
      console.log('[session] Generated client-side session ID:', state.sessionId.slice(0, 8) + '...');
      return state.sessionId;
    },

    // Legacy: set only session ID (for DEV_MODE compatibility)
    setSessionId: (id: string | null) => {
      state.sessionId = id;
      if (id) {
        console.log('[session] Set session ID:', id.slice(0, 8) + '...');
      }
    },

    hasSessionId: () => state.sessionId !== null,

    // Reinit coordination - prevents duplicate reinit attempts
    isReinitializing: () => state.isReinitializing,

    getReinitPromise: () => state.reinitPromise,

    /**
     * Start a reinit operation. Returns false if one is already in progress.
     * Caller should check return value and wait for existing reinit if false.
     */
    startReinit: (promise: Promise<void>): boolean => {
      if (state.isReinitializing) {
        return false;  // Already reinitializing, caller should wait
      }
      state.isReinitializing = true;
      state.reinitPromise = promise;
      return true;
    },

    finishReinit: () => {
      state.isReinitializing = false;
      state.reinitPromise = null;
    },

    // Expiration callback - called when session timeout is detected
    setOnSessionExpired: (fn: (() => Promise<void>) | null) => {
      state.onSessionExpired = fn;
    },

    getOnSessionExpired: () => state.onSessionExpired,
  };
}

export const sessionState = createSessionStateStore();

// Convenience exports for backward compatibility with existing client.ts API
export function generateSessionId(): string {
  return sessionState.generateSessionId();
}

export function getSessionId(): string {
  if (!sessionState.hasSessionId()) {
    return sessionState.generateSessionId();
  }
  return sessionState.getSessionId()!;
}

export function setSessionId(id: string): void {
  sessionState.setSessionId(id);
}

export function hasSessionId(): boolean {
  return sessionState.hasSessionId();
}

export function setSessionExpiredHandler(handler: () => Promise<void>): void {
  sessionState.setOnSessionExpired(handler);
}

// New exports for secure session management
export function getToken(): string | null {
  return sessionState.getToken();
}

export function setSession(sessionId: string, token: string): void {
  sessionState.setSession(sessionId, token);
}

export function hasSession(): boolean {
  return sessionState.hasSession();
}

export function clearSession(): void {
  sessionState.clearSession();
}
