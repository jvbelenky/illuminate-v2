import { describe, test, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Host from './test/DockAreaHost.svelte';
import { DEFAULT_DOCK } from './dockLayout';

const titles = { editor: 'Editor', results: 'Results', mini: '3D', calculate: 'Calculate' };

function base(over: Record<string, unknown> = {}) {
	return {
		layout: { ...DEFAULT_DOCK, left: ['editor'], right: ['mini', 'calculate', 'results'], minimized: [] },
		onChange: vi.fn(),
		titles,
		...over
	};
}

function ptr(type: string, el: Element | Window, x: number, y: number, button = 0) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

function rect(el: Element, l: number, t: number, w: number, h: number) {
	(el as HTMLElement).getBoundingClientRect = () =>
		({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON() {} }) as DOMRect;
}

const panelEl = (c: HTMLElement, id: string) => c.querySelector(`[data-panel=${id}]`) as HTMLElement;
const colEl = (c: HTMLElement, col: string) => c.querySelector(`.dock-column[data-column=${col}]`) as HTMLElement;

function mockGeometry(c: HTMLElement) {
	rect(colEl(c, 'left'), 0, 0, 300, 600);
	rect(colEl(c, 'right'), 900, 0, 300, 600);
	rect(panelEl(c, 'editor'), 0, 0, 300, 600);
	rect(panelEl(c, 'mini'), 900, 0, 300, 225);
	rect(panelEl(c, 'results'), 900, 225, 300, 375);
}

describe('DockArea', () => {
	test('renders panels in their columns in order', () => {
		const { container } = render(Host, base());
		const ids = (col: string) =>
			[...colEl(container, col).querySelectorAll('[data-panel]')].map((e) => (e as HTMLElement).dataset.panel);
		expect(ids('left')).toEqual(['editor']);
		expect(ids('right')).toEqual(['mini', 'calculate', 'results']);
		expect(screen.getByTestId('main-view')).toBeTruthy();
		expect(colEl(container, 'left').style.width).toBe('420px');
	});

	test('Calculate is its own panel, and a compact button shows in its bar when minimized', () => {
		const open = render(Host, base({ withCalculate: true }));
		const calc = panelEl(open.container, 'calculate');
		expect(calc.querySelector('.dock-content button.calculate-btn')).not.toBeNull();
		expect(calc.querySelector('.dock-bar button.calculate-btn')).toBeNull();
		expect(panelEl(open.container, 'results').querySelector('button.calculate-btn')).toBeNull();
		expect(panelEl(open.container, 'editor').querySelector('button.calculate-btn')).toBeNull();
		expect(open.container.querySelectorAll('button.calculate-btn').length).toBe(1);
		open.unmount();
		const min = render(Host, base({ withCalculate: true, layout: { ...DEFAULT_DOCK, minimized: ['calculate'] } }));
		const calc2 = panelEl(min.container, 'calculate');
		expect(calc2.querySelector('.dock-bar button.calculate-btn')).not.toBeNull();
		expect(calc2.querySelector('.dock-content')).toBeNull();
		expect(min.container.querySelectorAll('button.calculate-btn').length).toBe(1);
	});

	test('minimize hides content and keeps the bar', () => {
		const { container } = render(Host, base({ layout: { ...DEFAULT_DOCK, minimized: ['results'] } }));
		expect(screen.queryByTestId('content-results')).toBeNull();
		expect(container.querySelector('[data-panel=results] .dock-bar')).not.toBeNull();
		expect(screen.getByTestId('content-editor')).toBeTruthy();
	});

	test('the minimize button reports the toggled layout', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ onChange }));
		await fireEvent.click(container.querySelector('[data-panel=results] button[aria-label="Minimize"]')!);
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minimized: ['results'] }));
	});

	test('drag results bar to the left column below editor', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ onChange }));
		mockGeometry(container);
		const bar = container.querySelector('[data-panel=results] .dock-bar')!;
		ptr('pointerdown', bar, 1000, 240);
		ptr('pointermove', bar, 500, 400);
		ptr('pointermove', bar, 150, 450);
		await tick();
		expect(container.querySelector('.dock-drop.on')).not.toBeNull();
		ptr('pointerup', bar, 150, 450);
		expect(onChange).toHaveBeenCalledTimes(1);
		const l = onChange.mock.calls[0][0];
		expect(l.left).toEqual(['editor', 'results']);
		expect(l.right).toEqual(['mini', 'calculate']);
	});

	test('a click on the bar without movement does not move the panel', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ onChange }));
		mockGeometry(container);
		const bar = container.querySelector('[data-panel=results] .dock-bar')!;
		ptr('pointerdown', bar, 1000, 240);
		ptr('pointermove', bar, 1001, 241);
		await tick();
		expect(container.querySelector('.dock-ghost')).toBeNull();
		ptr('pointerup', bar, 1001, 241);
		expect(onChange).not.toHaveBeenCalled();
	});

	test('empty column has zero width and shows an edge drop strip while dragging', async () => {
		const onChange = vi.fn();
		const layout = { ...DEFAULT_DOCK, left: [], right: ['editor', 'mini', 'results'] };
		const { container } = render(Host, base({ layout, onChange }));
		expect(colEl(container, 'left').style.width).toBe('0px');
		expect(container.querySelector('.dock-edge')).toBeNull();
		rect(colEl(container, 'left'), 0, 0, 0, 600);
		rect(colEl(container, 'right'), 900, 0, 300, 600);
		rect(panelEl(container, 'editor'), 900, 0, 300, 200);
		rect(panelEl(container, 'mini'), 900, 200, 300, 225);
		rect(panelEl(container, 'results'), 900, 425, 300, 175);
		const bar = container.querySelector('[data-panel=editor] .dock-bar')!;
		ptr('pointerdown', bar, 1000, 10);
		ptr('pointermove', bar, 500, 100);
		await tick();
		const edge = container.querySelector('.dock-edge[data-column=left]') as HTMLElement;
		expect(edge).not.toBeNull();
		rect(edge, 300, 0, 24, 600);
		ptr('pointermove', bar, 310, 100);
		await tick();
		expect(edge.querySelector('.dock-drop.on')).not.toBeNull();
		ptr('pointerup', bar, 310, 100);
		expect(onChange.mock.calls[0][0].left).toEqual(['editor']);
		expect(onChange.mock.calls[0][0].right).toEqual(['mini', 'results']);
	});

	test('only the primary button drags a panel', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ onChange }));
		mockGeometry(container);
		const bar = container.querySelector('[data-panel=results] .dock-bar')!;
		ptr('pointerdown', bar, 1000, 240, 2);
		ptr('pointermove', bar, 150, 450);
		await tick();
		expect(container.querySelector('.dock-ghost')).toBeNull();
		ptr('pointerup', bar, 150, 450);
		expect(onChange).not.toHaveBeenCalled();
	});

	test('a gutter on each filled column drags its width, committed on release', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ onChange }));
		const left = container.querySelector('.dock-gutter[data-column=left]') as HTMLElement;
		const right = container.querySelector('.dock-gutter[data-column=right]') as HTMLElement;
		expect(left.getAttribute('role')).toBe('separator');
		expect(right).not.toBeNull();
		ptr('pointerdown', left, 300, 200);
		ptr('pointermove', window, 380, 200);
		await tick();
		// Live while dragging, stored on release
		expect(colEl(container, 'left').style.width).toBe('500px');
		expect(onChange).not.toHaveBeenCalled();
		ptr('pointerup', window, 380, 200);
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0].widths).toEqual({ left: 500 });
		// The right gutter grows its column as it moves left, within the limits
		ptr('pointerdown', right, 900, 200);
		ptr('pointermove', window, 100, 200);
		ptr('pointerup', window, 100, 200);
		expect(onChange.mock.calls[1][0].widths).toEqual({ right: 600 });
	});

	test('the column shows a stored width; double-clicking its gutter resets it', async () => {
		const onChange = vi.fn();
		const layout = { ...DEFAULT_DOCK, widths: { left: 450 } };
		const { container } = render(Host, base({ layout, onChange }));
		expect(colEl(container, 'left').style.width).toBe('450px');
		expect(colEl(container, 'right').style.width).toBe('420px');
		await fireEvent.dblClick(container.querySelector('.dock-gutter[data-column=left]')!);
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0].widths).toBeUndefined();
	});

	test('arrow keys on a focused gutter resize its column', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ onChange }));
		const left = container.querySelector('.dock-gutter[data-column=left]') as HTMLElement;
		await fireEvent.keyDown(left, { key: 'ArrowRight' });
		expect(onChange.mock.calls[0][0].widths).toEqual({ left: 436 });
	});

	test('an empty column has no gutter', () => {
		const layout = { ...DEFAULT_DOCK, left: [], right: ['editor', 'mini', 'results'] };
		const { container } = render(Host, base({ layout }));
		expect(container.querySelector('.dock-gutter[data-column=left]')).toBeNull();
		expect(container.querySelector('.dock-gutter[data-column=right]')).not.toBeNull();
	});

	test('swap button calls onSwap', async () => {
		const onSwap = vi.fn();
		const { container } = render(Host, base({ onSwap }));
		await fireEvent.click(container.querySelector('[data-panel=mini] button[aria-label="Swap views"]')!);
		expect(onSwap).toHaveBeenCalledTimes(1);
		expect(container.querySelectorAll('button[aria-label="Swap views"]').length).toBe(1);
	});
});

describe('DockArea: a floating mini view', () => {
	const floating = (f = { x: 100, y: 50, w: 300, h: 225 }, over: Record<string, unknown> = {}) => ({
		...DEFAULT_DOCK,
		left: ['editor'],
		right: ['results'],
		minimized: [],
		float: f,
		...over
	});
	const areaEl = (c: HTMLElement) => c.querySelector('.dock-area') as HTMLElement;
	const floatEl = (c: HTMLElement) => c.querySelector('.dock-float') as HTMLElement;

	function floatGeometry(c: HTMLElement) {
		rect(areaEl(c), 0, 0, 1200, 600);
		rect(colEl(c, 'left'), 0, 0, 300, 600);
		rect(colEl(c, 'right'), 900, 0, 300, 600);
		rect(panelEl(c, 'editor'), 0, 0, 300, 600);
		rect(panelEl(c, 'results'), 900, 0, 300, 600);
	}

	test('a drag of the docked mini bar released over the main view floats it there', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ onChange }));
		mockGeometry(container);
		rect(areaEl(container), 0, 0, 1200, 600);
		const bar = container.querySelector('[data-panel=mini] .dock-bar')!;
		ptr('pointerdown', bar, 1000, 10);
		ptr('pointermove', bar, 800, 200);
		ptr('pointermove', bar, 600, 300);
		await tick();
		expect(container.querySelector('.dock-drop.on')).toBeNull();
		ptr('pointerup', bar, 600, 300);
		expect(onChange).toHaveBeenCalledTimes(1);
		const l = onChange.mock.calls[0][0];
		expect(l.right).toEqual(['calculate', 'results']);
		expect(l.left).toEqual(['editor']);
		// The grab point stays under the pointer
		expect(l.float).toEqual({ x: 500, y: 290, w: 300, h: 225 });
	});

	test('the editor and results do not float', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ onChange }));
		mockGeometry(container);
		rect(areaEl(container), 0, 0, 1200, 600);
		const bar = container.querySelector('[data-panel=results] .dock-bar')!;
		ptr('pointerdown', bar, 1000, 240);
		ptr('pointermove', bar, 600, 300);
		ptr('pointerup', bar, 600, 300);
		expect(onChange).not.toHaveBeenCalled();
	});

	test('a floating mini view is a window with its bar, out of the columns', () => {
		const { container } = render(Host, base({ layout: floating() }));
		const win = floatEl(container);
		expect(win).not.toBeNull();
		expect(win.style.left).toBe('100px');
		expect(win.style.top).toBe('50px');
		expect(win.style.width).toBe('300px');
		expect(win.style.height).toBe('225px');
		expect(win.querySelector('[data-panel=mini] .dock-bar .dock-title')!.textContent).toBe('3D');
		expect(win.querySelector('button[aria-label="Swap views"]')).not.toBeNull();
		expect(win.querySelector('button[aria-label="Minimize"]')).not.toBeNull();
		expect(colEl(container, 'right').querySelector('[data-panel=mini]')).toBeNull();
		expect(screen.getByTestId('content-mini')).toBeTruthy();
	});

	test('minimized, it keeps only its bar where it floats', () => {
		const { container } = render(Host, base({ layout: floating(undefined, { minimized: ['mini'] }) }));
		const win = floatEl(container);
		expect(win.style.left).toBe('100px');
		expect(win.style.height).toBe('');
		expect(screen.queryByTestId('content-mini')).toBeNull();
		expect(container.querySelector('.dock-float-resize')).toBeNull();
	});

	test('dragging the floating bar moves it, live, and stores it on release', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: floating(), onChange }));
		floatGeometry(container);
		const bar = floatEl(container).querySelector('.dock-bar')!;
		ptr('pointerdown', bar, 450, 60);
		ptr('pointermove', bar, 500, 110);
		ptr('pointermove', bar, 550, 160);
		await tick();
		expect(floatEl(container).style.left).toBe('200px');
		expect(floatEl(container).style.top).toBe('150px');
		expect(container.querySelector('.dock-ghost')).toBeNull();
		ptr('pointerup', bar, 550, 160);
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0].float).toEqual({ x: 200, y: 150, w: 300, h: 225 });
	});

	test('the clamp holds while moving and for a stored position outside the area', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: floating(), onChange }));
		floatGeometry(container);
		const bar = floatEl(container).querySelector('.dock-bar')!;
		ptr('pointerdown', bar, 150, 60);
		ptr('pointermove', bar, 5000, 5000);
		ptr('pointerup', bar, 5000, 5000);
		expect(onChange.mock.calls[0][0].float).toEqual({ x: 900, y: 375, w: 300, h: 225 });

		const far = render(Host, base({ layout: floating({ x: 4000, y: 3000, w: 300, h: 225 }) }));
		rect(areaEl(far.container), 0, 0, 1200, 600);
		window.dispatchEvent(new Event('resize'));
		await tick();
		expect(floatEl(far.container).style.left).toBe('900px');
		expect(floatEl(far.container).style.top).toBe('375px');
	});

	test('a drop of the floating bar onto a column docks it', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: floating(), onChange }));
		floatGeometry(container);
		const bar = floatEl(container).querySelector('.dock-bar')!;
		ptr('pointerdown', bar, 150, 60);
		ptr('pointermove', bar, 600, 300);
		ptr('pointermove', bar, 150, 500);
		await tick();
		expect(container.querySelector('.dock-drop.on')).not.toBeNull();
		ptr('pointerup', bar, 150, 500);
		const l = onChange.mock.calls[0][0];
		expect(l.left).toEqual(['editor', 'mini']);
		expect(l.float).toBeUndefined();
	});

	test('the bottom-right corner resizes it, within its limits', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: floating(), onChange }));
		floatGeometry(container);
		const corner = container.querySelector('.dock-float-resize') as HTMLElement;
		expect(corner).not.toBeNull();
		ptr('pointerdown', corner, 400, 275);
		ptr('pointermove', window, 500, 350);
		await tick();
		expect(floatEl(container).style.width).toBe('400px');
		expect(floatEl(container).style.height).toBe('300px');
		ptr('pointerup', window, 500, 350);
		expect(onChange.mock.calls[0][0].float).toEqual({ x: 100, y: 50, w: 400, h: 300 });
		ptr('pointerdown', corner, 400, 275);
		ptr('pointermove', window, 0, 0);
		ptr('pointerup', window, 0, 0);
		expect(onChange.mock.calls[1][0].float).toEqual({ x: 100, y: 50, w: 200, h: 150 });
		ptr('pointerdown', corner, 400, 275);
		ptr('pointermove', window, 4000, 4000);
		ptr('pointerup', window, 4000, 4000);
		expect(onChange.mock.calls[2][0].float).toEqual({ x: 100, y: 50, w: 600, h: 300 });
	});
});
