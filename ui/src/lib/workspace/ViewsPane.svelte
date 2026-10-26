<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { WorkspaceLayout } from '$lib/stores/settings';
	import {
		type ViewId,
		paneOrder,
		largeView,
		calculateHost,
		swapped,
		clampSplit,
		clampInset
	} from './layoutGeometry';

	type Pos = { x: number; y: number };
	type Patch = Partial<{
		layout: WorkspaceLayout;
		swap: boolean;
		split: number;
		inset: Pos | null;
		insetHidden: boolean;
	}>;

	let {
		layout,
		swap,
		split,
		inset,
		insetHidden,
		onChange,
		view2d,
		view3d,
		calculate
	}: {
		layout: WorkspaceLayout;
		swap: boolean;
		split: number;
		inset: Pos | null;
		insetHidden: boolean;
		onChange: (patch: Patch) => void;
		view2d: Snippet;
		view3d: Snippet;
		calculate: Snippet;
	} = $props();

	const LAYOUTS = ['side', 'stack', 'pip-2d', 'pip-3d'];
	const DIVIDER = 6;
	const BAR = 24;
	const NARROW = 768;
	// The default inset (and the Show pill) sit above the 3D view's bottom-right
	// buttons (Open in new window, Save as image) when 3D is the large view
	const LIFTED_BOTTOM = 56;

	let innerWidth = $state(1024);
	let areaW = $state(0);
	let areaH = $state(0);
	let root: HTMLElement | undefined = $state();

	// Stored settings are unvalidated: sanitize at use.
	const safeLayout = $derived<WorkspaceLayout>(
		LAYOUTS.includes(layout) ? layout : 'side'
	);
	const narrow = $derived(innerWidth < NARROW);
	const eff = $derived<WorkspaceLayout>(narrow ? 'stack' : safeLayout);
	const safeSplit = $derived(clampSplit(Number.isFinite(split) ? split : 0.5));
	const safeInset = $derived<Pos | null>(
		inset && Number.isFinite(inset.x) && Number.isFinite(inset.y) ? inset : null
	);

	let dragSplit = $state<number | null>(null);
	let dragInset = $state<Pos | null>(null);

	const liveSplit = $derived(dragSplit ?? safeSplit);
	const order = $derived(paneOrder(eff, !!swap));
	const large = $derived(largeView(eff));
	const isPip = $derived(large !== null);
	const insetView = $derived<ViewId | null>(large ? (large === '2d' ? '3d' : '2d') : null);
	const host = $derived(calculateHost(eff));

	const insetPos = $derived.by<Pos | null>(() => {
		const p = dragInset ?? safeInset;
		if (!p) return null;
		if (areaW > 0 && areaH > 0 && !dragInset) {
			return clampInset(
				p,
				{ w: areaW * 0.3, h: Math.max(150, areaH * 0.3 + BAR) },
				{ w: areaW, h: areaH }
			);
		}
		return p;
	});

	function pct(v: number) {
		return `${Math.round(v * 10000) / 100}%`;
	}

	function slotStyle(v: ViewId): string {
		if (isPip) {
			if (v === large) return 'left:0;top:0;right:0;bottom:0;';
			if (insetHidden) return 'display:none;';
			const size = 'width:30%;height:calc(30% + 24px);min-height:150px;';
			const p = insetPos;
			return p
				? `${size}left:${Math.round(p.x)}px;top:${Math.round(p.y)}px;right:auto;bottom:auto;`
				: `${size}right:14px;bottom:${large === '3d' ? LIFTED_BOTTOM : 14}px;`;
		}
		const first = order[0] === v;
		const s = pct(liveSplit);
		const half = DIVIDER / 2;
		if (eff === 'stack') {
			return first
				? `left:0;right:0;top:0;height:calc(${s} - ${half}px);`
				: `left:0;right:0;bottom:0;height:calc(${pct(1 - liveSplit)} - ${half}px);`;
		}
		return first
			? `top:0;bottom:0;left:0;width:calc(${s} - ${half}px);`
			: `top:0;bottom:0;right:0;width:calc(${pct(1 - liveSplit)} - ${half}px);`;
	}

	const dividerStyle = $derived(
		eff === 'stack'
			? `left:0;right:0;height:${DIVIDER}px;top:calc(${pct(liveSplit)} - ${DIVIDER / 2}px);`
			: `top:0;bottom:0;width:${DIVIDER}px;left:calc(${pct(liveSplit)} - ${DIVIDER / 2}px);`
	);

	function capture(e: PointerEvent) {
		try {
			(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
		} catch {
			/* ignore */
		}
	}

	// --- divider drag ---
	let dividerDrag = false;
	function splitFrom(e: PointerEvent): number {
		const r = root!.getBoundingClientRect();
		return eff === 'stack'
			? clampSplit((e.clientY - r.top) / (r.height || 1))
			: clampSplit((e.clientX - r.left) / (r.width || 1));
	}
	function dividerDown(e: PointerEvent) {
		dividerDrag = true;
		capture(e);
	}
	function dividerMove(e: PointerEvent) {
		if (dividerDrag) dragSplit = splitFrom(e);
	}
	function dividerUp(e: PointerEvent) {
		if (!dividerDrag) return;
		dividerDrag = false;
		const v = splitFrom(e);
		dragSplit = null;
		onChange({ split: v });
	}

	// --- inset drag ---
	let insetDrag: { sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;
	function insetEl(e: Event): HTMLElement {
		return (e.currentTarget as HTMLElement).closest('.view-slot') as HTMLElement;
	}
	function posFrom(e: PointerEvent): Pos {
		const slot = insetEl(e);
		const r = root!.getBoundingClientRect();
		const sr = slot.getBoundingClientRect();
		const d = insetDrag!;
		return clampInset(
			{ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) },
			{ w: sr.width, h: sr.height },
			{ w: r.width, h: r.height }
		);
	}
	function barDown(e: PointerEvent) {
		const slot = insetEl(e);
		const r = root!.getBoundingClientRect();
		const sr = slot.getBoundingClientRect();
		insetDrag = { sx: e.clientX, sy: e.clientY, ox: sr.left - r.left, oy: sr.top - r.top, moved: false };
		capture(e);
	}
	function barMove(e: PointerEvent) {
		if (!insetDrag) return;
		if (Math.abs(e.clientX - insetDrag.sx) + Math.abs(e.clientY - insetDrag.sy) > 3) insetDrag.moved = true;
		if (insetDrag.moved) dragInset = posFrom(e);
	}
	function barUp(e: PointerEvent) {
		if (!insetDrag) return;
		const moved = insetDrag.moved;
		const p = moved ? posFrom(e) : null;
		insetDrag = null;
		dragInset = null;
		if (p) onChange({ inset: p });
	}

	function doSwap() {
		const s = swapped(eff, !!swap);
		onChange(isPip ? { layout: s.layout } : { swap: s.swap });
	}
	// A plain click on the inset's body swaps; not one that ends a drag (an orbit,
	// a pan, a marquee) or one on a control inside the view.
	let slotDown: { x: number; y: number } | null = null;
	function slotPointerDown(e: PointerEvent) {
		slotDown = { x: e.clientX, y: e.clientY };
	}
	const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [role="dialog"], .plan-toolbar, .vertex, .mid-handle';
	function slotClick(e: MouseEvent) {
		if (!isPip) return;
		const t = e.target as Element;
		const down = slotDown;
		slotDown = null;
		if (t.closest('.inset-bar')) return;
		if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3) return;
		const hit = t.closest(INTERACTIVE);
		if (hit && hit !== e.currentTarget && (e.currentTarget as Element).contains(hit)) return;
		doSwap();
	}
</script>

<svelte:window bind:innerWidth />

<div
	class="views-pane"
	bind:this={root}
	bind:clientWidth={areaW}
	bind:clientHeight={areaH}
	data-layout={eff}
	data-swap={swap ? 'true' : 'false'}
>
	{#each ['2d', '3d'] as const as v (v)}
		{@const isInset = isPip && v === insetView}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="view-slot"
			class:is-inset={isInset}
			class:hosts-calculate={host === v}
			data-view={v}
			style={slotStyle(v)}
			onpointerdowncapture={isInset ? slotPointerDown : undefined}
			onclick={isInset ? slotClick : undefined}
		>
			{#if isInset}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="inset-bar"
					onpointerdown={barDown}
					onpointermove={barMove}
					onpointerup={barUp}
					onpointercancel={barUp}
				>
					<span class="inset-title">{v === '2d' ? '2D' : '3D'}</span>
					<span class="inset-actions">
						<button
							type="button"
							data-inset-action="swap"
							aria-label="Swap views"
							onpointerdown={(e) => e.stopPropagation()}
							onclick={doSwap}>⇄</button
						>
						<button
							type="button"
							data-inset-action="hide"
							aria-label="Hide"
							onpointerdown={(e) => e.stopPropagation()}
							onclick={() => onChange({ insetHidden: true })}>–</button
						>
					</span>
				</div>
			{/if}
			<div class="slot-body">
				{#if v === '2d'}{@render view2d()}{:else}{@render view3d()}{/if}
			</div>
			{#if host === v}
				<div class="calculate-slot" style="position:absolute;top:12px;right:12px;">{@render calculate()}</div>
			{/if}
		</div>
	{/each}

	{#if !isPip && !narrow}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="views-divider"
			class:vertical={eff === 'stack'}
			role="separator"
			aria-orientation={eff === 'stack' ? 'horizontal' : 'vertical'}
			tabindex="0"
			style={dividerStyle}
			onpointerdown={dividerDown}
			onpointermove={dividerMove}
			onpointerup={dividerUp}
			onpointercancel={dividerUp}
			ondblclick={() => onChange({ split: 0.5 })}
		></div>
	{/if}

	{#if isPip && insetHidden && insetView}
		<button type="button" class="inset-show" style={large === '3d' ? `bottom:${LIFTED_BOTTOM}px;` : undefined} onclick={() => onChange({ insetHidden: false })}>
			Show {insetView === '2d' ? '2D' : '3D'}
		</button>
	{/if}
</div>

<style>
	.views-pane {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.view-slot {
		position: absolute;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.slot-body {
		position: relative;
		flex: 1;
		min-height: 0;
		min-width: 0;
	}
	.calculate-slot {
		z-index: 5;
	}
	/* Calculate (and Autocalculate) sit top-right of the 2D view here: the plan's Hand / Zoom control goes below them */
	.view-slot.hosts-calculate :global(.view-controls) {
		top: 88px;
	}
	.view-slot.is-inset {
		z-index: 7;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
		cursor: pointer;
	}
	.view-slot.is-inset:hover {
		border-color: var(--color-primary);
	}
	.inset-bar {
		flex: none;
		display: flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 4px 0 6px;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
		font-size: 0.72rem;
		color: var(--color-text-muted);
		cursor: move;
		user-select: none;
		touch-action: none;
	}
	.inset-actions {
		margin-left: auto;
		display: flex;
		gap: 2px;
	}
	.inset-actions button {
		width: 20px;
		height: 18px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		line-height: 1;
		cursor: pointer;
	}
	.inset-actions button:hover {
		color: var(--color-text);
		border-color: var(--color-border);
		background: var(--color-bg-tertiary);
	}
	.views-divider {
		position: absolute;
		z-index: 4;
		background: var(--color-border);
		cursor: col-resize;
		touch-action: none;
	}
	.views-divider.vertical {
		cursor: row-resize;
	}
	.views-divider::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 4px;
		height: 36px;
		transform: translate(-50%, -50%);
		border-radius: 2px;
		background: var(--color-text-muted);
		opacity: 0.5;
	}
	.views-divider.vertical::after {
		width: 36px;
		height: 4px;
	}
	.views-divider:hover {
		background: var(--color-primary);
	}
	.inset-show {
		position: absolute;
		right: 14px;
		bottom: 14px;
		z-index: 8;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.74rem;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
	}
	.inset-show:hover {
		border-color: var(--color-primary);
	}
</style>
