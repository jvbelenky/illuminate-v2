import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RoomEditor from './RoomEditor.svelte';

describe('RoomEditor', () => {
  it('renders room editor', () => {
    const { container } = render(RoomEditor);
    expect(container.querySelector('.room-editor')).toBeTruthy();
  });

  it('renders dimensions label', () => {
    render(RoomEditor);
    expect(screen.getByText('Dimensions')).toBeTruthy();
  });

  it('renders units selector', () => {
    const { container } = render(RoomEditor);
    const selects = container.querySelectorAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });

  it('renders reflectance toggle', () => {
    const { container } = render(RoomEditor);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThanOrEqual(1);
  });

  it('renders form groups', () => {
    const { container } = render(RoomEditor);
    const groups = container.querySelectorAll('.form-group');
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });
});
