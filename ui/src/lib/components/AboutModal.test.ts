import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import AboutModal from './AboutModal.svelte';

describe('AboutModal', () => {
  it('renders modal with title', () => {
    const onClose = vi.fn();
    render(AboutModal, { props: { onClose } });
    expect(screen.getByText('About Illuminate')).toBeTruthy();
  });

  it('renders key content sections', () => {
    const onClose = vi.fn();
    render(AboutModal, { props: { onClose } });
    expect(screen.getByText(/Open Source/)).toBeTruthy();
  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(AboutModal, { props: { onClose } });
    const closeBtn = screen.getByRole('button');
    await fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn();
    const { container } = render(AboutModal, { props: { onClose } });
    const backdrop = container.querySelector('.modal-backdrop')!;
    await fireEvent.keyDown(backdrop, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('has dialog role and aria attributes', () => {
    const onClose = vi.fn();
    render(AboutModal, { props: { onClose } });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
