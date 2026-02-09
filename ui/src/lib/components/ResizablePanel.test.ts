import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ResizablePanel from './ResizablePanel.svelte';

describe('ResizablePanel', () => {
  it('renders with left side class', () => {
    const { container } = render(ResizablePanel, { props: { side: 'left' } });
    expect(container.querySelector('.resizable-panel.left')).toBeTruthy();
  });

  it('renders with right side class', () => {
    const { container } = render(ResizablePanel, { props: { side: 'right' } });
    expect(container.querySelector('.resizable-panel.right')).toBeTruthy();
  });

  it('has collapse toggle button', () => {
    const { container } = render(ResizablePanel, { props: { side: 'left' } });
    expect(container.querySelector('.collapse-toggle')).toBeTruthy();
  });

  it('has resize handle', () => {
    const { container } = render(ResizablePanel, { props: { side: 'left' } });
    expect(container.querySelector('.resize-handle')).toBeTruthy();
  });

  it('applies collapsed class when collapsed', () => {
    const { container } = render(ResizablePanel, {
      props: { side: 'left', collapsed: true },
    });
    expect(container.querySelector('.resizable-panel.collapsed')).toBeTruthy();
  });

  it('toggles collapsed state on button click', async () => {
    const { container } = render(ResizablePanel, {
      props: { side: 'left', collapsed: false },
    });
    const toggle = container.querySelector('.collapse-toggle')!;
    await fireEvent.click(toggle);
    expect(container.querySelector('.resizable-panel.collapsed')).toBeTruthy();
  });
});
