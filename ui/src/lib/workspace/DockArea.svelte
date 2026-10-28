<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import DockPanel from './DockPanel.svelte';
	import {
		columnWidth,
		dropIndex,
		fillPanel,
		floatInArea,
		floatPanel,
		FLOAT_DEFAULTS,
		minPanelHeight,
		moveFloat,
		movePanel,
		resetColumnWidth,
		resetSplit,
		resizeColumn,
		resizeFloat,
		splitPairs,
		splitPanels,
		swapMain,
		toggleMinimized,
		type AreaSize,
		type DockColumn,
		type DockLayout,
		type DockPanelId,
		type FloatBox
	} from './dockLayout';

	interface Props {
		layout: DockLayout;
		onChange: (l: DockLayout) => void;
		titles: Record<DockPanelId, string>;
		panel: Snippet<[DockPanelId]>;
		main: Snippet;
		/** The Calculate control: bare, directly above the Results panel wherever it is. */
		calculate?: Snippet;
		/** Icon buttons in the Results title bar. */
		resultsTools?: Snippet;
		/** Defaults to swapping the main view in the layout. */
		onSwap?: () => void;
		/** Where the floating mini view shows right now (live while dragged or resized) and its stacking order. */
		onMiniFloat?: (m: { box: FloatBox; z: number } | null) => void;
	}

	let { layout, onChange, titles, panel, main, onSwap, calculate, resultsTools, onMiniFloat }: Props = $props();

	const THRESHOLD = 4;
	const STEP = 16;
	const columns: DockColumn[] = ['left', 'right'];
	/** Floating windows stack from here, 4 apart: window, its mini view slot (ViewHost), its corner. */
	const FLOAT_Z = 10;

	let areaEl: HTMLElement | undefined = $state();
	// A drag of a panel's bar; `floating` when the panel floats, and then it moves live.
	// (ox, oy) is the grab point within the panel, so a panel floats where it was let go.
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

	// A divider drag between two stacked panels shows live and is stored on release
	let split = $state<{ above: DockPanelId; below: DockPanelId; sy: number; ha: number; hb: number; dy: number } | null>(null);

	// The workspace's size, which holds the floating panels inside it
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

	// The layout as it shows now, following a divider drag
	const live = $derived(split ? splitPanels(layout, split.above, split.below, split.ha, split.hb, split.dy) : layout);

	// --- Floating panels ---

	/** Front-most last: the order floating panels were last touched in. */
	let touched = $state<DockPanelId[]>([]);
	function touch(id: DockPanelId) {
		if (touched[touched.length - 1] !== id) touched = [...touched.filter((p) => p !== id), id];
	}

	const floatIds = $derived(
		(Object.keys(layout.floats ?? {}) as DockPanelId[]).sort((a, b) => touched.indexOf(a) - touched.indexOf(b))
	);
	const zOf = (id: DockPanelId) => FLOAT_Z + 4 * Math.max(0, floatIds.indexOf(id));

	// A floating window's corner drag shows live and is stored on release
	let floatResize = $state<{ id: DockPanelId; sx: number; sy: number; w0: number; h0: number; w: number; h: number } | null>(null);

	/** A floating panel as stored, kept inside the workspace. */
	function shownBox(id: DockPanelId): FloatBox | null {
		const b = layout.floats?.[id];
		return b ? floatInArea(b, areaSize, id) : null;
	}

	/** Every floating panel as it shows now, following a drag of its bar or corner. */
	const liveFloats = $derived.by(() => {
		const out: Partial<Record<DockPanelId, FloatBox>> = {};
		for (const id of floatIds) {
			let b = shownBox(id)!;
			if (drag?.floating && drag.started && drag.id === id) b = { ...b, x: b.x + drag.x - drag.sx, y: b.y + drag.y - drag.sy };
			if (floatResize?.id === id) b = { ...b, w: floatResize.w, h: floatResize.h };
			out[id] = floatInArea(b, areaSize, id);
		}
		return out;
	});

	$effect(() => {
		const b = liveFloats.mini;
		const m = b ? { box: { ...b }, z: zOf('mini') } : null;
		untrack(() => onMiniFloat?.(m));
	});

	/** The layout with a floating panel at the box it shows at. */
	function withShown(id: DockPanelId): DockLayout {
		const b = shownBox(id);
		return b ? { ...layout, floats: { ...layout.floats, [id]: b } } : layout;
	}

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
		if (r && (r.w !== r.w0 || r.h !== r.h0)) onChange(resizeFloat(withShown(r.id), r.id, r.w, r.h, area()));
	}

	function floatCornerDown(id: DockPanelId, e: PointerEvent) {
		const b = shownBox(id);
		if (e.button !== 0 || !b) return;
		e.preventDefault();
		touch(id);
		floatResize = { id, sx: e.clientX, sy: e.clientY, w0: b.w, h0: b.h, w: b.w, h: b.h };
		document.body.style.cursor = 'nwse-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', onFloatResizeMove);
		window.addEventListener('pointerup', onFloatResizeUp);
		window.addEventListener('pointercancel', endFloatResize);
	}

	// --- Column widths ---

	const widths = $derived.by(() => {
		const l = resize ? resizeColumn(layout, resize.column, resize.w) : layout;
		return {
			left: columnWidth(l, 'left'),
			right: columnWidth(l, 'right')
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
		onChange(resizeColumn(layout, column, widths[column] + (grow ? STEP : -STEP)));
	}

	// --- Dividers between stacked panels ---

	/** The two panels' heights now, measured in their column. */
	function pairHeights(column: DockColumn, above: DockPanelId, below: DockPanelId): [number, number] | null {
		const col = areaEl?.querySelector(`.dock-column[data-column=${column}]`);
		const a = col?.querySelector(`[data-panel=${above}]`)?.getBoundingClientRect();
		const b = col?.querySelector(`[data-panel=${below}]`)?.getBoundingClientRect();
		return a && b ? [a.height, b.height] : null;
	}

	function onSplitMove(e: PointerEvent) {
		if (split) split = { ...split, dy: e.clientY - split.sy };
	}

	function endSplit() {
		window.removeEventListener('pointermove', onSplitMove);
		window.removeEventListener('pointerup', onSplitUp);
		window.removeEventListener('pointercancel', endSplit);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		split = null;
	}

	function onSplitUp() {
		const s = split;
		endSplit();
		if (s && s.dy !== 0) onChange(splitPanels(layout, s.above, s.below, s.ha, s.hb, s.dy));
	}

	function splitDown(column: DockColumn, above: DockPanelId, below: DockPanelId, e: PointerEvent) {
		if (e.button !== 0) return;
		const hs = pairHeights(column, above, below);
		if (!hs) return;
		e.preventDefault();
		split = { above, below, sy: e.clientY, ha: hs[0], hb: hs[1], dy: 0 };
		document.body.style.cursor = 'row-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', onSplitMove);
		window.addEventListener('pointerup', onSplitUp);
		window.addEventListener('pointercancel', endSplit);
	}

	function splitKey(column: DockColumn, above: DockPanelId, below: DockPanelId, e: KeyboardEvent) {
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		e.preventDefault();
		const hs = pairHeights(column, above, below);
		if (hs) onChange(splitPanels(layout, above, below, hs[0], hs[1], e.key === 'ArrowDown' ? STEP : -STEP));
	}

	/** A docked panel's size in its column: a stored height, unless it fills the column. */
	function panelStyle(column: DockColumn, id: DockPanelId): string | undefined {
		if (live.minimized.includes(id)) return undefined;
		const h = live.heights?.[id];
		if (h === undefined || fillPanel(live, column) === id) return undefined;
		return `flex: 0 1 ${h}px; aspect-ratio: auto; min-height: ${minPanelHeight(id)}px`;
	}

	// --- Dragging panels by their bar ---

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
			const b = shownBox(d.id);
			if (t) onChange(movePanel(layout, d.id, t.column, t.index));
			else if (d.floating && b) {
				// Let go off the columns: the floating window stays where it was dragged
				onChange(moveFloat(withShown(d.id), d.id, b.x + e.clientX - d.sx, b.y + e.clientY - d.sy, area()));
			} else if (areaEl) {
				// A docked panel let go off the columns floats there
				const r = areaEl.getBoundingClientRect();
				touch(d.id);
				onChange(floatPanel(layout, d.id, e.clientX - r.left - d.ox, e.clientY - r.top - d.oy, area()));
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
		const floating = !!layout.floats?.[id];
		const pr = (e.currentTarget as Element | null)?.closest('[data-panel]')?.getBoundingClientRect();
		// The grab point within the panel, kept inside a window of the floating size
		const w = layout.floats?.[id]?.w ?? FLOAT_DEFAULTS[id].w;
		const ox = pr ? Math.max(0, Math.min(w - 24, e.clientX - pr.left)) : 0;
		// A Results window starts with the Calculate control above its bar
		const calcH = id === 'results' ? (areaEl?.querySelector('.dock-calc')?.getBoundingClientRect().height ?? 0) : 0;
		const above = calcH > 0 ? calcH + 6 : 0;
		const oy = (pr ? Math.max(0, Math.min(26, e.clientY - pr.top)) : 0) + above;
		drag = { id, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, started: false, floating, ox, oy };
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', cancel);
	}
</script>

<div
	class="dock-area"
	class:is-dragging={drag?.started}
	class:is-resizing={!!resize || !!floatResize || !!split}
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
		{@const pairs = splitPairs(layout, col)}
		<div class="dock-column" data-column={col} style:width="{widths[col]}px">
			{#each layout[col] as id, i (id)}
				{#if i > 0}
					{@const pair = pairs.find((p) => p.gap === i - 1)}
					{#if pair}
						<!-- A focusable separator is a widget (ARIA), which Svelte's check does not know -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
						<div
							class="dock-split"
							class:active={split?.above === pair.above && split?.below === pair.below}
							role="separator"
							aria-orientation="horizontal"
							aria-label="Resize {titles[pair.above]} and {titles[pair.below]}"
							tabindex="0"
							onpointerdown={(e) => splitDown(col, pair.above, pair.below, e)}
							ondblclick={() => onChange(resetSplit(layout, pair.above, pair.below))}
							onkeydown={(e) => splitKey(col, pair.above, pair.below, e)}
						></div>
					{:else}
						<div class="dock-gap"></div>
					{/if}
				{/if}
				{#if id === 'results' && calculate}
					<div class="dock-calc">{@render calculate()}</div>
				{/if}
				<DockPanel
					{id}
					title={titles[id]}
					minimized={layout.minimized.includes(id)}
					dragging={drag?.started && drag.id === id && !drag.floating}
					style={panelStyle(col, id)}
					onToggleMinimized={() => onChange(toggleMinimized(layout, id))}
					onSwap={id === 'mini' ? swap : undefined}
					onBarPointerDown={(e) => barDown(id, e)}
					tools={id === 'results' ? resultsTools : undefined}
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
	{#each floatIds as id (id)}
		{@const b = liveFloats[id]}
		{@const min = layout.minimized.includes(id)}
		{#if b}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="dock-float"
				data-float={id}
				style:left="{b.x}px"
				style:top="{b.y}px"
				style:width="{b.w}px"
				style:height={min ? undefined : `${b.h}px`}
				style:z-index={zOf(id)}
				onpointerdowncapture={() => touch(id)}
			>
				{#if id === 'results' && calculate}
					<div class="dock-calc">{@render calculate()}</div>
				{/if}
				<DockPanel
					{id}
					floating
					title={titles[id]}
					minimized={min}
					onToggleMinimized={() => onChange(toggleMinimized(layout, id))}
					onSwap={id === 'mini' ? swap : undefined}
					onBarPointerDown={(e) => barDown(id, e)}
					tools={id === 'results' ? resultsTools : undefined}
				>
					{@render panel(id)}
				</DockPanel>
			</div>
			{#if !min}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="dock-float-resize"
					data-float={id}
					aria-hidden="true"
					style:left="{b.x + b.w - 14}px"
					style:top="{b.y + b.h - 14}px"
					style:z-index={zOf(id) + 2}
					onpointerdown={(e) => floatCornerDown(id, e)}
				></div>
			{/if}
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
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}
	.dock-gap {
		flex: none;
		height: 6px;
	}
	/* The 6 px between two stacked panels: drag to share their heights, double-click to reset */
	.dock-split {
		position: relative;
		flex: none;
		height: 6px;
		cursor: row-resize;
		touch-action: none;
	}
	.dock-split::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 50%;
		width: 40px;
		height: 2px;
		margin-left: -20px;
		border-radius: 2px;
		background: var(--color-border);
		opacity: 0;
		transition: opacity 0.15s;
	}
	.dock-split:hover::after,
	.dock-split.active::after,
	.dock-split:focus-visible::after {
		opacity: 1;
		background: var(--color-text-muted);
	}
	.dock-split:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
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
	/* A floating panel: a window above the main view (a floating mini view's slot sits just above it) */
	.dock-float {
		position: absolute;
		display: flex;
		flex-direction: column;
	}
	.dock-float > :global(.dock-panel) {
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
	}
	/* Calculate and Auto, bare, right-aligned directly above the Results panel */
	.dock-calc {
		flex: none;
		display: flex;
		justify-content: flex-end;
		margin-bottom: 6px;
	}
	.dock-float-resize {
		position: absolute;
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
