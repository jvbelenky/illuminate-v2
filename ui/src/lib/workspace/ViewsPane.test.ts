import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Host from './test/ViewsPaneHost.svelte';

function base(over: Record<string, unknown> = {}) {
	return { layout: 'side', swap: false, split: 0.5, inset: null, insetHidden: false, onChange: vi.fn(), ...over };
}

function ptr(type: string, el: Element, x: number, y: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

function rect(el: Element, w: number, h: number) {
	(el as HTMLElement).getBoundingClientRect = () =>
		({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

const slotOf = (id: string) => screen.getByTestId(id).closest('.view-slot') as HTMLElement;

describe('ViewsPane', () => {
	test("keeps each view's DOM node across layout changes", async () => {
		const { rerender, container } = render(Host, base());
		const first2d = screen.getByTestId('v2d');
		const first3d = screen.getByTestId('v3d');
		const slot3d = slotOf('v3d');
		for (const p of [
			{ layout: 'pip-3d' },
			{ layout: 'pip-2d' },
			{ layout: 'pip-3d', insetHidden: true },
			{ layout: 'stack', swap: true },
			{ layout: 'side', swap: false }
		]) {
			await rerender(base(p));
			expect(screen.getByTestId('v3d')).toBe(first3d);
			expect(screen.getByTestId('v2d')).toBe(first2d);
			expect(slotOf('v3d')).toBe(slot3d);
		}
		expect(container.querySelectorAll('[data-testid="v3d"]').length).toBe(1);
		expect(container.querySelectorAll('[data-testid="v2d"]').length).toBe(1);
	});

	test('puts Calculate in the 3D slot, or the 2D slot when 2D is large', async () => {
		const { rerender } = render(Host, base());
		expect(screen.getByText('Calc').closest<HTMLElement>('.view-slot')!.dataset.view).toBe('3d');
		expect(screen.getByText('Calc').closest('.calculate-slot')).not.toBeNull();
		await rerender(base({ layout: 'pip-2d' }));
		expect(screen.getByText('Calc').closest<HTMLElement>('.view-slot')!.dataset.view).toBe('2d');
		await rerender(base({ layout: 'pip-3d' }));
		expect(screen.getByText('Calc').closest<HTMLElement>('.view-slot')!.dataset.view).toBe('3d');
	});

	test('marks the inset slot and renders the divider only for side and stack', async () => {
		const { rerender, container } = render(Host, base({ layout: 'pip-3d' }));
		expect(slotOf('v2d').classList.contains('is-inset')).toBe(true);
		expect(slotOf('v3d').classList.contains('is-inset')).toBe(false);
		expect(container.querySelector('.views-divider')).toBeNull();
		await rerender(base({ layout: 'side' }));
		expect(container.querySelector('.views-divider')).not.toBeNull();
		expect(container.querySelector('.is-inset')).toBeNull();
	});

	test('the inset swap button and a click on the inset body both swap', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: 'pip-3d', onChange }));
		await fireEvent.click(container.querySelector('[data-inset-action="swap"]')!);
		expect(onChange).toHaveBeenLastCalledWith({ layout: 'pip-2d' });
		onChange.mockClear();
		await fireEvent.click(screen.getByTestId('v2d'));
		expect(onChange).toHaveBeenCalledWith({ layout: 'pip-2d' });
	});

	test('swap in side layout reports the toggled swap flag', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: 'pip-2d', onChange }));
		await fireEvent.click(container.querySelector('[data-inset-action="swap"]')!);
		expect(onChange).toHaveBeenLastCalledWith({ layout: 'pip-3d' });
	});

	test('hiding the inset leaves a Show pill that brings it back', async () => {
		const onChange = vi.fn();
		const { container, rerender } = render(Host, base({ layout: 'pip-3d', onChange }));
		await fireEvent.click(container.querySelector('[data-inset-action="hide"]')!);
		expect(onChange).toHaveBeenCalledWith({ insetHidden: true });
		await rerender(base({ layout: 'pip-3d', insetHidden: true, onChange }));
		const pill = screen.getByRole('button', { name: 'Show 2D' });
		expect(pill.classList.contains('inset-show')).toBe(true);
		await fireEvent.click(pill);
		expect(onChange).toHaveBeenLastCalledWith({ insetHidden: false });
		await rerender(base({ layout: 'pip-2d', insetHidden: true, onChange }));
		expect(screen.getByRole('button', { name: 'Show 3D' })).toBeTruthy();
	});

	test('dragging the divider reports a clamped split; double-click resets to 0.5', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ onChange }));
		const root = container.querySelector('.views-pane')!;
		rect(root, 1000, 500);
		const div = container.querySelector('.views-divider')!;
		ptr('pointerdown', div, 500, 100);
		ptr('pointermove', div, 300, 100);
		expect(onChange).not.toHaveBeenCalled();
		ptr('pointerup', div, 300, 100);
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0].split).toBeCloseTo(0.3, 2);
		onChange.mockClear();
		ptr('pointerdown', div, 500, 100);
		ptr('pointermove', div, 990, 100);
		ptr('pointerup', div, 990, 100);
		expect(onChange).toHaveBeenCalledWith({ split: 0.8 });
		onChange.mockClear();
		await fireEvent.dblClick(div);
		expect(onChange).toHaveBeenCalledWith({ split: 0.5 });
	});

	test('dragging the divider in stack layout uses the vertical axis', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: 'stack', onChange }));
		rect(container.querySelector('.views-pane')!, 1000, 500);
		const div = container.querySelector('.views-divider')!;
		ptr('pointerdown', div, 500, 250);
		ptr('pointermove', div, 500, 100);
		ptr('pointerup', div, 500, 100);
		expect(onChange.mock.calls[0][0].split).toBeCloseTo(0.2, 2);
	});

	test('dragging the inset bar reports a clamped position', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: 'pip-3d', onChange }));
		rect(container.querySelector('.views-pane')!, 800, 600);
		const slot = slotOf('v2d');
		rect(slot, 240, 204);
		const bar = container.querySelector('.inset-bar')!;
		ptr('pointerdown', bar, 100, 100);
		ptr('pointermove', bar, 5000, 5000);
		ptr('pointerup', bar, 5000, 5000);
		expect(onChange).toHaveBeenCalledTimes(1);
		const { inset } = onChange.mock.calls[0][0];
		expect(inset.x).toBeLessThanOrEqual(800 - 240);
		expect(inset.y).toBeLessThanOrEqual(600 - 204);
		expect(inset.x).toBeGreaterThan(0);
		// a drag is not a click-to-swap
		await fireEvent.click(bar);
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	test('renders defaults for garbage layout inputs', async () => {
		const { container } = render(
			Host,
			base({ layout: 'bogus', split: Number.NaN, inset: { x: Number.NaN, y: 3 } })
		);
		const root = container.querySelector('.views-pane') as HTMLElement;
		expect(root.dataset.layout).toBe('side');
		expect(container.querySelector('.views-divider')).not.toBeNull();
		expect(slotOf('v2d').style.width).toContain('calc');
		expect(slotOf('v2d').style.width).toContain('50%');
		const { container: c2 } = render(Host, base({ layout: 'pip-3d', inset: { x: Number.NaN, y: 3 } }));
		const inset = c2.querySelector('.is-inset') as HTMLElement;
		expect(inset.style.right).toBe('14px');
		expect(inset.style.bottom).toBe('14px');
	});
});
