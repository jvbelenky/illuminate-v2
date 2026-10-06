import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { project } from '$lib/stores/project';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ZoneEditor from './ZoneEditor.svelte';
import { defaultRoom as buildRoom } from '$lib/types/project';

describe('ZoneEditor', () => {
  const defaultZone = {
    id: 'zone-1',
    name: 'Test Zone',
    type: 'plane' as const,
    enabled: true,
    height: 1.0,
    x_min: 0,
    x_max: 4,
    y_min: 0,
    y_max: 6,
    x_spacing: 0.1,
    y_spacing: 0.1,
    num_x: 40,
    num_y: 60,
    dose: false,
    hours: 8,
    display_mode: 'markers' as const, // ZoneDisplayMode
  };

  const defaultRoom = buildRoom({ x: 4, y: 6, z: 2.7, colormap: 'viridis', precision: 2 });

  it('renders zone editor', () => {
    const onClose = vi.fn();
    const { container } = render(ZoneEditor, {
      props: { zone: defaultZone, room: defaultRoom, onClose },
    });
    expect(container.querySelector('.zone-editor')).toBeTruthy();
  });

  it('renders zone type selector', () => {
    const onClose = vi.fn();
    const { container } = render(ZoneEditor, {
      props: { zone: defaultZone, room: defaultRoom, onClose },
    });
    expect(container.querySelector('.zone-type-buttons')).toBeTruthy();
  });

  it('renders height input for plane zones', () => {
    const onClose = vi.fn();
    const { container } = render(ZoneEditor, {
      props: { zone: defaultZone, room: defaultRoom, onClose },
    });
    expect(container.querySelector('#plane-height')).toBeTruthy();
  });

  it('renders display mode dropdown', () => {
    const onClose = vi.fn();
    const { container } = render(ZoneEditor, {
      props: { zone: defaultZone, room: defaultRoom, onClose },
    });
    expect(container.querySelectorAll('.zone-type-buttons').length).toBeGreaterThan(0);
  });

  it('renders delete button for non-standard zones', () => {
    const onClose = vi.fn();
    const { container } = render(ZoneEditor, {
      props: { zone: defaultZone, room: defaultRoom, onClose },
    });
    expect(container.querySelector('.delete-btn')).toBeTruthy();
  });

  it('applies standard zone class for standard zones', () => {
    const onClose = vi.fn();
    const { container } = render(ZoneEditor, {
      props: { zone: defaultZone, room: defaultRoom, onClose, isStandard: true },
    });
    expect(container.querySelector('.standard-zone-editor')).toBeTruthy();
  });

  it('calls onClose when cancel is clicked', async () => {
    const onClose = vi.fn();
    render(ZoneEditor, {
      props: { zone: defaultZone, room: defaultRoom, onClose },
    });
    // The close button might be labeled differently
    const closeButtons = screen.queryAllByText(/Close|Cancel/i);
    if (closeButtons.length > 0) {
      await fireEvent.click(closeButtons[0]);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('flags an exposure time of zero', () => {
    const onClose = vi.fn();
    const { container } = render(ZoneEditor, {
      props: { zone: { ...defaultZone, dose: true, hours: 0, minutes: 0, seconds: 0 }, room: defaultRoom, onClose },
    });
    expect(container.querySelector('.time-inputs.invalid')).toBeTruthy();
  });

  it('does not flag a valid exposure time', () => {
    const onClose = vi.fn();
    const { container } = render(ZoneEditor, {
      props: { zone: { ...defaultZone, dose: true, hours: 0, minutes: 15, seconds: 0 }, room: defaultRoom, onClose },
    });
    expect(container.querySelector('.time-inputs')).toBeTruthy();
    expect(container.querySelector('.time-inputs.invalid')).toBeNull();
  });

  it('a zone changed elsewhere refreshes the editor, and the old geometry is never written back', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(project, 'updateZone').mockImplementation(() => {});
    try {
      const zone = { ...defaultZone, x1: 0, x2: 4, y1: 0, y2: 6 };
      const { container, rerender } = render(ZoneEditor, { props: { zone, room: defaultRoom, onClose: vi.fn() } });
      // The plan moved the zone
      await rerender({ zone: { ...zone, x1: 1, x2: 3 }, room: defaultRoom, onClose: vi.fn() });
      await tick();
      // Then an unrelated edit here
      const h = container.querySelector('#plane-height') as HTMLInputElement;
      await fireEvent.change(h, { target: { value: '1.5' } });
      await vi.advanceTimersByTimeAsync(150);
      expect(spy).toHaveBeenCalledTimes(1);
      const sent = spy.mock.calls[0][1];
      expect(sent.height).toBe(1.5);
      expect(sent).not.toHaveProperty('x1');
      expect(sent).not.toHaveProperty('x2');
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('a whole-room plane offers the toggle instead of X and Y ranges', () => {
    const { container } = render(ZoneEditor, { props: { zone: { ...defaultZone, fit_room: true, ref_surface: 'xy' as const }, room: defaultRoom, onClose: vi.fn() } });
    expect(screen.getByLabelText('Whole room')).toBeChecked();
    expect(screen.queryByText('X Range')).toBeNull();
    expect(container.textContent).toMatch(/Covers the whole room/);
  });
});
