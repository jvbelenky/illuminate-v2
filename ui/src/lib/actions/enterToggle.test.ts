import { describe, it, expect, vi } from 'vitest';
import { enterToggle } from './enterToggle';

function createCheckbox(checked = false): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  document.body.appendChild(input);
  return input;
}

describe('enterToggle', () => {
  it('toggles unchecked to checked on Enter', () => {
    const input = createCheckbox(false);
    enterToggle(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(input.checked).toBe(true);
  });

  it('toggles checked to unchecked on Enter', () => {
    const input = createCheckbox(true);
    enterToggle(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(input.checked).toBe(false);
  });

  it('dispatches change event on toggle', () => {
    const input = createCheckbox(false);
    enterToggle(input);
    const handler = vi.fn();
    input.addEventListener('change', handler);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispatches input event on toggle', () => {
    const input = createCheckbox(false);
    enterToggle(input);
    const handler = vi.fn();
    input.addEventListener('input', handler);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('prevents default on Enter', () => {
    const input = createCheckbox(false);
    enterToggle(input);
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not toggle on other keys', () => {
    const input = createCheckbox(false);
    enterToggle(input);
    for (const key of ['Space', 'Tab', 'a', 'Escape']) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(input.checked).toBe(false);
  });

  it('destroy removes event listener', () => {
    const input = createCheckbox(false);
    const action = enterToggle(input);
    action.destroy();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(input.checked).toBe(false);
  });
});
