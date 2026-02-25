import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ConfirmDialog from './ConfirmDialog.svelte';

describe('ConfirmDialog', () => {
  const defaultProps = {
    title: 'Delete Item',
    message: 'Are you sure?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders title and message', () => {
    render(ConfirmDialog, { props: defaultProps });
    expect(screen.getByText('Delete Item')).toBeTruthy();
    expect(screen.getByText('Are you sure?')).toBeTruthy();
  });

  it('renders default button labels', () => {
    render(ConfirmDialog, { props: defaultProps });
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('renders custom button labels', () => {
    render(ConfirmDialog, { props: { ...defaultProps, confirmLabel: 'Yes', cancelLabel: 'No' } });
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
  });

  it('calls onConfirm when confirm button clicked', async () => {
    const onConfirm = vi.fn();
    render(ConfirmDialog, { props: { ...defaultProps, onConfirm } });
    await fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button clicked', async () => {
    const onCancel = vi.fn();
    render(ConfirmDialog, { props: { ...defaultProps, onCancel } });
    await fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel on Escape key', async () => {
    const onCancel = vi.fn();
    const { container } = render(ConfirmDialog, { props: { ...defaultProps, onCancel } });
    const backdrop = container.querySelector('.modal-backdrop')!;
    await fireEvent.keyDown(backdrop, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onConfirm on Enter key', async () => {
    const onConfirm = vi.fn();
    render(ConfirmDialog, { props: { ...defaultProps, onConfirm } });
    await fireEvent.keyDown(window, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalled();
  });
});
