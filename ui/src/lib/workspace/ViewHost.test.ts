import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Host from './test/ViewHostHost.svelte';

function anchor(l: number, t: number, w: number, h: number): HTMLElement {
	const el = document.createElement('div');
	el.getBoundingClientRect = () =>
		({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON() {} }) as DOMRect;
	document.body.appendChild(el);
	return el;
}

function base(over: Record<string, unknown> = {}) {
	return {
		main: '2d',
		mainAnchor: anchor(300, 0, 600, 600),
		miniAnchor: anchor(900, 26, 300, 225),
		miniVisible: true,
		...over
	};
}

const slotOf = (id: string) => screen.getByTestId(id).closest('.view-slot') as HTMLElement;

describe('ViewHost', () => {
	test('renders each view once and passes mini to the docked one', () => {
		const { container } = render(Host, base());
		expect(container.querySelectorAll('[data-testid="v2d"]').length).toBe(1);
		expect(container.querySelectorAll('[data-testid="v3d"]').length).toBe(1);
		expect(screen.getByTestId('v2d').dataset.mini).toBe('false');
		expect(screen.getByTestId('v3d').dataset.mini).toBe('true');
		expect(slotOf('v3d').classList.contains('mini')).toBe(true);
		expect(slotOf('v2d').classList.contains('mini')).toBe(false);
		expect(slotOf('v2d').dataset.view).toBe('2d');
		expect(slotOf('v3d').dataset.view).toBe('3d');
	});

	test('places each slot over its anchor', () => {
		render(Host, base());
		const main = slotOf('v2d');
		const mini = slotOf('v3d');
		expect(main.style.left).toBe('300px');
		expect(main.style.width).toBe('600px');
		expect(mini.style.left).toBe('900px');
		expect(mini.style.top).toBe('26px');
		expect(mini.style.height).toBe('225px');
	});

	test('swapping main keeps the same DOM nodes', async () => {
		const props = base();
		const { rerender } = render(Host, props);
		const slot3d = slotOf('v3d');
		const view3d = screen.getByTestId('v3d');
		expect(slot3d.classList.contains('mini')).toBe(true);
		await rerender({ ...props, main: '3d' });
		expect(slotOf('v3d')).toBe(slot3d);
		expect(screen.getByTestId('v3d')).toBe(view3d);
		expect(slot3d.classList.contains('mini')).toBe(false);
		expect(slotOf('v2d').classList.contains('mini')).toBe(true);
		expect(screen.getByTestId('v2d').dataset.mini).toBe('true');
		expect(screen.getByTestId('v3d').dataset.mini).toBe('false');
		// The 3D slot now sits over the main anchor
		expect(slot3d.style.left).toBe('300px');
	});

	test('clicking the mini slot does not swap views', async () => {
		render(Host, base());
		const mini = slotOf('v3d');
		await fireEvent.pointerDown(mini, { clientX: 950, clientY: 100 });
		await fireEvent.pointerUp(mini, { clientX: 950, clientY: 100 });
		await fireEvent.click(screen.getByTestId('v3d'));
		expect(mini.classList.contains('mini')).toBe(true);
		expect(screen.getByTestId('v3d').dataset.mini).toBe('true');
		expect(mini.style.visibility).not.toBe('hidden');
	});

	test('hidden mini stays mounted', async () => {
		const props = base();
		const { rerender } = render(Host, props);
		const view3d = screen.getByTestId('v3d');
		await rerender({ ...props, miniVisible: false, miniAnchor: undefined });
		expect(screen.getByTestId('v3d')).toBe(view3d);
		expect(slotOf('v3d').style.visibility).toBe('hidden');
		expect(slotOf('v2d').style.visibility).not.toBe('hidden');
		await rerender({ ...props, miniVisible: true });
		expect(screen.getByTestId('v3d')).toBe(view3d);
		expect(slotOf('v3d').style.visibility).not.toBe('hidden');
	});
});
