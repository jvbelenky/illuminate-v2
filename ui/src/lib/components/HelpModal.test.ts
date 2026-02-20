import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import HelpModal from './HelpModal.svelte';

describe('HelpModal', () => {
  it('renders help title', () => {
    const onClose = vi.fn();
    render(HelpModal, { props: { onClose } });
    expect(screen.getByText('Help')).toBeTruthy();
  });

  it('renders help sections', () => {
    const onClose = vi.fn();
    render(HelpModal, { props: { onClose } });
    expect(screen.getByText('Room')).toBeTruthy();
    expect(screen.getByText('Lamps')).toBeTruthy();
    expect(screen.getByText('Zones')).toBeTruthy();
    expect(screen.getByText('Calculate')).toBeTruthy();
  });

  it('renders 3D controls section', () => {
    const onClose = vi.fn();
    render(HelpModal, { props: { onClose } });
    expect(screen.getByText('3D Controls')).toBeTruthy();
  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(HelpModal, { props: { onClose } });
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    await fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn();
    const { container } = render(HelpModal, { props: { onClose } });
    const backdrop = container.querySelector('.modal-backdrop')!;
    await fireEvent.keyDown(backdrop, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
