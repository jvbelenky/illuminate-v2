<script lang="ts">
	// The 2D pane: the plan canvas, the per-context toolbar under it, and the
	// prompts that belong to the canvas (leave-confirm, new outline, image).
	// All editing state lives in the PlanController; this is a view over it.
	// Exactly one PlanPane hosts a given controller: it follows the stored
	// polygon, takes over Ctrl+Z, and handles the plan's keyboard shortcuts.
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import PlanCanvas, { type PlanShape, type CanvasContext } from '$lib/components/PlanCanvas.svelte';
	import { tick, untrack } from 'svelte';
	import { setUndoInterceptor } from '$lib/utils/undoKeys';
	import { zoneFootprint } from '$lib/utils/zoneFootprint';
	import { unitAbbrev, LENGTH_UNITS } from '$lib/utils/unitConversion';
	import type { Vertex } from '$lib/utils/roomGeometry';
	import CeilingIcon from '$lib/ceiling/CeilingIcon.svelte';
	import SurfaceSwitcher from './SurfaceSwitcher.svelte';
	import PlanEditStrip from './PlanEditStrip.svelte';
	import { userSettings } from '$lib/stores/settings';
	import { pickMode } from '$lib/stores/pickMode';
	import { surfaceName } from '$lib/utils/surfaces';
	import { planShouldHandleKey, type PlanController } from './planController.svelte';

	interface Props {
		controller: PlanController;
		/** Summary use: no handles, no toolbar, nothing draggable, no keyboard. */
		readonly?: boolean;
		/** Show the surface switcher over the canvas and the edit strip under it (the desktop shows both on the main view instead). */
		toolbar?: boolean;
		/** Route Escape to the controller; off for a host that forwards it itself (the page: +page.svelte passes handleEscape={false}). */
		handleEscape?: boolean;
		/** The docked mini view: drawn read-only, no toolbar, no view tools, no keyboard; drag pans and the wheel zooms. */
		mini?: boolean;
	}

	let { controller, readonly = false, toolbar = true, handleEscape = true, mini = false }: Props = $props();

	// Read-only rendering: the summary, or the mini view
	const ro = $derived(readonly || mini);

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

	// Read-only (summary, mini view): the selection and the hovered row still show
	const hovered = (kind: 'lamps' | 'zones' | 'objects') => (ctl.hoveredItem?.kind === kind ? ctl.hoveredItem.id : null);
	const roShapes = $derived<PlanShape[]>(
		ctl.obstacles.map((o) => {
			const selected = o.id === ctl.selectedId;
			const highlighted = !selected && hovered('objects') === o.id;
			return { id: o.key, vertices: o.vertices, name: o.name, selected, highlighted, dimmed: !selected && !highlighted, disabled: !o.enabled };
		})
	);
	const roHighlightedLamps = $derived(hovered('lamps') ? [hovered('lamps')!] : []);
	const roZones = $derived(
		ctl.surfaceZones
			.filter((z) => z.id === ctl.selectedZoneId || z.id === hovered('zones'))
			.map((z) => ({ id: z.id, volume: z.type === 'volume', selected: z.id === ctl.selectedZoneId, footprint: zoneFootprint(z) }))
	);
	// Wall planes on the read-only wall view: the selected or hovered one
	const roWallPlanes = $derived((ctl.wallView?.planes ?? []).filter((z) => z.id === ctl.selectedZoneId || z.id === hovered('zones')));
	/** A zone outline picked on the canvas (not mid-draw or mid-place). */
	function zoneDown(e: PointerEvent, id: string) {
		if (ctl.drawing || ctl.placing || ctl.pointPick || e.button !== 0) return;
		e.stopPropagation();
		ctl.clickZone(id);
	}

	function onKey(event: KeyboardEvent) {
		// Only keys meant for the plan: not behind a dialog, not in the results column
		if (!planShouldHandleKey(event)) return;
		const key = event.key.toLowerCase();
		if ((key === 'h' || key === 'z') && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
			event.preventDefault();
			userSettings.update((st) => ({ ...st, planNavMode: key === 'h' ? 'hand' : 'zoom' }));
			return;
		}
		ctl.onWindowKey(event);
		if (handleEscape && event.key === 'Escape') ctl.onEscapeKey();
	}

	// An empty polygon for the read-only canvas to bind
	let roDraft = $state<Vertex[]>([]);
	// The read-only wall view edits nothing, so it binds an empty polygon too
	let wallDraft = $state<Vertex[]>([]);
	const wallLabel = $derived(`${surfaceName(ctl.surface)} elevation`);
	// A point's Place or Aim pick runs on the plan while it is the main view
	$effect(() => {
		ctl.syncPointPick(!mini && !ro ? $pickMode : null);
	});
	/** Pixels Fit keeps clear top and bottom for the main view's corner controls: 36 px control + 8 px inset. */
	const FIT_INSET = 52;
	let roCanvas = $state<PlanCanvas | null>(null);

	// Fit the room again when the controller asks (another project was opened, a
	// typed room size). After a tick, so the canvas has the new outline first.
	$effect(() => {
		if (ctl.fitRequest === 0) return;
		untrack(() => tick().then(() => (ro ? roCanvas : ctl.canvas)?.fitView()));
	});

	// Follow the stored polygon (an undo, a units switch, a backend nudge), except
	// mid-gesture or while a local invalid edit is on screen.
	$effect(() => {
		if (ro) return;
		const src = ctl.source;
		untrack(() => ctl.followSource(src));
	});

	// While drawing, Ctrl+Z drops the last corner; with an invalid edit on
	// screen it drops that edit. Otherwise the app-wide undo runs.
	$effect(() => {
		if (ro) return;
		setUndoInterceptor((key) => key === 'undo' && ctl.undoInterceptor());
		return () => setUndoInterceptor(null);
	});

	// Focus the distance field as soon as the popover appears, so the user can type
	// the measurement straight after the second click.
	$effect(() => {
		if (ro) return;
		if (ctl.measure?.b) document.getElementById('measured-distance')?.focus();
	});
</script>

<svelte:window onkeydown={ro ? undefined : onKey} />

<!-- The walls meeting this one, under its bottom corners -->
{#snippet neighbours(c: CanvasContext, labels: { left: string; right: string }, length: number)}
	{@const l = c.toScreen(0, 0)}
	{@const r = c.toScreen(length, 0)}
	<span class="wall-neighbour left" style="left: {l[0]}px; top: {l[1] + 6}px">{labels.left}</span>
	<span class="wall-neighbour right" style="left: {r[0]}px; top: {r[1] + 6}px">{labels.right}</span>
{/snippet}

<div class="plan-pane" class:mini data-plan-scope>
	{#if toolbar && !ro}
		<div class="surface-row">
			<SurfaceSwitcher surface={ctl.surface} surfaces={ctl.surfaces} onSelect={ctl.setSurface} />
		</div>
	{/if}

	{#if ctl.wallView}
		<!-- A wall, face-on as seen from inside (wallToCanvas): what stands in front of it, faded by distance -->
		{@const wv = ctl.wallView}
		{#if ro}
			<PlanCanvas
				fitInset={mini || readonly ? 0 : FIT_INSET}
				bind:this={roCanvas}
				navControls={!mini}
				bind:draft={wallDraft}
				{units}
				onUnitsChange={mini ? undefined : ctl.handleUnitsChange}
				{precision}
				fallbackFit={wv.outline}
				lamps={wv.lamps}
				lampOpacity={wv.lampOpacity}
				selectedLampIds={ctl.selectedLampIds}
				highlightedLampIds={roHighlightedLamps}
				objects={[]}
				shapes={wv.shapes}
				outline={wv.outline}
				ariaLabel={wallLabel}
			>
				{#snippet overlay(c)}
					{#each roWallPlanes as z (z.id)}
						<polygon class="ro-zone" class:selected={z.id === ctl.selectedZoneId} class:highlighted={z.id !== ctl.selectedZoneId} points={points(z.vertices)} stroke-width={c.px * 2} stroke-dasharray="{c.px * 6} {c.px * 3}" />
					{/each}
				{/snippet}
				{#snippet hud(c)}{@render neighbours(c, wv.labels, wv.outline[1][0])}{/snippet}
			</PlanCanvas>
		{:else}
			<PlanCanvas
				fitInset={mini || readonly ? 0 : FIT_INSET}
				bind:this={ctl.canvas}
				bind:draft={ctl.draft}
				bind:drawing={ctl.drawing}
				bind:selectedIndex={ctl.selectedIndex}
				bind:tool={ctl.tool}
				{units}
				onUnitsChange={mini ? undefined : ctl.handleUnitsChange}
				{precision}
				fallbackFit={wv.outline}
				lamps={wv.lamps}
				lampOpacity={wv.lampOpacity}
				selectedLampIds={ctl.selectedLampIds}
				objects={[]}
				shapes={wv.shapes}
				outline={wv.outline}
				draggableBody={ctl.onZones && !!ctl.selectedWallPlane}
				onDrawEnd={ctl.onDrawEnd}
				onEdit={ctl.commitDraft}
				invalid={!ctl.drawing && ctl.validationMessage !== null && ctl.draft.length >= 3}
				onShapeClick={ctl.onObstacles ? ctl.onWallShapeDown : undefined}
				onHostMove={ctl.onHostMove}
				onHostPointerUp={ctl.onHostPointerUp}
				onHostCancel={ctl.cancelHostDrag}
				ariaLabel={wallLabel}
			>
				{#snippet overlay(c)}
					{#if ctl.pointPick && ctl.placeCursor}
						<circle class="plan-lamp ghost point" cx={ctl.placeCursor[0]} cy={-ctl.placeCursor[1]} r={c.handleR * 1.5} stroke-width={c.handleR * 0.9} />
					{/if}
					{#if ctl.onZones}
						{#each wv.planes.filter((z) => z.id !== ctl.selectedZoneId || ctl.drawing) as z (z.id)}
							<polygon class="plan-zone" class:off={!z.enabled} points={points(z.vertices)} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 6} {c.px * 3}" role="button" tabindex="-1" aria-label="Zone {z.name}" onpointerdown={(e) => zoneDown(e, z.id)} />
						{/each}
					{/if}
					{#if ctl.onLamps}
						{#each wv.lamps as l (l.id)}
							<circle class="plan-hit" cx={l.x} cy={-l.y} r={Math.max(c.handleR * 1.5, c.hitPx * 11.7)} role="button" tabindex="-1" aria-label="Lamp {l.name || l.id}" onpointerdown={(e) => ctl.onMarkerPointerDown(e, l.id, 'body')} />
						{/each}
					{/if}
				{/snippet}
				{#snippet hud(c)}{@render neighbours(c, wv.labels, wv.outline[1][0])}{/snippet}
			</PlanCanvas>
		{/if}
	{:else if ro}
		<PlanCanvas
			fitInset={mini || readonly ? 0 : FIT_INSET}
			bind:this={roCanvas}
			navControls={!mini}
			bind:draft={roDraft}
			{units}
			onUnitsChange={mini ? undefined : ctl.handleUnitsChange}
			{precision}
			fallbackFit={vertices}
			extraFitPoints={ctl.imageFitPoints}
			{lamps}
			selectedLampIds={ctl.selectedLampIds}
			highlightedLampIds={roHighlightedLamps}
			objects={[]}
			shapes={roShapes}
			outline={vertices}
			ariaLabel="Floor plan canvas"
		>
			{#snippet overlay(c)}
				{#each roZones as z (z.id)}
					<polygon class="ro-zone" class:volume={z.volume} class:selected={z.selected} class:highlighted={!z.selected} points={points(z.footprint)} stroke-width={c.px * 2} stroke-dasharray="{c.px * 6} {c.px * 3}" />
				{/each}
			{/snippet}
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
			fitInset={mini || readonly ? 0 : FIT_INSET}
			bind:this={ctl.canvas}
			bind:draft={ctl.draft}
			bind:drawing={ctl.drawing}
			bind:selectedIndex={ctl.selectedIndex}
			bind:tool={ctl.tool}
			{units}
			onUnitsChange={mini ? undefined : ctl.handleUnitsChange}
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
			onHostCancel={ctl.cancelHostDrag}
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
					{#if ctl.surface === 'floor'}
						{#each ctl.wallPlaneLines as l (l.id)}
							<line class="plan-zone wall-plane" class:off={!l.enabled} x1={l.x1} y1={-l.y1} x2={l.x2} y2={-l.y2} stroke-width={c.px * 6} role="button" tabindex="-1" aria-label="Zone {l.name}" onpointerdown={(e) => zoneDown(e, l.id)} />
						{/each}
					{/if}
					{#each ctl.surfaceZones.filter((z) => z.id !== ctl.selectedZoneId || ctl.drawing) as z (z.id)}
						{@const fp = zoneFootprint(z)}
						<polygon class="plan-zone" class:volume={z.type === 'volume'} class:off={z.enabled === false} points={fp.map(([x, y]) => `${x},${-y}`).join(' ')} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 6} {c.px * 3}" role="button" tabindex="-1" aria-label="Zone {z.name || z.id}" onpointerdown={(e) => zoneDown(e, z.id)} />
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
					{#if (ctl.placing || ctl.pointPick) && ctl.placeCursor}
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

	{#if toolbar && !ro}
		<div class="pane-strip"><PlanEditStrip controller={ctl} /></div>
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
	.surface-row,
	.pane-strip {
		display: flex;
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
	.ro-zone {
		fill: color-mix(in srgb, var(--color-scene-selected) 14%, transparent);
		stroke: var(--color-scene-selected);
		pointer-events: none;
	}
	.ro-zone.highlighted {
		fill: color-mix(in srgb, var(--color-scene-selected) 8%, transparent);
		stroke-opacity: 0.6;
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
	.plan-zone.wall-plane {
		stroke-linecap: round;
		stroke-opacity: 0.75;
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
	.wall-neighbour {
		position: absolute;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
		pointer-events: none;
	}
	.wall-neighbour.right {
		transform: translateX(-100%);
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>

