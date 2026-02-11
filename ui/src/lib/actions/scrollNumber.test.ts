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

function createTextDecimalInput(value = '1.50'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.value = value;
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

  describe('text-decimal inputs', () => {
    it('increments on scroll up with correct decimal places', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createTextDecimalInput('1.50');
      container.appendChild(input);
      scrollNumber(container);

      input.focus();
      const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(input.value).toBe('1.51');
    });

    it('decrements on scroll down with correct decimal places', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createTextDecimalInput('1.50');
      container.appendChild(input);
      scrollNumber(container);

      input.focus();
      const event = new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(input.value).toBe('1.49');
    });

    it('infers step 0.1 for one decimal place', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createTextDecimalInput('45.0');
      container.appendChild(input);
      scrollNumber(container);

      input.focus();
      const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(input.value).toBe('45.1');
    });

    it('infers step 1 for integer values', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createTextDecimalInput('10');
      container.appendChild(input);
      scrollNumber(container);

      input.focus();
      const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(input.value).toBe('11');
    });

    it('dispatches input and change events', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createTextDecimalInput('1.50');
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

    it('prevents default on wheel event', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createTextDecimalInput('1.50');
      container.appendChild(input);
      scrollNumber(container);

      input.focus();
      const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores unfocused text-decimal inputs', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createTextDecimalInput('1.50');
      container.appendChild(input);
      scrollNumber(container);

      // Don't focus
      const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(input.value).toBe('1.50');
    });

    it('ignores text inputs without inputmode="decimal"', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = document.createElement('input');
      input.type = 'text';
      input.value = '1.50';
      container.appendChild(input);
      scrollNumber(container);

      input.focus();
      const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(input.value).toBe('1.50');
    });

    it('uses data-scroll-step override when present', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createTextDecimalInput('45.0');
      input.dataset.scrollStep = '1';
      container.appendChild(input);
      scrollNumber(container);

      input.focus();
      const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(input.value).toBe('46.0');
    });

    it('ignores non-numeric values', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createTextDecimalInput('abc');
      container.appendChild(input);
      scrollNumber(container);

      input.focus();
      const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(input.value).toBe('abc');
    });
  });
});
