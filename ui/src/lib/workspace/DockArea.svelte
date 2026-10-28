<script lang="ts">
	import type { Snippet } from 'svelte';
	import DockPanel from './DockPanel.svelte';
	import {
		columnWidth,
		dropIndex,
		movePanel,
		resetColumnWidth,
		resizeColumn,
		swapMain,
		toggleMinimized,
		type DockColumn,
		type DockLayout,
		type DockPanelId
	} from './dockLayout';

	interface Props {
		layout: DockLayout;
		resultsWide: boolean;
		onChange: (l: DockLayout) => void;
		titles: Record<DockPanelId, string>;
		panel: Snippet<[DockPanelId]>;
		main: Snippet;
		/** Defaults to swapping the main view in the layout. */
		onSwap?: () => void;
	}

	let { layout, resultsWide, onChange, titles, panel, main, onSwap }: Props = $props();

	const THRESHOLD = 4;
	const columns: DockColumn[] = ['left', 'right'];

	let areaEl: HTMLElement | undefined = $state();
	let drag = $state<{ id: DockPanelId; sx: number; sy: number; x: number; y: number; started: boolean } | null>(null);
	let target = $state<{ column: DockColumn; index: number; top: number; edge: boolean } | null>(null);

	// A column's gutter drag shows live and is stored on release
	let resize = $state<{ column: DockColumn; sx: number; w0: number; w: number } | null>(null);
	const RESIZE_STEP = 16;

	const widths = $derived.by(() => {
		const live = resize ? resizeColumn(layout, resize.column, resize.w) : layout;
		return {
			left: columnWidth(live, 'left', resultsWide),
			right: columnWidth(live, 'right', resultsWide)
		};
	});

	function onResizeMove(e: PointerEvent) {
		if (!resize) return;
		const dx = e.clientX - resize.sx;
		resize = { ...resize, w: resize.w0 + (resize.column === 'left' ? dx : -dx) };
	}

	function endResize() {
		window.removeEventListener('pointermove', onResizeMove);
		window.removeEventListener('pointerup', onResizeUp);
		window.removeEventListener('pointercancel', endResize);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		resize = null;
	}

	function onResizeUp() {
		const r = resize;
		endResize();
		if (r && r.w !== r.w0) onChange(resizeColumn(layout, r.column, r.w));
	}

	function gutterDown(column: DockColumn, e: PointerEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		const w0 = widths[column];
		resize = { column, sx: e.clientX, w0, w: w0 };
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', onResizeMove);
		window.addEventListener('pointerup', onResizeUp);
		window.addEventListener('pointercancel', endResize);
	}

	function gutterKey(column: DockColumn, e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		const grow = (e.key === 'ArrowRight') === (column === 'left');
		onChange(resizeColumn(layout, column, widths[column] + (grow ? RESIZE_STEP : -RESIZE_STEP)));
	}

	function swap() {
		if (onSwap) onSwap();
		else onChange(swapMain(layout));
	}

	function contains(el: Element, x: number, y: number): boolean {
		const r = el.getBoundingClientRect();
		return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
	}

	function computeTarget(x: number, y: number, id: DockPanelId) {
		if (!areaEl) return null;
		for (const el of areaEl.querySelectorAll<HTMLElement>('.dock-edge')) {
			if (contains(el, x, y)) return { column: el.dataset.column as DockColumn, index: 0, top: 0, edge: true };
		}
		for (const el of areaEl.querySelectorAll<HTMLElement>('.dock-column')) {
			if (!contains(el, x, y)) continue;
			const col = el.dataset.column as DockColumn;
			const cr = el.getBoundingClientRect();
			const others = [...el.querySelectorAll<HTMLElement>('[data-panel]')].filter((p) => p.dataset.panel !== id);
			const rects = others.map((p) => p.getBoundingClientRect());
			const index = dropIndex(
				rects.map((r) => (r.top + r.bottom) / 2),
				y
			);
			const line = index === 0 ? (rects[0]?.top ?? cr.top) : rects[index - 1].bottom;
			return { column: col, index, top: line - cr.top, edge: false };
		}
		return null;
	}

	function onMove(e: PointerEvent) {
		if (!drag) return;
		const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
		const started = drag.started || moved >= THRESHOLD;
		drag = { ...drag, x: e.clientX, y: e.clientY, started };
		target = started ? computeTarget(e.clientX, e.clientY, drag.id) : null;
	}

	function end() {
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', onUp);
		window.removeEventListener('pointercancel', cancel);
		drag = null;
		target = null;
	}

	function onUp(e: PointerEvent) {
		if (drag?.started) {
			const t = computeTarget(e.clientX, e.clientY, drag.id);
			if (t) onChange(movePanel(layout, drag.id, t.column, t.index));
		}
		end();
	}

	function cancel() {
		end();
	}

	function barDown(id: DockPanelId, e: PointerEvent) {
		if (e.button !== 0) return;
		if ((e.target as Element | null)?.closest('button')) return;
		try {
			(e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
		} catch {
			/* capture is optional */
		}
		drag = { id, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, started: false };
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', cancel);
	}
</script>

<div
	class="dock-area"
	class:is-dragging={drag?.started}
	class:is-resizing={!!resize}
	bind:this={areaEl}
	style:grid-template-columns="{widths.left}px minmax(0, 1fr) {widths.right}px"
>
	{#each columns as col (col)}
		{#if col === 'right'}
			<div class="dock-main" style:margin-left={widths.left ? '6px' : '0'} style:margin-right={widths.right ? '6px' : '0'}>
				{@render main()}
				{#if drag?.started}
					{#each columns as ec (ec)}
						{#if layout[ec].length === 0}
							<div class="dock-edge" data-column={ec} class:left={ec === 'left'} class:right={ec === 'right'}>
								<div class="dock-drop" class:on={target?.edge && target.column === ec}></div>
							</div>
						{/if}
					{/each}
				{/if}
			</div>
		{/if}
		<div class="dock-column" data-column={col} style:width="{widths[col]}px">
			{#each layout[col] as id (id)}
				<DockPanel
					{id}
					title={titles[id]}
					minimized={layout.minimized.includes(id)}
					dragging={drag?.started && drag.id === id}
					onToggleMinimized={() => onChange(toggleMinimized(layout, id))}
					onSwap={id === 'mini' ? swap : undefined}
					onBarPointerDown={(e) => barDown(id, e)}
				>
					{@render panel(id)}
				</DockPanel>
			{/each}
			{#if target && !target.edge && target.column === col}
				<div class="dock-drop on" style:top="{target.top}px"></div>
			{/if}
		</div>
		{#if layout[col].length > 0}
			<!-- A focusable separator is a widget (ARIA), which Svelte's check does not know -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<div
				class="dock-gutter"
				class:active={resize?.column === col}
				data-column={col}
				role="separator"
				aria-orientation="vertical"
				aria-label={col === 'left' ? 'Resize left panels' : 'Resize right panels'}
				aria-valuenow={widths[col]}
				tabindex="0"
				style={col === 'left' ? `left: ${widths.left}px` : `right: ${widths.right}px`}
				onpointerdown={(e) => gutterDown(col, e)}
				ondblclick={() => onChange(resetColumnWidth(layout, col))}
				onkeydown={(e) => gutterKey(col, e)}
			></div>
		{/if}
	{/each}
</div>

{#if drag?.started}
	<div class="dock-ghost" style:left="{drag.x + 8}px" style:top="{drag.y + 8}px">⋮⋮ {titles[drag.id]}</div>
{/if}

<style>
	.dock-area {
		position: relative;
		display: grid;
		grid-template-areas: 'left main right';
		width: 100%;
		height: 100%;
		min-height: 0;
	}
	.dock-column {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}
	/* The 6 px between a column and the main view: drag to resize, double-click to reset */
	.dock-gutter {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: col-resize;
		z-index: 6;
		touch-action: none;
	}
	.dock-gutter::after {
		content: '';
		position: absolute;
		left: 2px;
		top: 50%;
		width: 2px;
		height: 40px;
		margin-top: -20px;
		border-radius: 2px;
		background: var(--color-border);
		opacity: 0;
		transition: opacity 0.15s;
	}
	.dock-gutter:hover::after,
	.dock-gutter.active::after,
	.dock-gutter:focus-visible::after {
		opacity: 1;
		background: var(--color-text-muted);
	}
	.dock-gutter:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
	}
	.dock-area.is-resizing :global(.view-slot) {
		pointer-events: none;
	}
	.dock-column[data-column='left'] {
		grid-area: left;
	}
	.dock-column[data-column='right'] {
		grid-area: right;
	}
	.dock-main {
		grid-area: main;
		position: relative;
		min-width: 0;
		min-height: 0;
	}
	.dock-edge {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 24px;
		z-index: 5;
		background: color-mix(in srgb, var(--color-primary) 12%, transparent);
	}
	.dock-edge.left {
		left: 0;
	}
	.dock-edge.right {
		right: 0;
	}
	.dock-edge .dock-drop {
		top: 0;
	}
	.dock-drop {
		position: absolute;
		left: 0;
		right: 0;
		height: 6px;
		margin-top: -3px;
		border-radius: 3px;
		pointer-events: none;
		z-index: 5;
	}
	.dock-drop.on {
		background: var(--color-primary);
		box-shadow: 0 0 10px var(--color-primary);
	}
	.dock-ghost {
		position: fixed;
		width: 240px;
		height: 26px;
		padding: 4px 8px;
		box-sizing: border-box;
		pointer-events: none;
		z-index: 1000;
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
		color: var(--color-text);
		font-size: var(--font-size-xs);
	}
</style>
