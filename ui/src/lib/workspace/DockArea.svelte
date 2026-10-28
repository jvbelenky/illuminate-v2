<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import DockPanel from './DockPanel.svelte';
	import {
		columnWidth,
		dropIndex,
		floatInArea,
		floatPanel,
		moveFloat,
		movePanel,
		resizeFloat,
		resetColumnWidth,
		resizeColumn,
		swapMain,
		toggleMinimized,
		type AreaSize,
		type DockColumn,
		type FloatBox,
		type DockLayout,
		type DockPanelId
	} from './dockLayout';

	interface Props {
		layout: DockLayout;
		onChange: (l: DockLayout) => void;
		titles: Record<DockPanelId, string>;
		panel: Snippet<[DockPanelId]>;
		main: Snippet;
		/** The Calculate control: full in its panel, compact (true) in its minimized bar. */
		calculate?: Snippet<[boolean]>;
		/** Icon buttons in the Results title bar. */
		resultsTools?: Snippet;
		/** Defaults to swapping the main view in the layout. */
		onSwap?: () => void;
		/** Where the floating mini view shows right now, live while it is dragged or resized. */
		onFloatLive?: (f: FloatBox | null) => void;
	}

	let { layout, onChange, titles, panel, main, onSwap, calculate, resultsTools, onFloatLive }: Props = $props();

	const THRESHOLD = 4;
	const columns: DockColumn[] = ['left', 'right'];

	let areaEl: HTMLElement | undefined = $state();
	// A drag of a panel's bar; `floating` when it is the floating mini window, which then moves live.
	// (ox, oy) is the grab point within the panel, so a mini view floats where it was let go.
	let drag = $state<{
		id: DockPanelId;
		sx: number;
		sy: number;
		x: number;
		y: number;
		started: boolean;
		floating: boolean;
		ox: number;
		oy: number;
	} | null>(null);
	let target = $state<{ column: DockColumn; index: number; top: number; edge: boolean } | null>(null);

	// A column's gutter drag shows live and is stored on release
	let resize = $state<{ column: DockColumn; sx: number; w0: number; w: number } | null>(null);
	const RESIZE_STEP = 16;

	// The workspace's size, which holds a floating mini view inside it
	let areaSize = $state<AreaSize | null>(null);

	function measureArea(): AreaSize | null {
		if (!areaEl) return null;
		const r = areaEl.getBoundingClientRect();
		if (r.width > 0 && r.height > 0 && (r.width !== areaSize?.width || r.height !== areaSize?.height)) {
			areaSize = { width: r.width, height: r.height };
		}
		return areaSize;
	}

	$effect(() => {
		if (!areaEl) return;
		const el = areaEl;
		untrack(measureArea);
		const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measureArea()) : null;
		ro?.observe(el);
		const onWin = () => measureArea();
		window.addEventListener('resize', onWin);
		return () => {
			ro?.disconnect();
			window.removeEventListener('resize', onWin);
		};
	});

	const OPEN_AREA: AreaSize = { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER };
	const area = (): AreaSize => measureArea() ?? OPEN_AREA;

	// The floating window's corner drag shows live and is stored on release
	let floatResize = $state<{ sx: number; sy: number; w0: number; h0: number; w: number; h: number } | null>(null);

	/** The floating mini view as stored, kept inside the workspace. */
	const shownFloat = $derived(layout.float ? floatInArea(layout.float, areaSize) : null);

	/** The floating mini view as it shows now, following a drag of its bar or corner. */
	const liveFloat = $derived.by(() => {
		if (!shownFloat) return null;
		let b = shownFloat;
		if (drag?.floating && drag.started) b = { ...b, x: b.x + drag.x - drag.sx, y: b.y + drag.y - drag.sy };
		if (floatResize) b = { ...b, w: floatResize.w, h: floatResize.h };
		return floatInArea(b, areaSize);
	});

	$effect(() => {
		const f = liveFloat ? { ...liveFloat } : null;
		untrack(() => onFloatLive?.(f));
	});

	const miniMinimized = $derived(layout.minimized.includes('mini'));

	function onFloatResizeMove(e: PointerEvent) {
		if (!floatResize) return;
		floatResize = { ...floatResize, w: floatResize.w0 + e.clientX - floatResize.sx, h: floatResize.h0 + e.clientY - floatResize.sy };
	}

	function endFloatResize() {
		window.removeEventListener('pointermove', onFloatResizeMove);
		window.removeEventListener('pointerup', onFloatResizeUp);
		window.removeEventListener('pointercancel', endFloatResize);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		floatResize = null;
	}

	function onFloatResizeUp() {
		const r = floatResize;
		endFloatResize();
		if (r && shownFloat && (r.w !== r.w0 || r.h !== r.h0)) {
			onChange(resizeFloat({ ...layout, float: shownFloat }, r.w, r.h, area()));
		}
	}

	function floatCornerDown(e: PointerEvent) {
		if (e.button !== 0 || !shownFloat) return;
		e.preventDefault();
		floatResize = { sx: e.clientX, sy: e.clientY, w0: shownFloat.w, h0: shownFloat.h, w: shownFloat.w, h: shownFloat.h };
		document.body.style.cursor = 'nwse-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', onFloatResizeMove);
		window.addEventListener('pointerup', onFloatResizeUp);
		window.addEventListener('pointercancel', endFloatResize);
	}

	const widths = $derived.by(() => {
		const live = resize ? resizeColumn(layout, resize.column, resize.w) : layout;
		return {
			left: columnWidth(live, 'left'),
			right: columnWidth(live, 'right')
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
		const d = drag;
		if (d?.started) {
			const t = computeTarget(e.clientX, e.clientY, d.id);
			if (t) onChange(movePanel(layout, d.id, t.column, t.index));
			else if (d.floating && shownFloat) {
				// Let go off the columns: the floating window stays where it was dragged
				const moved = { ...layout, float: shownFloat };
				onChange(moveFloat(moved, shownFloat.x + e.clientX - d.sx, shownFloat.y + e.clientY - d.sy, area()));
			} else if (d.id === 'mini' && areaEl) {
				// The docked mini view let go off the columns floats there
				const r = areaEl.getBoundingClientRect();
				onChange(floatPanel(layout, e.clientX - r.left - d.ox, e.clientY - r.top - d.oy, area()));
			}
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
		const floating = id === 'mini' && !!layout.float;
		const pr = (e.currentTarget as Element | null)?.closest('[data-panel]')?.getBoundingClientRect();
		// The grab point within the panel, kept inside a window of the floating size
		const w = layout.float?.w ?? 300;
		const ox = pr ? Math.max(0, Math.min(w - 24, e.clientX - pr.left)) : 0;
		const oy = pr ? Math.max(0, Math.min(26, e.clientY - pr.top)) : 0;
		drag = { id, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, started: false, floating, ox, oy };
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', cancel);
	}
</script>

<div
	class="dock-area"
	class:is-dragging={drag?.started}
	class:is-resizing={!!resize || !!floatResize}
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
			{#snippet calcBar()}{@render calculate?.(true)}{/snippet}
			{#each layout[col] as id (id)}
				<DockPanel
					{id}
					title={titles[id]}
					minimized={layout.minimized.includes(id)}
					dragging={drag?.started && drag.id === id && !drag.floating}
					onToggleMinimized={() => onChange(toggleMinimized(layout, id))}
					onSwap={id === 'mini' ? swap : undefined}
					onBarPointerDown={(e) => barDown(id, e)}
					barAction={id === 'calculate' && calculate ? calcBar : undefined}
					tools={id === 'results' ? resultsTools : undefined}
				>
					{@render panel(id)}
				</DockPanel>
			{/each}
			{#if target && !target.edge && target.column === col}
				<div class="dock-drop on" style:top="{target.top}px"></div>
			{/if}
		</div>
		{#if col === 'right' && liveFloat}
			<div
				class="dock-float"
				style:left="{liveFloat.x}px"
				style:top="{liveFloat.y}px"
				style:width="{liveFloat.w}px"
				style:height={miniMinimized ? undefined : `${liveFloat.h}px`}
			>
				<DockPanel
					id="mini"
					floating
					title={titles.mini}
					minimized={miniMinimized}
					onToggleMinimized={() => onChange(toggleMinimized(layout, 'mini'))}
					onSwap={swap}
					onBarPointerDown={(e) => barDown('mini', e)}
				>
					{@render panel('mini')}
				</DockPanel>
			</div>
			{#if !miniMinimized}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="dock-float-resize"
					aria-hidden="true"
					style:left="{liveFloat.x + liveFloat.w - 14}px"
					style:top="{liveFloat.y + liveFloat.h - 14}px"
					onpointerdown={floatCornerDown}
				></div>
			{/if}
		{/if}
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

{#if drag?.started && !drag.floating}
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
	/* The floating mini view: a window above the main view (its view slot sits just above it) */
	.dock-float {
		position: absolute;
		z-index: 7;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
	}
	.dock-float-resize {
		position: absolute;
		z-index: 9;
		width: 14px;
		height: 14px;
		cursor: nwse-resize;
		touch-action: none;
		background: linear-gradient(
			135deg,
			transparent 50%,
			var(--color-text-muted) 50%,
			var(--color-text-muted) 58%,
			transparent 58%,
			transparent 70%,
			var(--color-text-muted) 70%,
			var(--color-text-muted) 78%,
			transparent 78%
		);
		opacity: 0.7;
	}
	.dock-float-resize:hover {
		opacity: 1;
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
