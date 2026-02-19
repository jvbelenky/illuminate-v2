import { describe, it, expect, vi } from 'vitest';
import { scrollNumber } from './scrollNumber';

function createNumberInput(value = '5', min = '0', max = '100', step = '1'): HTMLInputElement {
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

function wheelUp(target: HTMLElement): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function wheelDown(target: HTMLElement): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function setup(input: HTMLInputElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.appendChild(input);
  scrollNumber(container);
  input.focus();
  return container;
}

describe('scrollNumber', () => {
  describe('number inputs', () => {
    it('increments by 1 for integer values on scroll up', () => {
      const input = createNumberInput('5');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('6');
    });

    it('decrements by 1 for integer values on scroll down', () => {
      const input = createNumberInput('5');
      setup(input);
      wheelDown(input);
      expect(input.value).toBe('4');
    });

    it('steps by 1 for two-digit integer values', () => {
      const input = createNumberInput('45');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('46');
    });

    it('clamps to max', () => {
      const input = createNumberInput('100', '0', '100');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('100');
    });

    it('clamps to min', () => {
      const input = createNumberInput('0', '0', '100');
      setup(input);
      wheelDown(input);
      expect(input.value).toBe('0');
    });

    it('uses step attribute for precision', () => {
      const input = createNumberInput('0.5', '0', '10', '0.1');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('0.6');
    });

    it('uses step attribute 0.01', () => {
      const input = createNumberInput('0.50', '0', '10', '0.01');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('0.51');
    });

    it('uses data-scroll-step override', () => {
      const input = createNumberInput('45');
      input.dataset.scrollStep = '5';
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('50');
    });
  });

  describe('text-decimal inputs', () => {
    it('steps by 0.01 for values like 1.50', () => {
      const input = createTextDecimalInput('1.50');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('1.51');
    });

    it('decrements by 0.01 for values like 1.50', () => {
      const input = createTextDecimalInput('1.50');
      setup(input);
      wheelDown(input);
      expect(input.value).toBe('1.49');
    });

    it('steps by 0.1 for one decimal place', () => {
      const input = createTextDecimalInput('45.0');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('45.1');
    });

    it('steps by 1 for integer values', () => {
      const input = createTextDecimalInput('10');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('11');
    });

    it('steps by 0.01 for values like 0.50', () => {
      const input = createTextDecimalInput('0.50');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('0.51');
    });

    it('steps by 0.01 for values like 0.05', () => {
      const input = createTextDecimalInput('0.05');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('0.06');
    });

    it('steps by 0.01 when value is 0.00', () => {
      const input = createTextDecimalInput('0.00');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('0.01');
    });

    it('uses data-scroll-step override', () => {
      const input = createTextDecimalInput('45.0');
      input.dataset.scrollStep = '1';
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('46.0');
    });

    it('dispatches input and change events', () => {
      const input = createTextDecimalInput('1.50');
      setup(input);
      const inputHandler = vi.fn();
      const changeHandler = vi.fn();
      input.addEventListener('input', inputHandler);
      input.addEventListener('change', changeHandler);

      wheelUp(input);

      expect(inputHandler).toHaveBeenCalled();
      expect(changeHandler).toHaveBeenCalled();
    });

    it('ignores non-numeric values', () => {
      const input = createTextDecimalInput('abc');
      setup(input);
      wheelUp(input);
      expect(input.value).toBe('abc');
    });
  });

  describe('common behavior', () => {
    it('ignores non-number inputs', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'hello';
      container.appendChild(input);
      scrollNumber(container);

      input.focus();
      wheelUp(input);
      expect(input.value).toBe('hello');
    });

    it('ignores unfocused inputs', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createNumberInput('5');
      container.appendChild(input);
      scrollNumber(container);

      // Don't focus
      wheelUp(input);
      expect(input.value).toBe('5');
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
      wheelUp(input);
      expect(input.value).toBe('1.50');
    });

    it('prevents default on wheel event for focused number input', () => {
      const input = createNumberInput('5');
      setup(input);
      const event = wheelUp(input);
      expect(event.defaultPrevented).toBe(true);
    });

    it('prevents default on wheel event for focused text-decimal input', () => {
      const input = createTextDecimalInput('1.50');
      setup(input);
      const event = wheelUp(input);
      expect(event.defaultPrevented).toBe(true);
    });

    it('destroy removes event listener', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const input = createNumberInput('5');
      container.appendChild(input);
      const action = scrollNumber(container);

      action.destroy();
      input.focus();
      wheelUp(input);
      expect(input.value).toBe('5');
    });
  });
});
