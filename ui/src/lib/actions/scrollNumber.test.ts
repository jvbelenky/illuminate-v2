import { describe, it, expect, vi } from 'vitest';
import { scrollNumber } from './scrollNumber';

function createNumberInput(value = '5', min = '0', max = '10', step = '1'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = value;
  input.min = min;
  input.max = max;
  input.step = step;
  document.body.appendChild(input);
  return input;
}

function wheelEvent(deltaY: number, target: HTMLElement): WheelEvent {
  return new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...({ target } as any) });
}

describe('scrollNumber', () => {
  it('calls stepUp on scroll up (negative deltaY)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const input = createNumberInput('5');
    container.appendChild(input);
    scrollNumber(container);

    input.focus();
    const spy = vi.spyOn(input, 'stepUp');
    const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('calls stepDown on scroll down (positive deltaY)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const input = createNumberInput('5');
    container.appendChild(input);
    scrollNumber(container);

    input.focus();
    const spy = vi.spyOn(input, 'stepDown');
    const event = new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('ignores non-number inputs', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'hello';
    container.appendChild(input);
    scrollNumber(container);

    input.focus();
    const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    // Should not throw or change value
    expect(input.value).toBe('hello');
  });

  it('ignores unfocused inputs', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const input = createNumberInput('5');
    container.appendChild(input);
    scrollNumber(container);

    // Don't focus the input
    const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(input.value).toBe('5');
  });

  it('prevents default on wheel event for focused number input', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const input = createNumberInput('5');
    container.appendChild(input);
    scrollNumber(container);

    input.focus();
    const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('dispatches input and change events on value change', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const input = createNumberInput('5');
    container.appendChild(input);
    scrollNumber(container);

    input.focus();
    const inputHandler = vi.fn();
    const changeHandler = vi.fn();
    input.addEventListener('input', inputHandler);
    input.addEventListener('change', changeHandler);

    const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(inputHandler).toHaveBeenCalled();
    expect(changeHandler).toHaveBeenCalled();
  });

  it('destroy removes event listener', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const input = createNumberInput('5');
    container.appendChild(input);
    const action = scrollNumber(container);

    action.destroy();
    input.focus();
    const spy = vi.spyOn(input, 'stepUp');
    const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(spy).not.toHaveBeenCalled();
  });
});
