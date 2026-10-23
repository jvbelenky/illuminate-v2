<script module lang="ts">
	export type PlanStep = 'outline' | 'obstacles' | 'lamps' | 'zones' | 'reflectance';

	/** The guided steps, in order. */
	export const PLAN_STEPS: readonly { id: PlanStep; title: string }[] = [
		{ id: 'outline', title: 'Outline' },
		{ id: 'obstacles', title: 'Obstacles' },
		{ id: 'lamps', title: 'Lamps' },
		{ id: 'zones', title: 'Calc zones' },
		{ id: 'reflectance', title: 'Reflectance' },
	];
</script>

<script lang="ts">
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import ReflectanceStep from './ReflectanceStep.svelte';
	import PlanCanvas from './PlanCanvas.svelte';
	import { onMount, onDestroy, untrack, type Snippet } from 'svelte';
	import { objectTop, objectHeightText } from '$lib/utils/objectHeight';
	import { project, lampHasPhotometry } from '$lib/stores/project';
	import { setUndoInterceptor, undoShortcut, redoShortcut } from '$lib/utils/undoKeys';
	import { zoneFootprint } from '$lib/utils/zoneFootprint';
	import { unitAbbrev, LENGTH_UNITS, type LengthUnit } from '$lib/utils/unitConversion';
	import type { Vertex } from '$lib/utils/roomGeometry';
	import type { CalcZone, FloorPlanPlacement, LampInstance, SceneObject } from '$lib/types/project';
	import type { FloorPlanImage } from '$lib/stores/floorplanImage';
	import type { PlacementMode } from '$lib/utils/lampPlacement';
	import type { FixtureOption } from '$lib/utils/lampFixture';
	import type { PlanActions } from '$lib/plan/planActions';
	import { PlanController } from '$lib/plan/planController.svelte';

	interface Props {
		/** The room outline (CCW, display units). */
		vertices: Vertex[];
		units: LengthUnit;
		precision: number;
		/** The lamps: placed, moved and aimed on the Lamps step, dots for context elsewhere. */
		lamps?: LampInstance[];
		/** The obstacles, edited on the Obstacles step. */
		objects?: SceneObject[];
		/** Current reference-image placement (meters), if any. */
		floorplan?: FloorPlanPlacement | null;
		/** Current reference image; null with a placement means it could not be restored. */
		image?: FloorPlanImage | null;
		/** Applies each finished edit. */
		actions: PlanActions;
		onClose: () => void;
		/** Room height (display units), for floor-to-ceiling obstacles. */
		roomZ?: number;
		/** Which step opens first, and on the Obstacles step which obstacle is selected or whether Draw is armed. */
		initialStep?: PlanStep;
		initialObstacleId?: string | null;
		armDraw?: boolean;
		/** Open the per-surface reflectance editor (Reflectance step). */
		onShowReflectanceSettings?: () => void;
		/** The full editor for the selected lamp (fixture, height, aim, tilt), with a callback that deselects it. */
		lampPanel?: Snippet<[LampInstance, () => void]>;
		/** Fixtures the Add lamp selector offers (presets and the custom lamp library). */
		fixtures?: FixtureOption[];
		/** Open the custom lamp manager ("Add custom lamp…"). */
		onAddCustomLamp?: () => void;
		/** Calc zones: drawn and placed on the Calc zones step (standard zones are left out). */
		zones?: CalcZone[];
		/** The full editor for the selected zone, with a callback that deselects it. */
		zonePanel?: Snippet<[CalcZone, () => void]>;
	}

	let { vertices, units, precision, lamps = [], objects = [], floorplan = null, image = null, actions, onClose, roomZ = 2.7, initialStep = 'outline', initialObstacleId = null, armDraw = false, onShowReflectanceSettings = () => {}, lampPanel, zones = [], zonePanel, fixtures = [], onAddCustomLamp = () => {} }: Props = $props();

	// The editing state and behaviour live in the controller; this modal is a view over it.
	const history = project.history;
	const hidden = $derived({
		lamps: new Set($project.hidden?.lamps ?? []),
		zones: new Set($project.hidden?.zones ?? []),
		objects: new Set($project.hidden?.objects ?? []),
	});
	// svelte-ignore state_referenced_locally
	const ctl = new PlanController({
		actions,
		scene: () => ({ vertices, units, precision, lamps, objects, zones, floorplan, image, roomZ, fixtures, room: $project.room, hidden }),
	});
	// svelte-ignore state_referenced_locally
	ctl.setContext(initialStep);

	// Follow the stored polygon (an undo, a units switch, a backend nudge), except
	// mid-gesture or while a local invalid edit is on screen.
	$effect(() => {
		const src = ctl.source;
		untrack(() => ctl.followSource(src));
	});

	// --- Steps
	const stepIndex = $derived(PLAN_STEPS.findIndex((s) => s.id === ctl.context));
	const nextStep = $derived(PLAN_STEPS[stepIndex + 1] ?? null);
	const prevStep = $derived(stepIndex > 0 ? PLAN_STEPS[stepIndex - 1] : null);

	// Leaving a step (or closing) with an invalid outline asks first
	function goStep(next: PlanStep) {
		if (next === ctl.context) return;
		ctl.requestLeave(() => ctl.setContext(next));
	}

	function requestClose() {
		ctl.requestLeave(onClose);
	}

	// --- Add lamp (right panel): choose a fixture, then each placement button
	// adds one, placed automatically
	let fixtureSelect = $state<HTMLSelectElement | undefined>(undefined);
	const PLACEMENTS: { mode: PlacementMode; label: string; title: string }[] = [
		{ mode: 'downlight', label: 'Downlight', title: 'On the ceiling, aimed straight down, where it adds the most coverage' },
		{ mode: 'corner', label: 'Corner', title: 'High in a corner, aimed across the room (each click takes the next free corner)' },
		{ mode: 'edge', label: 'Edge', title: 'High on a wall, aimed into the room (each click takes the next free wall)' },
		{ mode: 'horizontal', label: 'Horizontal', title: 'High on a wall, aimed level across the room for upper-room use' },
	];
	function chooseFixture(select: HTMLSelectElement) {
		if (select.value === '__add_custom__') {
			select.value = ctl.addFixture;
			onAddCustomLamp();
			return;
		}
		ctl.addFixture = select.value;
	}

	onMount(() => {
		// While drawing, Ctrl+Z drops the last corner; with an invalid edit on
		// screen it drops that edit. Otherwise the app-wide undo runs.
		setUndoInterceptor((key) => key === 'undo' && ctl.undoInterceptor());
		// Children are mounted (and `canvas` bound) before this runs
		if (initialStep === 'lamps' && armDraw) fixtureSelect?.focus();
		if (initialStep !== 'obstacles') return;
		if (initialObstacleId) ctl.selectObstacle(initialObstacleId);
		else if (armDraw) ctl.startObstacleDraw();
	});
	onDestroy(() => setUndoInterceptor(null));

	// --- Reference image
	let fileInput = $state<HTMLInputElement | undefined>(undefined);
	function chooseFile() {
		fileInput?.click();
	}
	function onFileInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) ctl.onFileChosen(file);
	}

	// Focus the distance field as soon as the popover appears, so the user can type
	// the measurement straight after the second click.
	$effect(() => {
		if (ctl.measure?.b) document.getElementById('measured-distance')?.focus();
	});

	function stepDone(id: PlanStep): boolean {
		if (id === 'outline') return ctl.hasOutline;
		if (id === 'obstacles') return ctl.obstacles.length > 0;
		if (id === 'lamps') return lamps.length > 0;
		if (id === 'zones') return ctl.userZones.length > 0;
		return false;
	}

	// One-line "what next" hint under the toolbar, for every state of the editor
	const hint = $derived.by(() => {
		if (ctl.onReflectance) return 'Point at a surface in the list to find it on the plan';
		if (ctl.onZones) {
			if (ctl.drawing) return ctl.draft.length < 3 ? `Click the corners of the ${ctl.drawKind ?? 'zone'} (Esc cancels)` : 'Click the first corner or press Enter to close (Esc cancels)';
			if (ctl.placing) return 'Click where each calc point goes; Esc stops placing';
			if (ctl.selectedFootprint) return 'Drag to move, drag corners or walls to reshape; set its height and grid on the right';
			if (ctl.selectedZone?.type === 'point') return 'Drag the ring to move the point, the dot to aim it';
			return ctl.userZones.length ? 'Click a zone to select it, or draw or place another' : 'Draw a plane or volume, place a point, or press Next to skip';
		}
		if (ctl.onLamps) {
			if (!lamps.length) return 'Choose a fixture on the right, then a placement: each click adds a lamp';
			const n = ctl.selectedLampIds.length;
			if (n > 1) return ctl.lampMode === 'move' ? `${n} lamps selected: drag one to move them all; Delete removes them` : `${n} lamps selected: drag from one to where they should all point`;
			if (n === 1) return ctl.lampMode === 'move' ? 'Drag the lamp to move it, or its dot to aim it; Shift-click adds lamps to the selection' : 'Drag from the lamp to where it should point';
			return 'Click a lamp to select it, or drag a box around several (Shift-click adds one)';
		}
		if (ctl.onObstacles) {
			if (ctl.drawing) return ctl.draft.length < 3 ? 'Click the corners of the obstacle (Esc cancels)' : 'Click the first corner or press Enter to close (Esc cancels)';
			if (ctl.selected) return 'Drag to move, drag corners or walls to reshape; arrow keys nudge, Delete removes';
			return ctl.obstacles.length ? 'Click an obstacle to select it, or Draw a new one' : 'Draw an obstacle by clicking its corners, or press Next to skip';
		}
		if (ctl.tool === 'custom') return ctl.measure?.b ? 'Enter the distance' : ctl.measure ? 'Click the second point' : 'Click two points a known distance apart';
		if (ctl.drawing) return ctl.draft.length < 3 ? 'Esc cancels, Enter completes, Ctrl+Z removes the last corner' : 'Click the first corner or press Enter to close (Esc cancels)';
		if (ctl.planSelected) return 'Drag the plan to move it, or type its position (Esc deselects)';
		if (ctl.imageMissing) return 'Upload the floorplan again to restore it';
		if (!ctl.hasImage) return '';
		return 'Drag corners or walls; click a midpoint to add one';
	});
</script>

<svelte:window onkeydown={ctl.onWindowKey} />

<Modal title="Plan" onClose={requestClose} onEscapeKey={ctl.onEscapeKey} maxWidth="min(1280px, 96vw)" maxHeight="calc(100vh - 24px)" titleFontSize="1rem">
	{#snippet body()}
		<div class="floor-plan-modal">
			<nav class="layer-rail" aria-label="Plan steps">
				{#each PLAN_STEPS as s, i (s.id)}
					<button type="button" class="layer" class:active={ctl.context === s.id} aria-current={ctl.context === s.id ? 'step' : undefined} onclick={() => goStep(s.id)}>
						<span class="step-num" class:done={stepDone(s.id)} aria-hidden="true">{stepDone(s.id) ? '✓' : i + 1}</span>{s.title}{#if s.id === 'obstacles' && ctl.obstacles.length}<span class="layer-count">{ctl.obstacles.length}</span>{/if}
					</button>
				{/each}
			</nav>
			<div class="canvas-column">
				<div class="toolbar">
					{#if ctl.onOutline}
					<button type="button" class="tool" class:active={ctl.drawing} disabled={ctl.drawing} onclick={ctl.requestNewOutline} title="Start a new outline: click out its corners (click the first corner or press Enter to close, Escape cancels; fewer than three corners keeps the old outline)">
						New outline
					</button>
					<button type="button" class="tool" onclick={chooseFile} disabled={ctl.decoding} title="Upload a floor plan image (PNG, JPEG, WebP, GIF, SVG or PDF) to trace over">
						{ctl.decoding ? 'Reading…' : 'Upload floorplan…'}
					</button>
					<input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf" onchange={onFileInput} hidden />
					<button type="button" class="tool" class:active={ctl.tool === 'custom'} disabled={!ctl.hasImage} onclick={ctl.startSetScale} title={ctl.hasImage ? 'Click two points on the plan a known distance apart, then type that distance (Escape cancels)' : 'Upload a floorplan first'}>Set scale</button>
					{:else if ctl.onObstacles}
					<button type="button" class="tool draw-tool" class:active={ctl.drawing} onclick={() => ctl.drawing ? ctl.stopObstacleDraw() : ctl.startObstacleDraw()} title="Draw an obstacle: click its corners; Enter or the first corner closes it. New obstacles reach floor to ceiling; set Bottom and Top after (Esc cancels)">Draw</button>
					<button type="button" class="tool" disabled={!ctl.selected || ctl.drawing} onclick={ctl.duplicateSelected} title="Copy the selected obstacle (Ctrl+D)">Copy</button>
					<button type="button" class="tool" disabled={!ctl.selected || ctl.drawing} onclick={ctl.deleteSelected} title="Remove the selected obstacle (Delete)">Delete</button>
					{:else if ctl.onLamps}
					<button type="button" class="tool icon-label" class:active={ctl.lampMode === 'move' && lamps.length > 0} aria-pressed={ctl.lampMode === 'move'} disabled={!lamps.length} onclick={() => (ctl.lampMode = 'move')} title="Drag lamps to move them (M)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></svg>
						Move
					</button>
					<button type="button" class="tool icon-label" class:active={ctl.lampMode === 'aim' && lamps.length > 0} aria-pressed={ctl.lampMode === 'aim'} disabled={!lamps.length} onclick={() => (ctl.lampMode = 'aim')} title="Drag from a lamp to where it should point (A)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><line x1="12" y1="1" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="23" /><line x1="1" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="23" y2="12" /></svg>
						Aim
					</button>
					<button type="button" class="tool icon-label" disabled={!lamps.length || !ctl.selectedLampIds.length} onclick={ctl.copySelectedLamps} title="Copy the selected lamps (Ctrl+D)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
						Copy
					</button>
					<button type="button" class="tool icon-label" disabled={!lamps.length || !ctl.selectedLampIds.length} onclick={ctl.deleteSelectedLamps} title="Remove the selected lamps (Delete)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
						Delete
					</button>
					{:else if ctl.onZones}
					<button type="button" class="tool" class:active={ctl.drawing && ctl.drawKind === 'plane'} onclick={() => ctl.startZoneDraw('plane')} title="Draw a calculation plane: click its corners (Enter or the first corner closes it); set its height after">Draw plane</button>
					<button type="button" class="tool" class:active={ctl.drawing && ctl.drawKind === 'volume'} onclick={() => ctl.startZoneDraw('volume')} title="Draw a calculation volume: click its footprint's corners; it spans floor to ceiling until you set its range">Draw volume</button>
					<button type="button" class="tool" class:active={ctl.placing} disabled={ctl.drawing} onclick={() => ctl.setPlacing(!ctl.placing)} title="Click on the plan to place calculation points (Esc stops)">Place point</button>
					<button type="button" class="tool" disabled={!ctl.selectedZone || ctl.placing || ctl.drawing} onclick={ctl.copySelectedZone} title="Copy the selected zone (Ctrl+D)">Copy</button>
					<button type="button" class="tool" disabled={!ctl.selectedZone || ctl.placing || ctl.drawing} onclick={ctl.deleteSelectedZone} title="Remove the selected zone (Delete)">Delete</button>
					{/if}
					<div class="toolbar-right">
					<button type="button" class="tool icon-tool" disabled={!$history.canUndo} onclick={() => history.undo()} aria-label="Undo" title={$history.undoLabel ? `Undo ${$history.undoLabel.toLowerCase()} (${undoShortcut})` : `Undo (${undoShortcut})`}>↶</button>
					<button type="button" class="tool icon-tool" disabled={!$history.canRedo} onclick={() => history.redo()} aria-label="Redo" title={$history.redoLabel ? `Redo ${$history.redoLabel.toLowerCase()} (${redoShortcut})` : `Redo (${redoShortcut})`}>↷</button>
					<select class="units-select" value={units} onchange={ctl.handleUnitsChange} title="Units" aria-label="Units">
						{#each LENGTH_UNITS as u (u)}
							<option value={u}>{unitAbbrev(u)}</option>
						{/each}
					</select>
					</div>
				</div>
				<p class="plan-hint" aria-live="polite">{hint}</p>

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
					shapes={ctl.shapes}
					outline={ctl.onOutline ? undefined : vertices}
					allowNegative={ctl.onObstacles}
					draggableBody={ctl.onObstacles || (ctl.onZones && !!ctl.selectedFootprint)}
					onShapeClick={ctl.onObstacles ? ctl.selectObstacle : undefined}
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
						{#if ctl.onZones}
							{#each ctl.footprintZones.filter((z) => z.id !== ctl.selectedZoneId || ctl.drawing) as z (z.id)}
								{@const fp = zoneFootprint(z)}
								<polygon class="plan-zone" class:volume={z.type === 'volume'} class:off={z.enabled === false} points={fp.map(([x, y]) => `${x},${-y}`).join(' ')} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 6} {c.px * 3}" role="button" tabindex="-1" aria-label="Zone {z.name || z.id}" onpointerdown={(e) => { if (ctl.drawing || ctl.placing || e.button !== 0) return; e.stopPropagation(); ctl.selectZone(z.id); }} />
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
								<circle class="plan-lamp" class:point={ctl.onZones} class:aiming={ctl.onLamps && ctl.lampMode === 'aim'} class:selected={sel} class:off={!m.enabled} cx={v.x} cy={-v.y} r={c.handleR * 1.5} stroke-width={c.handleR * 0.9} role="button" tabindex="-1" aria-label="{ctl.onLamps ? 'Lamp' : 'Point'} {m.name}" onpointerdown={(e) => ctl.onMarkerPointerDown(e, m.id, 'body')} />
								<circle class="plan-aim" class:point={ctl.onZones} class:selected={sel} cx={v.ax} cy={-v.ay} r={c.handleR * 0.7} role="button" tabindex="-1" aria-label="Aim of {m.name}" onpointerdown={(e) => ctl.onMarkerPointerDown(e, m.id, 'aim')} />
								<text class="plan-lamp-label" x={v.x + c.handleR * 2.3} y={-v.y + c.px * 4} font-size={c.px * 11}>{m.name}</text>
							{/each}
							{#if ctl.marquee}
								{@const mx = Math.min(ctl.marquee.a[0], ctl.marquee.b[0])}
								{@const my = Math.max(ctl.marquee.a[1], ctl.marquee.b[1])}
								<rect class="marquee" x={mx} y={-my} width={Math.abs(ctl.marquee.b[0] - ctl.marquee.a[0])} height={Math.abs(ctl.marquee.b[1] - ctl.marquee.a[1])} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 5} {c.px * 3}" />
							{/if}
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
			</div>

			<div class="side-column" class:wide={ctl.onReflectance || ctl.onLamps || ctl.onZones}>
				{#if ctl.onOutline}
				<div class="summary">
					<div><span class="summary-label">Floor area</span><span>{ctl.fmt(ctl.area)} {ctl.unit}²</span></div>
					{#if ctl.validationMessage && ctl.draft.length >= 3}
						<p class="plan-error" role="alert">Not saved: {ctl.validationMessage}</p>
					{:else if ctl.dirty && !ctl.drawing}
						<p class="plan-error" role="alert">Not saved: draw the new outline (the last saved one is kept until then)</p>
					{/if}
				</div>

				{#if ctl.placement || ctl.imageError}
					<div class="reference-panel">
						{#if ctl.imageError}
							<p class="plan-error" role="alert">{ctl.imageError}</p>
						{/if}
						{#if ctl.imageMissing}
							<p class="plan-note">The reference image could not be restored — upload it again to restore it (same file keeps the calibration).</p>
						{:else if ctl.placement}
							<div class="reference-meta">{ctl.imageFileName ?? 'Saved image'} · {ctl.placement.widthPx}×{ctl.placement.heightPx} px</div>
							{#if ctl.pdfPageCount > 1}
								<label class="reference-row">
									<span>Page</span>
									<select value={ctl.pdfPage} onchange={(e) => ctl.changePdfPage(Number((e.currentTarget as HTMLSelectElement).value))} aria-label="PDF page">
										{#each Array.from({ length: ctl.pdfPageCount }, (_, i) => i + 1) as n}
											<option value={n}>{n} of {ctl.pdfPageCount}</option>
										{/each}
									</select>
								</label>
							{/if}
							<label class="reference-row">
								<span>Opacity</span>
								<input type="range" min="0.1" max="1" step="0.05" value={ctl.placement.opacity} oninput={(e) => ctl.setOpacity(Number((e.currentTarget as HTMLInputElement).value))} onchange={ctl.commitOpacity} aria-label="Reference image opacity" />
							</label>
						{/if}
						{#if ctl.placement}
							<button type="button" class="secondary remove-image-btn" onclick={ctl.removeImage}>Remove</button>
						{/if}
					</div>
				{/if}

				<div class="vertex-table">
					<div class="vertex-header">
						<span></span>
						<span>X ({ctl.unit})</span>
						<span>Y ({ctl.unit})</span>
						<span></span>
					</div>
					<div class="vertex-rows">
						{#each ctl.draft as [vx, vy], i (i)}
							<div class="vertex-row" class:selected={ctl.selectedIndex === i}>
								<span class="row-index" title="Corner {i + 1}">{i + 1}</span>
								<ValidatedNumberInput value={vx} {precision} min={0} step={ctl.snapStep} disabled={ctl.drawing} oncommit={(v) => ctl.setVertexCoord(i, 0, v)} />
								<ValidatedNumberInput value={vy} {precision} min={0} step={ctl.snapStep} disabled={ctl.drawing} oncommit={(v) => ctl.setVertexCoord(i, 1, v)} />
								<button
									type="button"
									class="secondary remove-btn"
									title="Remove corner {i + 1}"
									aria-label="Remove corner {i + 1}"
									disabled={ctl.drawing || ctl.draft.length <= 3}
									onclick={() => ctl.removeVertex(i)}
								>×</button>
							</div>
						{/each}
					</div>
					<button type="button" class="secondary add-vertex-btn" disabled={ctl.drawing || ctl.draft.length < 2} onclick={ctl.addVertex}>Add corner</button>
				</div>
				{:else if ctl.onObstacles}
				<div class="obstacle-list" role="listbox" aria-label="Obstacles">
					{#each ctl.obstacles as o (o.key)}
						<button type="button" class="obstacle-row" class:selected={o.id === ctl.selectedId} role="option" aria-selected={o.id === ctl.selectedId} onclick={() => ctl.selectObstacle(o.id)}>
							<span class="obstacle-name">{o.name}</span>
							<span class="obstacle-height">{objectHeightText(o, roomZ, precision, ctl.unit)}</span>
						</button>
					{/each}
					{#if ctl.obstacles.length === 0}
						<p class="plan-note">No obstacles yet. Desks, partitions, columns: anything that blocks or reflects light. Nothing to add? Press Next.</p>
					{/if}
				</div>
				{#if ctl.selected}
					<div class="obstacle-props">
						{#if ctl.validationMessage && ctl.draft.length >= 3}
							<p class="plan-error" role="alert">Not saved: {ctl.validationMessage}</p>
						{/if}
						<label class="prop-row">
							<span>Name</span>
							<input id="obstacle-name" type="text" value={ctl.selected.name} onchange={(e) => ctl.commitName((e.currentTarget as HTMLInputElement).value)} />
						</label>
						<label class="prop-check">
							<input id="obstacle-full-height" type="checkbox" checked={ctl.selectedFull} onchange={(e) => ctl.toggleFullHeight((e.currentTarget as HTMLInputElement).checked)} />
							<span>Floor to ceiling</span>
						</label>
						{#if !ctl.selectedFull}
							<div class="prop-pair">
								<label><span>Bottom ({ctl.unit})</span><ValidatedNumberInput id="obstacle-bottom" value={ctl.selected.z} {precision} min={0} max={roomZ} step={ctl.snapStep} oncommit={ctl.commitBottom} /></label>
								<label><span>Top ({ctl.unit})</span><ValidatedNumberInput id="obstacle-top" value={objectTop(ctl.selected)} {precision} min={0} max={roomZ} step={ctl.snapStep} oncommit={ctl.commitTop} /></label>
							</div>
						{/if}
						<div class="prop-pair">
							<label><span>Reflectance</span><ValidatedNumberInput id="obstacle-reflectance" value={ctl.selected.reflectance} precision={2} min={0} max={Math.max(0, 1 - ctl.selected.transmittance)} step={0.05} oncommit={ctl.commitReflectance} /></label>
							<label><span>Transmittance</span><ValidatedNumberInput id="obstacle-transmittance" value={ctl.selected.transmittance} precision={2} min={0} max={Math.max(0, 1 - ctl.selected.reflectance)} step={0.05} oncommit={ctl.commitTransmittance} /></label>
						</div>
						<button type="button" class="disclosure" onclick={() => ctl.cornersOpen = !ctl.cornersOpen} aria-expanded={ctl.cornersOpen}>
							<span class="collapse-icon">{ctl.cornersOpen ? '▼' : '▶'}</span> Corners
						</button>
						{#if ctl.cornersOpen}
							<div class="vertex-table">
								<div class="vertex-header">
									<span></span>
									<span>X ({ctl.unit})</span>
									<span>Y ({ctl.unit})</span>
									<span></span>
								</div>
								<div class="vertex-rows">
									{#each ctl.draft as [vx, vy], i (i)}
										<div class="vertex-row" class:selected={ctl.selectedIndex === i}>
											<span class="row-index" title="Corner {i + 1}">{i + 1}</span>
											<ValidatedNumberInput value={vx} {precision} step={ctl.snapStep} disabled={ctl.drawing} oncommit={(v) => ctl.setVertexCoord(i, 0, v)} />
											<ValidatedNumberInput value={vy} {precision} step={ctl.snapStep} disabled={ctl.drawing} oncommit={(v) => ctl.setVertexCoord(i, 1, v)} />
											<button type="button" class="secondary remove-btn" title="Remove corner {i + 1}" aria-label="Remove corner {i + 1}" disabled={ctl.drawing || ctl.draft.length <= 3} onclick={() => ctl.removeVertex(i)}>×</button>
										</div>
									{/each}
								</div>
								<button type="button" class="secondary add-vertex-btn" disabled={ctl.drawing || ctl.draft.length < 2} onclick={ctl.addVertex}>Add corner</button>
							</div>
						{/if}
					</div>
				{/if}
				{:else if ctl.onLamps}
				<section class="add-lamp" aria-label="Add lamp">
					<h3 class="add-lamp-title">Add lamp</h3>
					<select bind:this={fixtureSelect} value={ctl.addFixture} onchange={(e) => chooseFixture(e.currentTarget)} aria-label="Fixture">
						<option value="" disabled>Choose a fixture…</option>
						{#each [...new Set(fixtures.map((f) => f.group))] as g (g)}
							<optgroup label={g}>
								{#each fixtures.filter((f) => f.group === g) as f (f.key)}
									<option value={f.key}>{f.label}</option>
								{/each}
							</optgroup>
						{/each}
						<option value="__add_custom__">Add custom lamp…</option>
					</select>
					{#if ctl.addFixture}
						<div class="placements" role="group" aria-label="Placement">
							{#each PLACEMENTS as pl (pl.mode)}
								<button type="button" class="secondary placement-btn" disabled={ctl.addingLamp !== null} onclick={() => ctl.addPlaced(pl.mode)} title={pl.title}>{ctl.addingLamp === pl.mode ? 'Adding…' : pl.label}</button>
							{/each}
						</div>
						<p class="plan-note">Each click adds one, placed automatically; adjust it on the plan.</p>
					{/if}
				</section>
				<div class="obstacle-list" role="listbox" aria-label="Lamps" aria-multiselectable="true">
					{#each lamps as l (l.id)}
						<button type="button" class="obstacle-row" class:selected={ctl.selectedLampIds.includes(l.id)} role="option" aria-selected={ctl.selectedLampIds.includes(l.id)} onclick={(e) => (e.shiftKey ? ctl.toggleLamp(l.id) : ctl.selectLamp(l.id))}>
							<span class="obstacle-name">{l.name || l.id}</span>
							<span class="obstacle-height">{lampHasPhotometry(l) ? `height ${ctl.fmt(l.z)} ${ctl.unit}` : 'choose a fixture'}</span>
						</button>
					{/each}
				</div>
				{#if ctl.selectedLampIds.length > 1}
					<p class="plan-note">{ctl.selectedLampIds.length} lamps selected. Move drags them together; Aim points them all at one spot.</p>
				{:else if ctl.selectedLamp && lampPanel}
					<div class="lamp-panel">
						{@render lampPanel(ctl.selectedLamp, () => ctl.selectLamp(null))}
					</div>
				{/if}
				{:else if ctl.onZones}
				<div class="obstacle-list" role="listbox" aria-label="Calc zones">
					{#each ctl.userZones as z (z.id)}
						<button type="button" class="obstacle-row" class:selected={z.id === ctl.selectedZoneId} role="option" aria-selected={z.id === ctl.selectedZoneId} onclick={() => ctl.selectZone(z.id)}>
							<span class="obstacle-name">{z.name || z.id}</span>
							<span class="obstacle-height">{ctl.zoneSummary(z)}</span>
						</button>
					{/each}
					{#if ctl.userZones.length === 0}
						<p class="plan-note">No calc zones of your own yet; the safety zones are added for you. Draw a plane or volume, place a point, or press Next to skip.</p>
					{/if}
				</div>
				{#if ctl.selectedZone && zonePanel}
					<div class="lamp-panel">
						{@render zonePanel(ctl.selectedZone, () => ctl.selectZone(null))}
					</div>
				{/if}
				{:else}
				<div class="reflectance-panel">
					<ReflectanceStep {onShowReflectanceSettings} onHover={(s) => ctl.hoveredSurface = s} />
				</div>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="footer">
			{#if prevStep}
				<button type="button" class="secondary" onclick={() => goStep(prevStep.id)}>Back</button>
			{/if}
			<span class="footer-spacer"></span>
			{#if nextStep}
				<button type="button" class="secondary" onclick={requestClose}>Done</button>
				<button type="button" class="primary" onclick={() => goStep(nextStep.id)}>Next: {nextStep.title}</button>
			{:else}
				<button type="button" class="primary" onclick={requestClose}>Done</button>
			{/if}
		</div>
	{/snippet}
</Modal>

{#if ctl.pendingLeave}
	<ConfirmDialog
		title="Outline not saved"
		message="The outline on screen isn't valid, so it wasn't applied. Keep the last saved outline, or go back and fix it."
		confirmLabel="Keep saved outline"
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

<style>
	/* Fixed-height body so the modal itself never scrolls: the canvas fills the
	   left column and the vertex list scrolls inside the right column. */
	.layer-rail {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		padding-right: var(--spacing-sm);
		border-right: 1px solid var(--color-border);
	}
	.layer {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		min-width: 7rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-base);
		text-align: left;
	}
	.layer.active {
		background: var(--color-highlight);
		color: var(--color-bg, #fff);
		border-color: var(--color-highlight);
	}
	.layer-count {
		margin-left: auto;
		font-size: var(--font-size-xs);
		opacity: 0.8;
	}
	.obstacle-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 40%;
		overflow-y: auto;
	}
	.obstacle-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-sm);
		padding: 6px 8px;
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		text-align: left;
		font-size: var(--font-size-base);
	}
	.obstacle-row.selected {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-tertiary));
	}
	.obstacle-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.obstacle-height {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.obstacle-props {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
		min-height: 0;
		overflow-y: auto;
	}
	.prop-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.prop-check {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin: 0;
		font-size: var(--font-size-base);
		color: var(--color-text);
		cursor: pointer;
	}
	.prop-check input {
		width: auto;
		margin: 0;
	}
	.prop-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-xs) var(--spacing-sm);
	}
	.prop-pair label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		min-width: 0;
	}
	.disclosure {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-text);
		font-weight: 600;
		font-size: var(--font-size-base);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}
	.collapse-icon {
		font-size: 0.7em;
		color: var(--color-text-muted);
	}
	.floor-plan-modal {
		display: flex;
		gap: var(--spacing-md);
		/* Fill the viewport: modal max-height (100vh - 24px) minus header + footer */
		height: calc(100vh - 24px - 118px);
		min-height: 360px;
		padding: var(--spacing-md);
	}
	.canvas-column {
		flex: 1 1 560px;
		min-width: 320px;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}
	.side-column {
		flex: 0 0 260px;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		min-width: 0;
		min-height: 0;
	}
	/* New · Upload · Set scale, with the units select pinned right */
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
		align-items: center;
	}
	.toolbar-right {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
		align-items: center;
	}
	.toolbar-right {
		margin-left: auto;
	}
	.toolbar .units-select {
		width: 60px;
	}
	.plan-hint {
		margin: 0;
		min-height: 1.2em;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	/* Tools use the secondary button look so only Apply carries the accent colour */
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
	.add-lamp {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-bottom: var(--spacing-sm);
		margin-bottom: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
	}
	.add-lamp-title {
		margin: 0;
		font-size: 1rem;
	}
	.placements {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
	}
	.placement-btn {
		padding: 4px 0;
	}
	.marquee {
		fill: color-mix(in srgb, var(--color-highlight) 10%, transparent);
		stroke: var(--color-highlight);
		pointer-events: none;
	}
	.plan-lamp.aiming {
		cursor: crosshair;
	}
	.tool.active {
		background: var(--color-highlight);
		color: var(--color-bg, #fff);
		border-color: var(--color-highlight);
	}
	.summary {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--font-size-base);
	}
	.summary > div {
		display: flex;
		justify-content: space-between;
	}
	.summary-label {
		color: var(--color-text-muted);
	}
	.plan-error {
		margin: 4px 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-error, #e5484d);
	}
	.plan-note {
		margin: 4px 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.vertex-table {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-height: 0;
		flex: 0 1 auto;
	}
	/* Rows grow until the column is full (pushing "Add corner" down to the
	   canvas's bottom edge), then scroll while the button stays put. */
	.vertex-rows {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 0;
		overflow-y: auto;
		/* Always reserve the scrollbar's width so it never overlays the × column */
		scrollbar-gutter: stable;
		padding-right: 2px;
	}
	/* Keep the header columns aligned with the (gutter-padded) rows */
	.vertex-header {
		scrollbar-gutter: stable;
		overflow-y: hidden;
		padding-right: 2px;
	}
	.vertex-header,
	.vertex-row {
		display: grid;
		grid-template-columns: 1.6rem 1fr 1fr 1.4rem;
		gap: var(--spacing-xs);
		align-items: center;
	}
	.vertex-header {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.row-index {
		text-align: center;
		font-size: var(--font-size-xs);
		font-family: var(--font-mono, monospace);
		color: var(--color-text-muted);
	}
	.vertex-row.selected .row-index {
		color: var(--color-accent);
		font-weight: 600;
	}
	/* Same look as the Cancel button (secondary), just compact */
	.remove-btn {
		width: 100%;
		padding: 0;
		height: 1.6rem;
		line-height: 1;
	}
	.add-vertex-btn {
		width: 100%;
	}
	.footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
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
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.reference-panel {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: var(--spacing-xs) 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-xs);
	}
	.reference-meta {
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.reference-row {
		display: grid;
		grid-template-columns: 4.2rem 1fr;
		align-items: center;
		gap: var(--spacing-xs);
	}
	.reference-row input[type='range'] {
		width: 100%;
	}
	.remove-image-btn {
		width: 100%;
		margin-top: 2px;
	}
	.step-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		margin-right: 2px;
		border-radius: 50%;
		font-size: var(--font-size-xs);
		border: 1px solid currentColor;
		opacity: 0.8;
	}
	.step-num.done {
		border-color: transparent;
		opacity: 1;
	}
	.icon-tool {
		width: 1.9rem;
		justify-content: center;
		padding: 0;
		font-size: 1.05rem;
	}
	.tool:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.footer-spacer {
		flex: 1;
	}
	/* The surface list needs room for a name beside its R and T fields */
	.side-column.wide {
		flex-basis: 340px;
	}
	.reflectance-panel {
		min-height: 0;
		overflow-y: auto;
	}
	.lamp-panel {
		min-height: 0;
		overflow-y: auto;
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
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
</style>
