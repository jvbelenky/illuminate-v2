/**
 * Session state management for API client.
 *
 * This module manages the client-side session state that coordinates
 * with the backend session API. It encapsulates:
 * - Session ID generation and tracking
 * - Reinitialization coordination (prevents duplicate reinit attempts)
 * - Session expiration callback management
 */

interface SessionState {
  sessionId: string | null;
  isReinitializing: boolean;
  reinitPromise: Promise<void> | null;
  onSessionExpired: (() => Promise<void>) | null;
}

function createSessionStateStore() {
  let state: SessionState = {
    sessionId: null,
    isReinitializing: false,
    reinitPromise: null,
    onSessionExpired: null,
  };

  return {
    // Session ID management
    getSessionId: () => state.sessionId,

    setSessionId: (id: string | null) => {
      state.sessionId = id;
      if (id) {
        console.log('[session] Set session ID:', id.slice(0, 8) + '...');
      }
    },

    generateSessionId: () => {
      state.sessionId = crypto.randomUUID();
      console.log('[session] Generated session ID:', state.sessionId.slice(0, 8) + '...');
      return state.sessionId;
    },

    hasSessionId: () => state.sessionId !== null,

    // Reinit coordination - prevents duplicate reinit attempts
    isReinitializing: () => state.isReinitializing,

    getReinitPromise: () => state.reinitPromise,

    startReinit: (promise: Promise<void>) => {
      state.isReinitializing = true;
      state.reinitPromise = promise;
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
