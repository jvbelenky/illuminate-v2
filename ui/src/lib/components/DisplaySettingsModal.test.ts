import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DisplaySettingsModal from './DisplaySettingsModal.svelte';

describe('DisplaySettingsModal', () => {
  it('renders modal with title', () => {
    const onClose = vi.fn();
    render(DisplaySettingsModal, { props: { onClose } });
    expect(screen.getByText(/Display Settings/i)).toBeTruthy();
  });

  it('renders theme toggle buttons', () => {
    const onClose = vi.fn();
    const { container } = render(DisplaySettingsModal, { props: { onClose } });
    const themeButtons = container.querySelectorAll('.theme-btn');
    expect(themeButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders colormap dropdown', () => {
    const onClose = vi.fn();
    const { container } = render(DisplaySettingsModal, { props: { onClose } });
    expect(container.querySelector('#colormap')).toBeTruthy();
  });

  it('renders precision input', () => {
    const onClose = vi.fn();
    const { container } = render(DisplaySettingsModal, { props: { onClose } });
    expect(container.querySelector('#precision')).toBeTruthy();
  });

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn();
    const { container } = render(DisplaySettingsModal, { props: { onClose } });
    const backdrop = container.querySelector('.modal-backdrop')!;
    await fireEvent.keyDown(backdrop, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
