<script lang="ts">
	// The 2D pane: the plan canvas, the per-context toolbar under it, and the
	// prompts that belong to the canvas (leave-confirm, new outline, image).
	// All editing state lives in the PlanController; this is a view over it.
	// Exactly one PlanPane hosts a given controller: it follows the stored
	// polygon, takes over Ctrl+Z, and handles the plan's keyboard shortcuts.
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import PlanCanvas from '$lib/components/PlanCanvas.svelte';
	import { tick, untrack } from 'svelte';
	import { setUndoInterceptor } from '$lib/utils/undoKeys';
	import { zoneFootprint } from '$lib/utils/zoneFootprint';
	import { unitAbbrev, LENGTH_UNITS } from '$lib/utils/unitConversion';
	import type { Vertex } from '$lib/utils/roomGeometry';
	import CeilingIcon from '$lib/ceiling/CeilingIcon.svelte';
	import { planShouldHandleKey, type PlanController } from './planController.svelte';

	interface Props {
		controller: PlanController;
		/** Summary use: no handles, no toolbar, nothing draggable, no keyboard. */
		readonly?: boolean;
		/** Show the per-context toolbar under the canvas (a host with its own toolbar turns it off). */
		toolbar?: boolean;
		/** Route Escape to the controller; off for a host that forwards it itself (the page: +page.svelte passes handleEscape={false}). */
		handleEscape?: boolean;
	}

	let { controller, readonly = false, toolbar = true, handleEscape = true }: Props = $props();

	// A local alias, so the canvas can bind to the controller's fields
	const ctl = $derived(controller);

	const units = $derived(ctl.scene().units);
	const precision = $derived(ctl.scene().precision);
	const vertices = $derived(ctl.scene().vertices);
	const lamps = $derived(ctl.scene().lamps);
	// Ceiling: the room seen from above with the ceiling drawn over it; structures
	// stand on the floor, so they are left out
	const ceiling = $derived(ctl.scene().ceiling);
	const ceilingItems = $derived(ctl.onCeiling && ceiling.ceilingShown && ceiling.itemsShown ? ceiling.items.filter((i) => !i.hidden) : []);
	const points = (vs: Vertex[]) => vs.map(([x, y]) => `${x},${-y}`).join(' ');

	function onKey(event: KeyboardEvent) {
		// Only keys meant for the plan: not behind a dialog, not in the results column
		if (!planShouldHandleKey(event)) return;
		ctl.onWindowKey(event);
		if (handleEscape && event.key === 'Escape') ctl.onEscapeKey();
	}

	// An empty polygon for the read-only canvas to bind
	let roDraft = $state<Vertex[]>([]);
	let roCanvas = $state<PlanCanvas | null>(null);

	// Fit the room again when the controller asks (another project was opened, a
	// typed room size). After a tick, so the canvas has the new outline first.
	$effect(() => {
		if (ctl.fitRequest === 0) return;
		untrack(() => tick().then(() => (readonly ? roCanvas : ctl.canvas)?.fitView()));
	});

	// Follow the stored polygon (an undo, a units switch, a backend nudge), except
	// mid-gesture or while a local invalid edit is on screen.
	$effect(() => {
		if (readonly) return;
		const src = ctl.source;
		untrack(() => ctl.followSource(src));
	});

	// While drawing, Ctrl+Z drops the last corner; with an invalid edit on
	// screen it drops that edit. Otherwise the app-wide undo runs.
	$effect(() => {
		if (readonly) return;
		setUndoInterceptor((key) => key === 'undo' && ctl.undoInterceptor());
		return () => setUndoInterceptor(null);
	});

	// Focus the distance field as soon as the popover appears, so the user can type
	// the measurement straight after the second click.
	$effect(() => {
		if (readonly) return;
		if (ctl.measure?.b) document.getElementById('measured-distance')?.focus();
	});
</script>

<svelte:window onkeydown={readonly ? undefined : onKey} />

<div class="plan-pane" data-plan-scope>
	{#if readonly}
		<PlanCanvas
			bind:this={roCanvas}
			bind:draft={roDraft}
			{units}
			{precision}
			fallbackFit={vertices}
			extraFitPoints={ctl.imageFitPoints}
			{lamps}
			objects={[]}
			shapes={ctl.shapes}
			outline={vertices}
			ariaLabel="Floor plan canvas"
		>
			{#snippet underlay()}
				{#if ctl.planImage}
					<image
						class="plan-image"
						href={ctl.planImage.href}
						x={ctl.planImage.x}
						y={-(ctl.planImage.y + ctl.planImage.height)}
						width={ctl.planImage.width}
						height={ctl.planImage.height}
						opacity={ctl.planImage.opacity}
						preserveAspectRatio="none"
						role="img"
						aria-label="Floor plan reference image"
					/>
				{/if}
			{/snippet}
		</PlanCanvas>
	{:else}
		<PlanCanvas
			bind:this={ctl.canvas}
			bind:draft={ctl.draft}
			bind:drawing={ctl.drawing}
			bind:selectedIndex={ctl.selectedIndex}
			bind:tool={ctl.tool}
			{units}
			{precision}
			fallbackFit={vertices}
			extraFitPoints={ctl.imageFitPoints}
			lamps={ctl.onLamps ? [] : lamps}
			objects={[]}
			shapes={ctl.onCeiling ? [] : ctl.shapes}
			outline={ctl.onOutline ? undefined : vertices}
			allowNegative={ctl.onObstacles}
			draggableBody={ctl.onObstacles || (ctl.onZones && !!ctl.selectedFootprint) || (ctl.onCeiling && !!ctl.editableKeepOut)}
			dblClickCorners={ctl.onCeiling}
			selectedDraft={ctl.onCeiling && !!ctl.editableKeepOut}
			onShapeClick={ctl.onObstacles ? ctl.clickObstacle : undefined}
			onDrawEnd={ctl.onDrawEnd}
			onEdit={ctl.commitDraft}
			invalid={!ctl.drawing && ctl.validationMessage !== null && ctl.draft.length >= 3}
			ariaLabel="Floor plan canvas"
			onCustomClick={ctl.onCustomClick}
			onCustomMove={ctl.onCustomMove}
			onCustomLeave={ctl.onCustomLeave}
			onCustomEnter={ctl.onScaleEnter}
			onHostMove={ctl.onHostMove}
			onHostPointerUp={ctl.onHostPointerUp}
			onBackgroundDragStart={ctl.onBackgroundDragStart}
			onBackgroundPointerDown={ctl.onBackgroundPointerDown}
		>
			{#snippet underlay(c)}
				{#if ctl.onCeiling && ceiling.ceilingShown && vertices.length >= 3}
					<polygon class="ceiling-fill" points={points(vertices)} />
					{#each ctl.tileSegments as t, i (i)}
						<line class="tile-line" x1={t.x1} y1={-t.y1} x2={t.x2} y2={-t.y2} stroke-width={c.px} />
					{/each}
				{/if}
				<!-- Reference image (bottom-left anchored; SVG y is flipped) -->
				{#if ctl.planImage}
					<image
						class="plan-image"
						href={ctl.planImage.href}
						x={ctl.planImage.x}
						y={-(ctl.planImage.y + ctl.planImage.height)}
						width={ctl.planImage.width}
						height={ctl.planImage.height}
						opacity={ctl.planImage.opacity}
						preserveAspectRatio="none"
						role="img"
						aria-label="Floor plan reference image"
						class:interactive={ctl.planInteractive}
						class:selected={ctl.planSelected}
						onpointerdown={ctl.onPlanPointerDown}
					/>
					{#if ctl.planSelected}
						<rect class="plan-outline" x={ctl.planImage.x} y={-(ctl.planImage.y + ctl.planImage.height)} width={ctl.planImage.width} height={ctl.planImage.height} stroke-width={c.px * 2} stroke-dasharray="{c.px * 6} {c.px * 4}" />
					{/if}
				{/if}
			{/snippet}
			{#snippet overlay(c)}
				{#if ctl.selectedLabel}
					{@const [lx, ly] = ctl.selectedLabel.at}
					<text class="shape-label plan-shape-label" x={lx} y={-ly + c.px * 4} font-size={c.px * 11} text-anchor="middle">{ctl.selectedLabel.name}</text>
				{/if}
				{#each ceilingItems as it (it.id)}
					{@const sel = it.id === ctl.selectedCeilingId}
					{#if it.kind === 'keep'}
						{#if !sel || ctl.drawing}
							<polygon class="ceiling-keep" points={points(it.vertices)} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 6} {c.px * 4}" role="button" tabindex="-1" aria-label={it.name} onpointerdown={(e) => ctl.onCeilingItemPointerDown(e, it.id)} />
						{/if}
					{:else}
						{@const [ix, iy] = ctl.ceilingItemAt(it)}
						{@const r = c.px * 9}
						<g class="ceiling-item" class:selected={sel} role="button" tabindex="-1" aria-label={it.name} onpointerdown={(e) => ctl.onCeilingItemPointerDown(e, it.id)}>
							<circle class="ceiling-hit" cx={ix} cy={-iy} r={Math.max(c.hitPx * 11.7, r * 1.3)} />
							{#if sel}<circle class="ceiling-ring" cx={ix} cy={-iy} r={r * 1.35} stroke-width={c.px * 2} />{/if}
							<CeilingIcon kind={it.kind} size={r * 2} x={ix - r} y={-iy - r} />
						</g>
					{/if}
				{/each}
				{#if ctl.onZones}
					{#each ctl.footprintZones.filter((z) => z.id !== ctl.selectedZoneId || ctl.drawing) as z (z.id)}
						{@const fp = zoneFootprint(z)}
						<polygon class="plan-zone" class:volume={z.type === 'volume'} class:off={z.enabled === false} points={fp.map(([x, y]) => `${x},${-y}`).join(' ')} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 6} {c.px * 3}" role="button" tabindex="-1" aria-label="Zone {z.name || z.id}" onpointerdown={(e) => { if (ctl.drawing || ctl.placing || e.button !== 0) return; e.stopPropagation(); ctl.clickZone(z.id); }} />
						<text class="plan-lamp-label" x={Math.min(...fp.map((p) => p[0])) + c.px * 4} y={-Math.max(...fp.map((p) => p[1])) + c.px * 13} font-size={c.px * 11}>{z.name || z.id}</text>
					{/each}
				{/if}
				{#if ctl.onLamps || ctl.onZones}
					{#each ctl.markers as m (m.id)}
						{@const v = ctl.markerView(m)}
						{@const sel = ctl.onLamps ? ctl.selectedLampIds.includes(m.id) : m.id === ctl.selectedMarkerId}
						{#if Math.hypot(v.ax - v.x, v.ay - v.y) > c.px * 2}
							<line class="aim-line" class:selected={sel} class:point={ctl.onZones} x1={v.x} y1={-v.y} x2={v.ax} y2={-v.ay} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 5} {c.px * 3}" />
						{/if}
						{#if c.hitPx > c.px * 1.001}<circle class="plan-hit" class:aiming={ctl.onLamps && ctl.lampMode === 'aim'} cx={v.x} cy={-v.y} r={c.hitPx * 11.7} onpointerdown={(e) => ctl.onMarkerPointerDown(e, m.id, 'body')} />{/if}
						<circle class="plan-lamp" class:point={ctl.onZones} class:aiming={ctl.onLamps && ctl.lampMode === 'aim'} class:selected={sel} class:off={!m.enabled} cx={v.x} cy={-v.y} r={c.handleR * 1.5} stroke-width={c.handleR * 0.9} role="button" tabindex="-1" aria-label="{ctl.onLamps ? 'Lamp' : 'Point'} {m.name}" onpointerdown={(e) => ctl.onMarkerPointerDown(e, m.id, 'body')} />
						{#if c.hitPx > c.px * 1.001}<circle class="plan-hit aim" cx={v.ax} cy={-v.ay} r={c.hitPx * 4.5} onpointerdown={(e) => ctl.onMarkerPointerDown(e, m.id, 'aim')} />{/if}
						<circle class="plan-aim" class:point={ctl.onZones} class:selected={sel} cx={v.ax} cy={-v.ay} r={c.handleR * 0.75} role="button" tabindex="-1" aria-label="Aim of {m.name}" onpointerdown={(e) => ctl.onMarkerPointerDown(e, m.id, 'aim')} />
						<text class="plan-lamp-label" x={v.x + c.handleR * 2.3} y={-v.y + c.px * 4} font-size={c.px * 11}>{m.name}</text>
					{/each}
					{#if ctl.marquee}
						{@const mx = Math.min(ctl.marquee.a[0], ctl.marquee.b[0])}
						{@const my = Math.max(ctl.marquee.a[1], ctl.marquee.b[1])}
						<rect class="marquee" x={mx} y={-my} width={Math.abs(ctl.marquee.b[0] - ctl.marquee.a[0])} height={Math.abs(ctl.marquee.b[1] - ctl.marquee.a[1])} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 5} {c.px * 3}" />
					{/if}
					<!-- Kept for Phase 3 (surfaces): the point-place ghost -->
					{#if ctl.placing && ctl.placeCursor}
						<circle class="plan-lamp ghost" class:point={ctl.onZones} cx={ctl.placeCursor[0]} cy={-ctl.placeCursor[1]} r={c.handleR * 1.5} stroke-width={c.handleR * 0.9} />
					{/if}
				{/if}
				{#if ctl.onReflectance && ctl.hoveredSurface === 'walls' && vertices.length >= 3}
					<polygon class="surface-highlight" points={vertices.map(([x, y]) => `${x},${-y}`).join(' ')} stroke-width={c.px * 5} />
				{/if}
				{#if ctl.measureLine}
					<line x1={ctl.measureLine.x1} y1={ctl.measureLine.y1} x2={ctl.measureLine.x2} y2={ctl.measureLine.y2} class="measure-line" stroke-width={c.px * 2} stroke-dasharray="{c.px * 3} {c.px * 2}" />
					<circle cx={ctl.measureLine.x1} cy={ctl.measureLine.y1} r={c.handleR * 0.9} class="measure-dot" stroke-width={c.px * 2} />
					{#if ctl.measureLine.done}
						<circle cx={ctl.measureLine.x2} cy={ctl.measureLine.y2} r={c.handleR * 0.9} class="measure-dot" stroke-width={c.px * 2} />
					{/if}
				{/if}
			{/snippet}
			{#snippet hud(c)}
				{#if ctl.planSelected && ctl.placement && ctl.planImage}
					{@const anchor = c.toScreen(ctl.planImage.x, ctl.planImage.y)}
					<div class="plan-readout" style="left: {anchor[0]}px; top: {anchor[1] + 6}px" role="group" aria-label="Floorplan position">
						<label>x <ValidatedNumberInput value={ctl.placement.offsetX * ctl.k} {precision} step={ctl.snapStep} oncommit={(v) => ctl.setOffset('offsetX', v)} /></label>
						<label>y <ValidatedNumberInput value={ctl.placement.offsetY * ctl.k} {precision} step={ctl.snapStep} oncommit={(v) => ctl.setOffset('offsetY', v)} /></label>
						<span>{ctl.unit}</span>
					</div>
				{/if}
				{#if ctl.measure?.b}
					<div class="measure-popover" role="dialog" aria-label="Set scale">
						<span class="popover-title">How long is this line?</span>
						<span>{Math.round(ctl.measuredPixels)} px =</span>
						<label class="visually-hidden" for="measured-distance">Measured distance</label>
						<input
							id="measured-distance"
							type="number"
							inputmode="decimal"
							min="0"
							step="any"
							placeholder="distance"
							value={ctl.measuredDistance ?? ''}
							oninput={(e) => { const v = parseFloat((e.currentTarget as HTMLInputElement).value); ctl.measuredDistance = Number.isFinite(v) ? v : null; }}
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ctl.confirmMeasure(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ctl.cancelMeasure(); } }}
						/>
						<select class="measure-units" value={units} onchange={ctl.handleUnitsChange} aria-label="Distance units">
							{#each LENGTH_UNITS as u (u)}
								<option value={u}>{unitAbbrev(u)}</option>
							{/each}
						</select>
						<button type="button" class="primary" disabled={!(ctl.measuredDistance && ctl.measuredDistance > 0)} onclick={ctl.confirmMeasure}>OK</button>
						<button type="button" class="secondary" onclick={ctl.cancelMeasure}>Cancel</button>
					</div>
				{/if}
			{/snippet}
		</PlanCanvas>
	{/if}

	{#if toolbar && !readonly && ctl.context !== 'reflectance' && ctl.context !== 'view' && !(ctl.onCeiling && !ctl.selectedCeilingItem && !ctl.tilesActive)}
		<div class="plan-toolbar">
			{#if ctl.onOutline}
				<button type="button" class="tool" class:active={ctl.drawing} disabled={ctl.drawing} onclick={ctl.requestNewOutline} title="Draw the room outline: click its corners">Draw</button>
				<button type="button" class="tool" class:active={!ctl.drawing && !ctl.planSelected} disabled={ctl.drawing} onclick={() => (ctl.planSelected = false)} title="Drag corners or walls; click a midpoint to add one">Edit corners</button>
				{#if ctl.hasImage}
				<button type="button" class="tool" class:active={ctl.planSelected} aria-pressed={ctl.planSelected} disabled={ctl.drawing} onclick={() => (ctl.planSelected = !ctl.planSelected)} title="Drag the floor plan image to move it">Move image</button>
				{/if}
			{:else if ctl.onObstacles}
				<button type="button" class="tool draw-tool" class:active={ctl.drawing} onclick={() => ctl.drawing ? ctl.stopObstacleDraw() : ctl.startObstacleDraw()} title="Draw a structure: click its corners; Enter or the first corner closes it. New structures reach floor to ceiling; set Bottom and Top after (Esc cancels)">Draw</button>
				<button type="button" class="tool" disabled={!ctl.selected || ctl.drawing} onclick={ctl.duplicateSelected} title="Copy the selected structure (Ctrl+D)">Copy</button>
				<button type="button" class="tool" disabled={!ctl.selected || ctl.drawing} onclick={ctl.deleteSelected} title="Remove the selected structure (Delete)">Delete</button>
			{:else if ctl.onLamps}
				<button type="button" class="tool icon-label" class:active={ctl.lampMode === 'move' && lamps.length > 0} aria-pressed={ctl.lampMode === 'move'} disabled={!lamps.length} onclick={() => (ctl.lampMode = 'move')} title="Drag lamps to move them (M)">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></svg>
					Move
				</button>
				<button type="button" class="tool icon-label" class:active={ctl.lampMode === 'aim' && lamps.length > 0} aria-pressed={ctl.lampMode === 'aim'} disabled={!lamps.length} onclick={() => (ctl.lampMode = 'aim')} title="Drag from a lamp to where it should point (A)">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><line x1="12" y1="1" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="23" /><line x1="1" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="23" y2="12" /></svg>
					Aim
				</button>
				<button type="button" class="tool icon-label" disabled={!lamps.length || !ctl.liveLampIds.length} onclick={ctl.copySelectedLamps} title="Copy the selected lamps (Ctrl+D)">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
					Copy
				</button>
				<button type="button" class="tool icon-label" disabled={!lamps.length || !ctl.liveLampIds.length} onclick={ctl.deleteSelectedLamps} title="Remove the selected lamps (Delete)">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
					Delete
				</button>
			{:else if ctl.onCeiling}
				{#if ctl.selectedCeilingItem}
					<button type="button" class="tool icon-label" disabled={ctl.drawing} onclick={ctl.copySelectedCeilingItem} title="Copy (Ctrl+D)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
						Copy
					</button>
					<button type="button" class="tool icon-label" disabled={ctl.drawing} onclick={ctl.deleteSelectedCeilingItem} title="Delete">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
						Delete
					</button>
				{:else}
					<button type="button" class="tool icon-label" class:active={ctl.gridMove} aria-pressed={ctl.gridMove} onclick={ctl.toggleGridMove} title="Drag the tile grid to line it up">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></svg>
						Move grid
					</button>
				{/if}
			{:else if ctl.onZones}
				<button type="button" class="tool" disabled={!ctl.selectedZone || ctl.placing || ctl.drawing} onclick={ctl.copySelectedZone} title="Copy the selected zone (Ctrl+D)">Copy</button>
				<button type="button" class="tool" disabled={!ctl.selectedZone || ctl.placing || ctl.drawing} onclick={ctl.deleteSelectedZone} title="Remove the selected zone (Delete)">Delete</button>
			{/if}
		</div>
	{/if}
</div>

{#if !readonly}
	{#if ctl.pendingLeave}
		{@const footprint = ctl.onObstacles || ctl.onZones}
		<ConfirmDialog
			title={footprint ? 'Footprint not saved' : 'Outline not saved'}
			message={footprint
				? "The footprint on screen isn't valid, so it wasn't applied. Keep the last saved footprint, or go back and fix it."
				: "The outline on screen isn't valid, so it wasn't applied. Keep the last saved outline, or go back and fix it."}
			confirmLabel={footprint ? 'Keep saved footprint' : 'Keep saved outline'}
			cancelLabel="Keep editing"
			variant="warning"
			onConfirm={() => ctl.resolveLeave('keep-saved')}
			onCancel={() => ctl.resolveLeave('stay')}
		/>
	{/if}
	{#if ctl.askNewOutline}
		<ConfirmDialog
			title="Start a new outline?"
			message="This removes the {ctl.draft.length} corner{ctl.draft.length === 1 ? '' : 's'} of the current outline so you can draw it again from scratch. Cancelling the drawing before three corners restores them."
			confirmLabel="Clear and draw"
			cancelLabel="Keep"
			variant="warning"
			onConfirm={ctl.startDraw}
			onCancel={() => ctl.askNewOutline = false}
		/>
	{/if}

	{#if ctl.askClearOutline}
		<ConfirmDialog
			title="Clear the old outline?"
			message="The floorplan is loaded. Remove the existing corners so you can trace the room fresh, or keep them."
			confirmLabel="Clear"
			cancelLabel="Keep"
			variant="warning"
			onConfirm={() => ctl.answerClearOutline(true)}
			onCancel={() => ctl.answerClearOutline(false)}
		/>
	{/if}

	{#if ctl.askTrace}
		<ConfirmDialog
			title="Trace the room outline"
			message="Place at least three points on the plan to mark the room's corners."
			confirmLabel="Start tracing"
			cancelLabel="Later"
			variant="success"
			onConfirm={() => ctl.answerTrace(true)}
			onCancel={() => ctl.answerTrace(false)}
		/>
	{/if}

	{#if ctl.askSetScale}
		<ConfirmDialog
			title="Set the scale now?"
			message="Click two points on the plan a known distance apart and type that distance. You can also do this later with Set scale."
			confirmLabel="Set scale now"
			cancelLabel="Later"
			variant="success"
			onConfirm={() => ctl.answerSetScale(true)}
			onCancel={() => ctl.answerSetScale(false)}
		/>
	{/if}
{/if}

<style>
	.plan-pane {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}
	.plan-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
		align-items: center;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		height: 1.9rem;
		padding: 0 10px;
		font-size: var(--font-size-sm, var(--font-size-base));
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}
	.tool:hover {
		background: var(--color-border);
		border-color: var(--color-text-muted);
	}
	.tool.icon-label {
		gap: 5px;
	}
	.tool:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.tool:disabled:hover {
		background: var(--color-bg-tertiary);
		border-color: var(--color-border);
	}
	.tool.active {
		background: var(--color-highlight);
		color: var(--color-bg, #fff);
		border-color: var(--color-highlight);
	}
	.plan-image {
		pointer-events: none;
		image-rendering: auto;
	}
	.plan-image.interactive {
		pointer-events: all;
		cursor: pointer;
	}
	.plan-image.selected {
		cursor: grab;
	}
	.plan-outline {
		fill: none;
		stroke: var(--color-highlight);
		pointer-events: none;
	}
	.plan-readout {
		position: absolute;
		display: flex;
		gap: var(--spacing-xs);
		align-items: center;
		padding: 3px 6px;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background: var(--color-bg, #fff);
		border: 1px solid var(--color-highlight);
		border-radius: var(--radius-sm, 4px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
	}
	.plan-readout label {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.plan-readout :global(input) {
		width: 4.2rem;
		padding: 2px 4px;
		font-size: var(--font-size-xs);
	}
	.measure-line {
		stroke: var(--color-accent);
	}
	.measure-dot {
		fill: var(--color-bg, #fff);
		stroke: var(--color-accent);
	}
	.measure-popover {
		position: absolute;
		left: 50%;
		top: 12px;
		transform: translateX(-50%);
		display: flex;
		gap: var(--spacing-xs);
		align-items: center;
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm, var(--font-size-base));
		background: var(--color-bg, #fff);
		border: 2px solid var(--color-accent);
		border-radius: var(--radius-sm, 4px);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
		width: max-content;
		max-width: calc(100% - 24px);
		white-space: nowrap;
	}
	.measure-popover .popover-title {
		font-weight: 600;
		margin-right: var(--spacing-xs);
	}
	.measure-popover input {
		width: 5.5rem;
	}
	.measure-popover .measure-units {
		width: auto;
		min-width: 0;
	}
	.marquee {
		fill: color-mix(in srgb, var(--color-highlight) 10%, transparent);
		stroke: var(--color-highlight);
		pointer-events: none;
	}
	.plan-hit {
		fill: transparent;
		stroke: none;
		pointer-events: all;
		cursor: grab;
	}
	.plan-hit.aiming,
	.plan-hit.aim {
		cursor: crosshair;
	}
	.plan-lamp.aiming {
		cursor: crosshair;
	}
	.plan-lamp {
		fill: none;
		stroke: var(--color-warning, #f5a524);
		pointer-events: stroke;
		cursor: grab;
	}
	.plan-lamp.selected {
		stroke: var(--color-accent);
	}
	.plan-lamp.off {
		stroke-opacity: 0.45;
	}
	.plan-lamp.ghost {
		stroke-opacity: 0.5;
		pointer-events: none;
	}
	.plan-aim {
		fill: var(--color-warning, #f5a524);
		stroke: var(--color-bg, #fff);
		stroke-width: 0;
		cursor: crosshair;
	}
	.plan-aim.selected {
		fill: var(--color-accent);
	}
	.aim-line {
		stroke: var(--color-warning, #f5a524);
		opacity: 0.8;
		pointer-events: none;
	}
	.aim-line.selected {
		stroke: var(--color-accent);
		opacity: 1;
	}
	.plan-lamp.point,
	.aim-line.point {
		stroke: var(--color-info, #3b9eff);
	}
	.plan-aim.point {
		fill: var(--color-info, #3b9eff);
	}
	.plan-lamp.point.selected,
	.aim-line.point.selected {
		stroke: var(--color-accent);
	}
	.plan-zone {
		fill: color-mix(in srgb, var(--color-info, #3b9eff) 12%, transparent);
		stroke: var(--color-info, #3b9eff);
		cursor: pointer;
	}
	.plan-zone.volume {
		fill: color-mix(in srgb, var(--color-info, #3b9eff) 22%, transparent);
	}
	.plan-zone.off {
		fill: none;
		stroke-opacity: 0.5;
	}
	.plan-shape-label {
		fill: var(--color-text, #1f2328);
		pointer-events: none;
		user-select: none;
		font-weight: 600;
	}
	.plan-lamp-label {
		fill: var(--color-text, #1f2328);
		paint-order: stroke;
		stroke: var(--color-bg, #fff);
		stroke-width: 0.25em;
		stroke-linejoin: round;
		pointer-events: none;
	}
	.surface-highlight {
		fill: color-mix(in srgb, var(--color-accent) 10%, transparent);
		stroke: var(--color-accent);
		stroke-linejoin: round;
		pointer-events: none;
	}
	.ceiling-fill {
		fill: color-mix(in srgb, var(--color-primary) 5%, transparent);
		stroke: none;
		pointer-events: none;
	}
	.tile-line {
		stroke: var(--color-text-muted);
		stroke-opacity: 0.45;
		pointer-events: none;
	}
	.ceiling-keep {
		fill: color-mix(in srgb, var(--color-danger) 10%, transparent);
		stroke: var(--color-danger);
		stroke-linejoin: round;
		cursor: pointer;
	}
	.ceiling-item {
		color: var(--color-warning);
		cursor: move;
	}
	.ceiling-item.selected {
		color: var(--color-scene-selected);
	}
	.ceiling-hit {
		fill: transparent;
		stroke: none;
		pointer-events: all;
	}
	.ceiling-ring {
		fill: none;
		stroke: var(--color-scene-selected);
		pointer-events: none;
	}
	.ceiling-item :global(svg) {
		pointer-events: none;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>

