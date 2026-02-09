import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CalcPlanePlotModal from './CalcPlanePlotModal.svelte';

// Mock canvas getContext since jsdom doesn't support it
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  putImageData: vi.fn(),
  createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  fillText: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  transform: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  font: '',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  textAlign: '',
  textBaseline: '',
  canvas: { width: 0, height: 0 },
})) as any;

describe('CalcPlanePlotModal', () => {
  const defaultProps = {
    zone: {
      id: 'zone-1',
      name: 'Test Plane',
      zone_type: 'plane' as const,
      height: 1.0,
      x_min: 0,
      x_max: 4,
      y_min: 0,
      y_max: 6,
      dose: false,
    },
    zoneName: 'Test Plane',
    room: {
      x: 4,
      y: 6,
      z: 2.7,
      units: 'meters' as const,
      colormap: 'viridis',
      precision: 2,
    },
    values: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    onclose: vi.fn(),
  };

  it('renders modal with zone name', () => {
    render(CalcPlanePlotModal, { props: defaultProps });
    expect(screen.getByText(/Test Plane/)).toBeTruthy();
  });

  it('renders canvas element', () => {
    const { container } = render(CalcPlanePlotModal, { props: defaultProps });
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('renders export buttons', () => {
    const { container } = render(CalcPlanePlotModal, { props: defaultProps });
    const buttons = container.querySelectorAll('.export-btn, button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('calls onclose on Escape key', async () => {
    const onclose = vi.fn();
    const { container } = render(CalcPlanePlotModal, { props: { ...defaultProps, onclose } });
    const backdrop = container.querySelector('.modal-backdrop')!;
    await fireEvent.keyDown(backdrop, { key: 'Escape' });
    expect(onclose).toHaveBeenCalled();
  });
});
