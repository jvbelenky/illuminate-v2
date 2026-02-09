import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoFocus } from './autoFocus';

function createModal(...elements: HTMLElement[]): HTMLElement {
  const container = document.createElement('div');
  for (const el of elements) {
    container.appendChild(el);
  }
  document.body.appendChild(container);
  return container;
}

function mockOffsetParent(el: HTMLElement) {
  Object.defineProperty(el, 'offsetParent', { value: document.body, configurable: true });
}

function button(label: string, className?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  if (className) btn.className = className;
  mockOffsetParent(btn);
  return btn;
}

describe('autoFocus', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  describe('initial focus', () => {
    it('focuses first focusable element on mount', () => {
      const btn1 = button('First');
      const btn2 = button('Second');
      const container = createModal(btn1, btn2);
      autoFocus(container);
      expect(document.activeElement).toBe(btn1);
    });

    it('skips close button for initial focus', () => {
      const closeBtn = button('X', 'close-btn');
      const btn1 = button('First');
      const container = createModal(closeBtn, btn1);
      autoFocus(container);
      expect(document.activeElement).toBe(btn1);
    });

    it('handles container with no focusable elements', () => {
      const container = createModal(document.createElement('div'));
      // Should not throw
      autoFocus(container);
    });

    it('focuses close button if it is the only focusable element', () => {
      const closeBtn = button('X', 'close-btn');
      const container = createModal(closeBtn);
      autoFocus(container);
      expect(document.activeElement).toBe(closeBtn);
    });
  });

  describe('tab cycling', () => {
    it('Tab moves focus to next element', () => {
      const btn1 = button('First');
      const btn2 = button('Second');
      const container = createModal(btn1, btn2);
      autoFocus(container);

      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(btn2);
    });

    it('Shift+Tab moves focus to previous element', () => {
      const btn1 = button('First');
      const btn2 = button('Second');
      const container = createModal(btn1, btn2);
      autoFocus(container);

      // Move to btn2 first
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(btn2);

      // Shift+Tab back to btn1
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(document.activeElement).toBe(btn1);
    });

    it('Tab wraps from last to first', () => {
      const btn1 = button('First');
      const btn2 = button('Second');
      const container = createModal(btn1, btn2);
      autoFocus(container);

      // Move to btn2
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      // Wrap to btn1
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(btn1);
    });

    it('Shift+Tab wraps from first to last', () => {
      const btn1 = button('First');
      const btn2 = button('Second');
      const container = createModal(btn1, btn2);
      autoFocus(container);

      // Shift+Tab from first -> wraps to last
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(document.activeElement).toBe(btn2);
    });

    it('places close button last in tab order', () => {
      const closeBtn = button('X', 'close-btn');
      const btn1 = button('First');
      const btn2 = button('Second');
      // Close button is first in DOM, but should be last in tab order
      const container = createModal(closeBtn, btn1, btn2);
      autoFocus(container);

      // Start at btn1 (first non-close)
      expect(document.activeElement).toBe(btn1);
      // Tab to btn2
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(btn2);
      // Tab to close button (last)
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(closeBtn);
    });

    it('prevents default Tab behavior', () => {
      const btn1 = button('First');
      const btn2 = button('Second');
      const container = createModal(btn1, btn2);
      autoFocus(container);

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      container.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('destroy removes keydown listener', () => {
      const btn1 = button('First');
      const btn2 = button('Second');
      const container = createModal(btn1, btn2);
      const action = autoFocus(container);

      action.destroy();
      btn1.focus();
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      // Focus should stay on btn1 since listener was removed
      expect(document.activeElement).toBe(btn1);
    });
  });
});
