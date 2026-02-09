import { describe, it, expect } from 'vitest';
import { rovingTabindex } from './rovingTabindex';

function createGroup(count: number): { container: HTMLElement; buttons: HTMLButtonElement[] } {
  const container = document.createElement('div');
  const buttons: HTMLButtonElement[] = [];
  for (let i = 0; i < count; i++) {
    const btn = document.createElement('button');
    btn.textContent = `Item ${i}`;
    container.appendChild(btn);
    buttons.push(btn);
  }
  document.body.appendChild(container);
  return { container, buttons };
}

function pressKey(target: HTMLElement, key: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('rovingTabindex', () => {
  describe('initialization', () => {
    it('sets first item tabindex=0, rest tabindex=-1', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'horizontal', selector: 'button' });
      expect(buttons[0].getAttribute('tabindex')).toBe('0');
      expect(buttons[1].getAttribute('tabindex')).toBe('-1');
      expect(buttons[2].getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('horizontal orientation', () => {
    it('ArrowRight moves to next item', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'horizontal', selector: 'button' });
      buttons[0].focus();
      pressKey(buttons[0], 'ArrowRight');
      expect(document.activeElement).toBe(buttons[1]);
      expect(buttons[1].getAttribute('tabindex')).toBe('0');
      expect(buttons[0].getAttribute('tabindex')).toBe('-1');
    });

    it('ArrowLeft moves to previous item', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'horizontal', selector: 'button' });
      buttons[1].focus();
      // Sync tabindex via focusin
      buttons[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      pressKey(buttons[1], 'ArrowLeft');
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('ArrowRight wraps from last to first', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'horizontal', selector: 'button' });
      buttons[2].focus();
      buttons[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      pressKey(buttons[2], 'ArrowRight');
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('ArrowLeft wraps from first to last', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'horizontal', selector: 'button' });
      buttons[0].focus();
      pressKey(buttons[0], 'ArrowLeft');
      expect(document.activeElement).toBe(buttons[2]);
    });

    it('ignores ArrowUp/ArrowDown', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'horizontal', selector: 'button' });
      buttons[0].focus();
      pressKey(buttons[0], 'ArrowDown');
      expect(document.activeElement).toBe(buttons[0]);
      pressKey(buttons[0], 'ArrowUp');
      expect(document.activeElement).toBe(buttons[0]);
    });
  });

  describe('vertical orientation', () => {
    it('ArrowDown moves to next item', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'vertical', selector: 'button' });
      buttons[0].focus();
      pressKey(buttons[0], 'ArrowDown');
      expect(document.activeElement).toBe(buttons[1]);
    });

    it('ArrowUp moves to previous item', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'vertical', selector: 'button' });
      buttons[1].focus();
      buttons[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      pressKey(buttons[1], 'ArrowUp');
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('wraps around in both directions', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'vertical', selector: 'button' });
      buttons[2].focus();
      buttons[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      pressKey(buttons[2], 'ArrowDown');
      expect(document.activeElement).toBe(buttons[0]);

      pressKey(buttons[0], 'ArrowUp');
      expect(document.activeElement).toBe(buttons[2]);
    });

    it('ignores ArrowLeft/ArrowRight', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'vertical', selector: 'button' });
      buttons[0].focus();
      pressKey(buttons[0], 'ArrowRight');
      expect(document.activeElement).toBe(buttons[0]);
      pressKey(buttons[0], 'ArrowLeft');
      expect(document.activeElement).toBe(buttons[0]);
    });
  });

  describe('grid orientation', () => {
    it('ArrowRight moves within row', () => {
      const { container, buttons } = createGroup(6); // 2x3 grid
      rovingTabindex(container, { orientation: 'grid', selector: 'button', columns: 3 });
      buttons[0].focus();
      pressKey(buttons[0], 'ArrowRight');
      expect(document.activeElement).toBe(buttons[1]);
    });

    it('ArrowDown moves between rows', () => {
      const { container, buttons } = createGroup(6); // 2x3 grid
      rovingTabindex(container, { orientation: 'grid', selector: 'button', columns: 3 });
      buttons[0].focus();
      pressKey(buttons[0], 'ArrowDown');
      expect(document.activeElement).toBe(buttons[3]);
    });

    it('ArrowUp moves between rows', () => {
      const { container, buttons } = createGroup(6);
      rovingTabindex(container, { orientation: 'grid', selector: 'button', columns: 3 });
      buttons[3].focus();
      buttons[3].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      pressKey(buttons[3], 'ArrowUp');
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('wraps within row on ArrowRight', () => {
      const { container, buttons } = createGroup(6);
      rovingTabindex(container, { orientation: 'grid', selector: 'button', columns: 3 });
      buttons[2].focus();
      buttons[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      pressKey(buttons[2], 'ArrowRight');
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('wraps rows in uneven grid', () => {
      const { container, buttons } = createGroup(5); // 2 rows: [0,1,2], [3,4]
      rovingTabindex(container, { orientation: 'grid', selector: 'button', columns: 3 });
      buttons[4].focus();
      buttons[4].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      // ArrowDown from index 4 (row 1, col 1) -> row 0 col 1 = index 1
      pressKey(buttons[4], 'ArrowDown');
      expect(document.activeElement).toBe(buttons[1]);
    });

    it('does not move to out-of-bounds index', () => {
      const { container, buttons } = createGroup(5); // 2 rows: [0,1,2], [3,4]
      rovingTabindex(container, { orientation: 'grid', selector: 'button', columns: 3 });
      buttons[2].focus();
      buttons[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      // ArrowDown from index 2 (row 0, col 2) -> row 1 col 2 = index 5 -> out of bounds
      pressKey(buttons[2], 'ArrowDown');
      // Should stay since index 5 >= items.length
      expect(document.activeElement).toBe(buttons[2]);
    });
  });

  describe('focusin management', () => {
    it('sets focused item to tabindex=0, others to -1', () => {
      const { container, buttons } = createGroup(3);
      rovingTabindex(container, { orientation: 'horizontal', selector: 'button' });
      buttons[2].focus();
      buttons[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(buttons[0].getAttribute('tabindex')).toBe('-1');
      expect(buttons[1].getAttribute('tabindex')).toBe('-1');
      expect(buttons[2].getAttribute('tabindex')).toBe('0');
    });
  });

  describe('update', () => {
    it('re-initializes tabindexes with new options', () => {
      const { container, buttons } = createGroup(3);
      const action = rovingTabindex(container, { orientation: 'horizontal', selector: 'button' });
      // Move focus to item 2
      buttons[2].focus();
      buttons[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(buttons[2].getAttribute('tabindex')).toBe('0');

      // Update resets to first item
      action.update({ orientation: 'vertical', selector: 'button' });
      expect(buttons[0].getAttribute('tabindex')).toBe('0');
      expect(buttons[2].getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('cleanup', () => {
    it('destroy removes listeners', () => {
      const { container, buttons } = createGroup(3);
      const action = rovingTabindex(container, { orientation: 'horizontal', selector: 'button' });
      action.destroy();

      buttons[0].focus();
      pressKey(buttons[0], 'ArrowRight');
      // Focus should not move since listener was removed
      expect(document.activeElement).toBe(buttons[0]);
    });
  });
});
