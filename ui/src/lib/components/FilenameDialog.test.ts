import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FilenameDialog from './FilenameDialog.svelte';

describe('FilenameDialog', () => {
  function setup(suggested = 'Lab 3') {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(FilenameDialog, { props: { suggested, onSave, onCancel } });
    const input = screen.getByLabelText('File name') as HTMLInputElement;
    return { onSave, onCancel, input };
  }

  it('starts with the suggested name, focused', () => {
    const { input } = setup();
    expect(input.value).toBe('Lab 3');
    expect(document.activeElement).toBe(input);
  });

  it('saves the edited name, trimmed, on the button or Enter', async () => {
    const { onSave, input } = setup();
    await fireEvent.input(input, { target: { value: '  lab-3-final ' } });
    await fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenLastCalledWith('lab-3-final');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('does not save an empty name', async () => {
    const { onSave, input } = setup();
    await fireEvent.input(input, { target: { value: '   ' } });
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('cancels', async () => {
    const { onCancel } = setup();
    await fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
