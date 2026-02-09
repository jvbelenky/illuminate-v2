import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import AlertDialog from './AlertDialog.svelte';

describe('AlertDialog', () => {
  const defaultProps = {
    title: 'Error Title',
    message: 'Something went wrong',
    onDismiss: vi.fn(),
  };

  it('renders title and message', () => {
    render(AlertDialog, { props: defaultProps });
    expect(screen.getByText('Error Title')).toBeTruthy();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('uses default button label "OK"', () => {
    render(AlertDialog, { props: defaultProps });
    expect(screen.getByText('OK')).toBeTruthy();
  });

  it('renders custom button label', () => {
    render(AlertDialog, { props: { ...defaultProps, buttonLabel: 'Got it' } });
    expect(screen.getByText('Got it')).toBeTruthy();
  });

  it('calls onDismiss when button clicked', async () => {
    const onDismiss = vi.fn();
    render(AlertDialog, { props: { ...defaultProps, onDismiss } });
    await fireEvent.click(screen.getByText('OK'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('calls onDismiss on Escape key', async () => {
    const onDismiss = vi.fn();
    const { container } = render(AlertDialog, { props: { ...defaultProps, onDismiss } });
    const backdrop = container.querySelector('.modal-backdrop')!;
    await fireEvent.keyDown(backdrop, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('has dialog role', () => {
    render(AlertDialog, { props: defaultProps });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
