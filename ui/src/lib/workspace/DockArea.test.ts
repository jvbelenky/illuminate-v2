import { describe, test, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Host from './test/DockAreaHost.svelte';
import { DEFAULT_DOCK } from './dockLayout';

const titles = { editor: 'Editor', results: 'Results', mini: '3D' };

function base(over: Record<string, unknown> = {}) {
	return {
		layout: { ...DEFAULT_DOCK, left: ['editor'], right: ['mini', 'results'], minimized: [] },
		resultsWide: false,
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
		const { container } = render(Host, base({ layout, onChange, resultsWide: true }));
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
