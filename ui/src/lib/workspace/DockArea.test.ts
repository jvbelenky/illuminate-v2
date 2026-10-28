import { describe, test, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Host from './test/DockAreaHost.svelte';
import { DEFAULT_DOCK } from './dockLayout';

const titles = { editor: 'Editor', results: 'Results', mini: '3D' };

function base(over: Record<string, unknown> = {}) {
	return {
		layout: { ...DEFAULT_DOCK, left: ['editor'], right: ['mini', 'results'], minimized: [] },
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
		expect(ids('right')).toEqual(['mini', 'results']);
		expect(screen.getByTestId('main-view')).toBeTruthy();
		expect(colEl(container, 'left').style.width).toBe('420px');
	});

	/** The bare Calculate control, checked to sit directly above the Results panel, outside any panel. */
	function calcAboveResults(c: HTMLElement): HTMLElement {
		expect(c.querySelectorAll('button.calculate-btn').length).toBe(1);
		const btn = c.querySelector('button.calculate-btn') as HTMLElement;
		const group = btn.closest('.dock-calc') as HTMLElement;
		expect(group).not.toBeNull();
		expect(btn.closest('[data-panel]')).toBeNull();
		expect(group.nextElementSibling).toBe(panelEl(c, 'results'));
		expect(c.querySelector('[data-panel=calculate]')).toBeNull();
		return group;
	}

	test('Calculate sits above Results docked on the right, and above its minimized bar', () => {
		const open = render(Host, base({ withCalculate: true }));
		expect(calcAboveResults(open.container).closest('.dock-column')).toBe(colEl(open.container, 'right'));
		open.unmount();
		const min = render(Host, base({ withCalculate: true, layout: { ...DEFAULT_DOCK, left: ['editor'], right: ['mini', 'results'], minimized: ['results'] } }));
		calcAboveResults(min.container);
		expect(panelEl(min.container, 'results').querySelector('.dock-content')).toBeNull();
	});

	test('Calculate sits above Results docked on the left, below the gap after the panel above', () => {
		const layout = { ...DEFAULT_DOCK, left: ['mini', 'results'], right: ['editor'], minimized: [] };
		const { container } = render(Host, base({ withCalculate: true, layout }));
		const group = calcAboveResults(container);
		expect(group.closest('.dock-column')).toBe(colEl(container, 'left'));
		expect(group.previousElementSibling!.classList.contains('dock-split')).toBe(true);
		expect(group.previousElementSibling!.previousElementSibling).toBe(panelEl(container, 'mini'));
	});

	test('Calculate sits above Results while it floats, inside its window', () => {
		const layout = { ...DEFAULT_DOCK, left: ['editor', 'mini'], right: [], minimized: [], floats: { results: { x: 100, y: 50, w: 420, h: 500 } } };
		const { container } = render(Host, base({ withCalculate: true, layout }));
		const group = calcAboveResults(container);
		expect(group.parentElement!.classList.contains('dock-float')).toBe(true);
		expect(group.parentElement!.dataset.float).toBe('results');
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
		expect(l.right).toEqual(['mini']);
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

describe('DockArea: floating panels', () => {
	const box = { x: 100, y: 50, w: 300, h: 225 };
	const floatingMini = (f = box, over: Record<string, unknown> = {}) => ({
		...DEFAULT_DOCK,
		left: ['editor'],
		right: ['results'],
		minimized: [],
		floats: { mini: f },
		...over
	});
	const floatingResults = (over: Record<string, unknown> = {}) => ({
		...DEFAULT_DOCK,
		left: ['editor'],
		right: ['mini'],
		minimized: [],
		floats: { results: { x: 100, y: 50, w: 420, h: 500 } },
		...over
	});
	const areaEl = (c: HTMLElement) => c.querySelector('.dock-area') as HTMLElement;
	const floatEl = (c: HTMLElement, id = 'mini') => c.querySelector(`.dock-float[data-float=${id}]`) as HTMLElement;
	const cornerEl = (c: HTMLElement, id = 'mini') => c.querySelector(`.dock-float-resize[data-float=${id}]`) as HTMLElement;

	function floatGeometry(c: HTMLElement, h = 600) {
		rect(areaEl(c), 0, 0, 1200, h);
		rect(colEl(c, 'left'), 0, 0, 300, h);
		rect(colEl(c, 'right'), 900, 0, 300, h);
		rect(panelEl(c, 'editor'), 0, 0, 300, h);
		const r = colEl(c, 'right').querySelector('[data-panel]');
		if (r) rect(r, 900, 0, 300, h);
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
		expect(l.right).toEqual(['results']);
		expect(l.left).toEqual(['editor']);
		// The grab point stays under the pointer
		expect(l.floats).toEqual({ mini: { x: 500, y: 290, w: 300, h: 225 } });
	});

	test('the editor floats by drag, at its default size, and its column empties', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ onChange }));
		mockGeometry(container);
		rect(areaEl(container), 0, 0, 1200, 800);
		const bar = container.querySelector('[data-panel=editor] .dock-bar')!;
		ptr('pointerdown', bar, 100, 10);
		ptr('pointermove', bar, 400, 200);
		ptr('pointermove', bar, 600, 300);
		await tick();
		expect(container.querySelector('.dock-ghost')).not.toBeNull();
		ptr('pointerup', bar, 600, 300);
		const l = onChange.mock.calls[0][0];
		expect(l.left).toEqual([]);
		expect(l.floats).toEqual({ editor: { x: 500, y: 200, w: 420, h: 600 } });
	});

	test('a floating results panel moves by its bar, live, and is stored on release', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: floatingResults(), onChange }));
		floatGeometry(container, 800);
		const win = floatEl(container, 'results');
		expect(win.style.width).toBe('420px');
		expect(win.style.height).toBe('500px');
		expect(colEl(container, 'right').querySelector('[data-panel=results]')).toBeNull();
		const bar = win.querySelector('.dock-bar')!;
		ptr('pointerdown', bar, 450, 60);
		ptr('pointermove', bar, 500, 110);
		ptr('pointermove', bar, 550, 110);
		await tick();
		expect(floatEl(container, 'results').style.left).toBe('200px');
		expect(floatEl(container, 'results').style.top).toBe('100px');
		expect(container.querySelector('.dock-ghost')).toBeNull();
		ptr('pointerup', bar, 550, 110);
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0].floats).toEqual({ results: { x: 200, y: 100, w: 420, h: 500 } });
	});

	test('a floating results panel resizes from its corner, within its minimum and the workspace', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: floatingResults(), onChange }));
		floatGeometry(container, 800);
		const corner = cornerEl(container, 'results');
		expect(corner).not.toBeNull();
		ptr('pointerdown', corner, 520, 550);
		ptr('pointermove', window, 620, 600);
		await tick();
		expect(floatEl(container, 'results').style.width).toBe('520px');
		expect(floatEl(container, 'results').style.height).toBe('550px');
		ptr('pointerup', window, 620, 600);
		expect(onChange.mock.calls[0][0].floats.results).toEqual({ x: 100, y: 50, w: 520, h: 550 });
		ptr('pointerdown', corner, 520, 550);
		ptr('pointermove', window, 0, 0);
		ptr('pointerup', window, 0, 0);
		expect(onChange.mock.calls[1][0].floats.results).toEqual({ x: 100, y: 50, w: 260, h: 200 });
	});

	test('a floating results panel dropped onto a column docks there', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: floatingResults(), onChange }));
		floatGeometry(container, 800);
		const bar = floatEl(container, 'results').querySelector('.dock-bar')!;
		ptr('pointerdown', bar, 150, 60);
		ptr('pointermove', bar, 600, 300);
		ptr('pointermove', bar, 150, 700);
		await tick();
		expect(container.querySelector('.dock-drop.on')).not.toBeNull();
		ptr('pointerup', bar, 150, 700);
		const l = onChange.mock.calls[0][0];
		expect(l.left).toEqual(['editor', 'results']);
		expect(l.floats).toBeUndefined();
	});

	test('the most recently touched floating panel comes to the front', async () => {
		const layout = { ...floatingResults(), right: [], floats: { results: { x: 100, y: 50, w: 420, h: 500 }, mini: box } };
		const { container } = render(Host, base({ layout }));
		const z = (id: string) => Number(floatEl(container, id).style.zIndex);
		ptr('pointerdown', floatEl(container, 'results').querySelector('.dock-content')!, 200, 200);
		await tick();
		expect(z('results')).toBeGreaterThan(z('mini'));
		ptr('pointerdown', floatEl(container, 'mini').querySelector('.dock-content')!, 200, 200);
		await tick();
		expect(z('mini')).toBeGreaterThan(z('results'));
		expect(Number(cornerEl(container, 'mini').style.zIndex)).toBeGreaterThan(z('mini'));
	});

	test('a floating mini view is a window with its bar, out of the columns', () => {
		const { container } = render(Host, base({ layout: floatingMini() }));
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

	test('minimized, a floating panel keeps only its bar where it floats', () => {
		const { container } = render(Host, base({ layout: floatingMini(undefined, { minimized: ['mini'] }) }));
		const win = floatEl(container);
		expect(win.style.left).toBe('100px');
		expect(win.style.height).toBe('');
		expect(screen.queryByTestId('content-mini')).toBeNull();
		expect(cornerEl(container)).toBeNull();
	});

	test('the clamp holds while moving and for a stored position outside the area', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: floatingMini(), onChange }));
		floatGeometry(container);
		const bar = floatEl(container).querySelector('.dock-bar')!;
		ptr('pointerdown', bar, 150, 60);
		ptr('pointermove', bar, 5000, 5000);
		ptr('pointerup', bar, 5000, 5000);
		expect(onChange.mock.calls[0][0].floats.mini).toEqual({ x: 900, y: 375, w: 300, h: 225 });

		const far = render(Host, base({ layout: floatingMini({ x: 4000, y: 3000, w: 300, h: 225 }) }));
		rect(areaEl(far.container), 0, 0, 1200, 600);
		window.dispatchEvent(new Event('resize'));
		await tick();
		expect(floatEl(far.container).style.left).toBe('900px');
		expect(floatEl(far.container).style.top).toBe('375px');
	});
});

describe('DockArea: the split between stacked panels', () => {
	const stacked = (over: Record<string, unknown> = {}) => ({
		...DEFAULT_DOCK,
		left: ['editor', 'mini'],
		right: ['results'],
		minimized: [],
		widths: { left: 450 },
		...over
	});
	const divider = (c: HTMLElement, col = 'left') => c.querySelector(`.dock-column[data-column=${col}] .dock-split`) as HTMLElement;

	test('a divider sits between the editor and the mini view, none beside a lone Results', () => {
		const { container } = render(Host, base({ layout: stacked() }));
		const d = divider(container);
		expect(d).not.toBeNull();
		expect(d.getAttribute('role')).toBe('separator');
		expect(d.getAttribute('aria-orientation')).toBe('horizontal');
		expect(divider(container, 'right')).toBeNull();
	});

	test('dragging it changes the two heights, live, and not the width', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: stacked(), onChange }));
		rect(panelEl(container, 'editor'), 0, 0, 450, 500);
		rect(panelEl(container, 'mini'), 0, 506, 450, 340);
		const d = divider(container);
		ptr('pointerdown', d, 200, 503);
		ptr('pointermove', window, 200, 603);
		await tick();
		expect(panelEl(container, 'mini').style.flexBasis).toBe('240px');
		expect(colEl(container, 'left').style.width).toBe('450px');
		expect(onChange).not.toHaveBeenCalled();
		ptr('pointerup', window, 200, 603);
		expect(onChange).toHaveBeenCalledTimes(1);
		const l = onChange.mock.calls[0][0];
		expect(l.heights).toEqual({ mini: 240 });
		expect(l.widths).toEqual({ left: 450 });
	});

	test('a stored height shows; the filling panel ignores its own', () => {
		const { container } = render(Host, base({ layout: stacked({ heights: { mini: 200, editor: 300 } }) }));
		expect(panelEl(container, 'mini').style.flexBasis).toBe('200px');
		expect(panelEl(container, 'editor').style.flexBasis).toBe('');
	});

	test('double-clicking the divider resets those two heights', async () => {
		const onChange = vi.fn();
		const { container } = render(Host, base({ layout: stacked({ heights: { mini: 200 } }), onChange }));
		await fireEvent.dblClick(divider(container));
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0].heights).toBeUndefined();
		expect(onChange.mock.calls[0][0].widths).toEqual({ left: 450 });
	});
});
