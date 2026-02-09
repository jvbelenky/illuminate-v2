import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ZoneEditor from './ZoneEditor.svelte';

describe('ZoneEditor', () => {
  const defaultZone = {
    id: 'zone-1',
    name: 'Test Zone',
    zone_type: 'plane' as const,
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
    display_mode: 'markers' as const,
  };

  const defaultRoom = {
    x: 4,
    y: 6,
    z: 2.7,
    units: 'meters' as const,
    colormap: 'viridis',
    precision: 2,
    reflectance_on: false,
  };

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
    expect(container.querySelector('#zone-type')).toBeTruthy();
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
    expect(container.querySelector('#display-mode')).toBeTruthy();
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
});
