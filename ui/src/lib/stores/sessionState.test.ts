import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('sessionState', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function importModule() {
    return await import('./sessionState');
  }

  describe('initial state', () => {
    it('has no session ID', async () => {
      const { sessionState } = await importModule();
      expect(sessionState.getSessionId()).toBeNull();
    });

    it('has no token', async () => {
      const { sessionState } = await importModule();
      expect(sessionState.getToken()).toBeNull();
    });

    it('is not reinitializing', async () => {
      const { sessionState } = await importModule();
      expect(sessionState.isReinitializing()).toBe(false);
    });

    it('has no reinit promise', async () => {
      const { sessionState } = await importModule();
      expect(sessionState.getReinitPromise()).toBeNull();
    });

    it('hasSession returns false', async () => {
      const { sessionState } = await importModule();
      expect(sessionState.hasSession()).toBe(false);
    });

    it('hasSessionId returns false', async () => {
      const { sessionState } = await importModule();
      expect(sessionState.hasSessionId()).toBe(false);
    });
  });

  describe('setSession / getSession', () => {
    it('sets session ID and token', async () => {
      const { sessionState } = await importModule();
      sessionState.setSession('sid-123', 'tok-456');
      expect(sessionState.getSessionId()).toBe('sid-123');
      expect(sessionState.getToken()).toBe('tok-456');
    });

    it('hasSession returns true after setSession', async () => {
      const { sessionState } = await importModule();
      sessionState.setSession('sid-123', 'tok-456');
      expect(sessionState.hasSession()).toBe(true);
    });

    it('saves to sessionStorage', async () => {
      const { sessionState } = await importModule();
      sessionState.setSession('sid-123', 'tok-456');
      expect(sessionStorage.setItem).toHaveBeenCalledWith(
        'illuminate_session',
        JSON.stringify({ sessionId: 'sid-123', token: 'tok-456' })
      );
    });
  });

  describe('clearSession', () => {
    it('clears session ID and token', async () => {
      const { sessionState } = await importModule();
      sessionState.setSession('sid-123', 'tok-456');
      sessionState.clearSession();
      expect(sessionState.getSessionId()).toBeNull();
      expect(sessionState.getToken()).toBeNull();
    });

    it('hasSession returns false', async () => {
      const { sessionState } = await importModule();
      sessionState.setSession('sid-123', 'tok-456');
      sessionState.clearSession();
      expect(sessionState.hasSession()).toBe(false);
    });

    it('removes from sessionStorage', async () => {
      const { sessionState } = await importModule();
      sessionState.setSession('sid-123', 'tok-456');
      sessionState.clearSession();
      expect(sessionStorage.removeItem).toHaveBeenCalledWith('illuminate_session');
    });
  });

  describe('generateSessionId', () => {
    it('generates a UUID as session ID', async () => {
      const { sessionState } = await importModule();
      const id = sessionState.generateSessionId();
      expect(id).toMatch(/^test-uuid-/);
      expect(sessionState.getSessionId()).toBe(id);
    });

    it('sets token to null', async () => {
      const { sessionState } = await importModule();
      sessionState.generateSessionId();
      expect(sessionState.getToken()).toBeNull();
    });

    it('hasSessionId returns true', async () => {
      const { sessionState } = await importModule();
      sessionState.generateSessionId();
      expect(sessionState.hasSessionId()).toBe(true);
    });
  });

  describe('reinit coordination', () => {
    it('startReinit returns true on first call', async () => {
      const { sessionState } = await importModule();
      const promise = Promise.resolve();
      expect(sessionState.startReinit(promise)).toBe(true);
    });

    it('startReinit returns false when already reinitializing', async () => {
      const { sessionState } = await importModule();
      const promise = Promise.resolve();
      sessionState.startReinit(promise);
      expect(sessionState.startReinit(promise)).toBe(false);
    });

    it('isReinitializing returns true during reinit', async () => {
      const { sessionState } = await importModule();
      sessionState.startReinit(Promise.resolve());
      expect(sessionState.isReinitializing()).toBe(true);
    });

    it('getReinitPromise returns the provided promise', async () => {
      const { sessionState } = await importModule();
      const promise = Promise.resolve();
      sessionState.startReinit(promise);
      expect(sessionState.getReinitPromise()).toBe(promise);
    });

    it('finishReinit clears reinit state', async () => {
      const { sessionState } = await importModule();
      sessionState.startReinit(Promise.resolve());
      sessionState.finishReinit();
      expect(sessionState.isReinitializing()).toBe(false);
      expect(sessionState.getReinitPromise()).toBeNull();
    });

    it('startReinit works again after finishReinit', async () => {
      const { sessionState } = await importModule();
      sessionState.startReinit(Promise.resolve());
      sessionState.finishReinit();
      expect(sessionState.startReinit(Promise.resolve())).toBe(true);
    });
  });

  describe('session expiration handler', () => {
    it('starts with no handler', async () => {
      const { sessionState } = await importModule();
      expect(sessionState.getOnSessionExpired()).toBeNull();
    });

    it('sets and gets handler', async () => {
      const { sessionState } = await importModule();
      const handler = async () => {};
      sessionState.setOnSessionExpired(handler);
      expect(sessionState.getOnSessionExpired()).toBe(handler);
    });

    it('can clear handler with null', async () => {
      const { sessionState } = await importModule();
      sessionState.setOnSessionExpired(async () => {});
      sessionState.setOnSessionExpired(null);
      expect(sessionState.getOnSessionExpired()).toBeNull();
    });
  });

  describe('session restoration from sessionStorage', () => {
    it('restores session from sessionStorage on init', async () => {
      sessionStorage.setItem(
        'illuminate_session',
        JSON.stringify({ sessionId: 'restored-id', token: 'restored-token' })
      );
      const { sessionState } = await importModule();
      expect(sessionState.getSessionId()).toBe('restored-id');
      expect(sessionState.getToken()).toBe('restored-token');
    });

    it('handles malformed JSON in sessionStorage', async () => {
      sessionStorage.setItem('illuminate_session', 'not-json');
      const { sessionState } = await importModule();
      expect(sessionState.getSessionId()).toBeNull();
      expect(sessionStorage.removeItem).toHaveBeenCalledWith('illuminate_session');
    });

    it('ignores incomplete stored credentials', async () => {
      sessionStorage.setItem(
        'illuminate_session',
        JSON.stringify({ sessionId: 'only-id' })
      );
      const { sessionState } = await importModule();
      expect(sessionState.getSessionId()).toBeNull();
    });
  });

  describe('convenience exports', () => {
    it('generateSessionId returns a UUID', async () => {
      const { generateSessionId } = await importModule();
      const id = generateSessionId();
      expect(id).toMatch(/^test-uuid-/);
    });

    it('getSessionId auto-generates if none exists', async () => {
      const { getSessionId } = await importModule();
      const id = getSessionId();
      expect(id).toMatch(/^test-uuid-/);
    });

    it('setSessionId sets only the ID', async () => {
      const { setSessionId, sessionState } = await importModule();
      setSessionId('manual-id');
      expect(sessionState.getSessionId()).toBe('manual-id');
      expect(sessionState.getToken()).toBeNull();
    });

    it('hasSessionId returns correct boolean', async () => {
      const { hasSessionId, setSessionId } = await importModule();
      expect(hasSessionId()).toBe(false);
      setSessionId('some-id');
      expect(hasSessionId()).toBe(true);
    });

    it('setSession sets both ID and token', async () => {
      const { setSession, sessionState } = await importModule();
      setSession('sid', 'tok');
      expect(sessionState.getSessionId()).toBe('sid');
      expect(sessionState.getToken()).toBe('tok');
    });

    it('hasSession requires both ID and token', async () => {
      const { hasSession, sessionState } = await importModule();
      expect(hasSession()).toBe(false);
      sessionState.setSessionId('just-id');
      expect(hasSession()).toBe(false);
      sessionState.setSession('id', 'tok');
      expect(hasSession()).toBe(true);
    });

    it('clearSession clears everything', async () => {
      const { clearSession, hasSession, setSession } = await importModule();
      setSession('sid', 'tok');
      clearSession();
      expect(hasSession()).toBe(false);
    });

    it('getToken returns null initially', async () => {
      const { getToken } = await importModule();
      expect(getToken()).toBeNull();
    });

    it('setSessionExpiredHandler sets callback', async () => {
      const { setSessionExpiredHandler, sessionState } = await importModule();
      const handler = async () => {};
      setSessionExpiredHandler(handler);
      expect(sessionState.getOnSessionExpired()).toBe(handler);
    });
  });
});
