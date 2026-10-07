<script module lang="ts">
	import type { Vertex as OutlineVertex } from '$lib/utils/roomGeometry';
	import type { CalcZone, FloorPlanPlacement, LampInstance, SceneObject } from '$lib/types/project';
	import type { FloorPlanImage } from '$lib/stores/floorplanImage';
	import type { LengthUnit } from '$lib/utils/unitConversion';
	import type { PlacementMode } from '$lib/utils/lampPlacement';
	import type { FixtureOption } from '$lib/utils/lampFixture';

	export type PlanStep = 'outline' | 'obstacles' | 'lamps' | 'zones' | 'reflectance';

	/** The guided steps, in order. */
	export const PLAN_STEPS: readonly { id: PlanStep; title: string }[] = [
		{ id: 'outline', title: 'Outline' },
		{ id: 'obstacles', title: 'Obstacles' },
		{ id: 'lamps', title: 'Lamps' },
		{ id: 'zones', title: 'Calc zones' },
		{ id: 'reflectance', title: 'Reflectance' },
	];

	/**
	 * What the plan does to the scene. Every call is one finished edit (a closed
	 * outline, the end of a drag, a placed obstacle), applied straight away.
	 */
	export interface PlanActions {
		/** A valid outline (CCW, display units) that differs from the current one. */
		setOutline: (vertices: OutlineVertex[]) => void;
		/** Move, rescale or restyle the reference image; null removes it. `image` comes with a new upload. */
		setPlacement: (placement: FloorPlanPlacement | null, image?: FloorPlanImage) => void;
		addObstacle: (obj: Omit<SceneObject, 'id'>) => Promise<string>;
		updateObstacle: (id: string, partial: Partial<SceneObject>) => void;
		removeObstacle: (id: string) => void;
		/** Place a lamp at (x, y): with `likeId`, a copy of that lamp (fixture and aim); otherwise a new default lamp aimed straight down. */
		addLamp: (x: number, y: number, likeId?: string) => Promise<string>;
		/** Add a lamp with a fixture (`preset:…` or `custom:…`), placed automatically by a placement mode. */
		addPlacedLamp: (fixture: string, mode: PlacementMode) => Promise<string>;
		/** Copy several lamps (fixture, aim and all), shifted by (dx, dy), as one undo step. */
		copyLamps: (ids: string[], dx: number, dy: number) => Promise<string[]>;
		updateLamp: (id: string, partial: Partial<LampInstance>) => void;
		removeLamp: (id: string) => void;
		/** Add a calc zone with this geometry, on the user's zone defaults. */
		addZone: (type: 'plane' | 'volume' | 'point', geometry: Partial<CalcZone>) => Promise<string>;
		updateZone: (id: string, partial: Partial<CalcZone>) => void;
		removeZone: (id: string) => void;
		/** Copy a zone with all its settings, shifted by (dx, dy). */
		copyZone: (id: string, dx: number, dy: number) => Promise<string>;
		changeUnits: (units: LengthUnit) => void | Promise<void>;
	}
</script>

<script lang="ts">
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import ReflectanceStep from './ReflectanceStep.svelte';
	import PlanCanvas, { type CanvasTool, type PlanShape } from './PlanCanvas.svelte';
	import { onMount, onDestroy, tick, untrack, type Snippet } from 'svelte';
	import { draftsFromObjects, draftFromPolygon, duplicateDraft, objectFromDraft, footprintGeometry } from '$lib/utils/obstacleDrafts';
	import { isFloorToCeiling, floorToCeilingUpdate, bottomUpdate, topUpdate, objectTop, objectHeightText } from '$lib/utils/objectHeight';
	import { project, lampHasPhotometry } from '$lib/stores/project';
	import { setUndoInterceptor, undoShortcut, redoShortcut } from '$lib/utils/undoKeys';
	import { zoneHasFootprint, zoneFootprint, footprintGeometry as zoneFootprintGeometry } from '$lib/utils/zoneFootprint';
	import { displayDimension } from '$lib/utils/formatting';
	import { unitAbbrev, unitsPerMeter, unitSnap, lengthFactor, roundToUnit, fromMeters, LENGTH_UNITS } from '$lib/utils/unitConversion';
	import {
		type Vertex,
		polygonArea,
		polygonBoundingBox,
		polygonEdgeLengths,
		edgeMidpoints,
		validatePolygon,
		normalizeCCW,
	} from '$lib/utils/roomGeometry';
	import { initialPlacement, imageRect, rescaleAboutPoint, scaleFromMeasurement } from '$lib/utils/floorplanImage';
	import { decodeFloorPlanFile, isSupportedFloorPlanFile, FloorPlanDecodeError, type DecodedFloorPlan } from '$lib/utils/floorplanDecode';

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

	// Every finished edit is applied at once through `actions`; the props are the
	// scene as stored. The canvas edits `draft`, a copy of one polygon (the outline,
	// or the selected obstacle's world footprint) that only lives for the gesture in
	// flight. An edit that leaves the polygon invalid stays local (drawn red) and
	// is not applied, so the stored scene is always the last valid one.
	const history = project.history;
	const clone = (vs: Vertex[]) => vs.map((v) => [v[0], v[1]] as Vertex);
	// svelte-ignore state_referenced_locally
	let draft = $state<Vertex[]>(clone(initialStep === 'outline' ? vertices : []));
	// 'custom' is the Set scale tool: the canvas hands clicks and moves to us
	let tool = $state<CanvasTool>('edit');
	let drawing = $state(false);
	let selectedIndex = $state(-1);
	let canvas = $state<PlanCanvas | undefined>(undefined);
	/** A local edit of the current polygon that is invalid, so not applied. */
	let dirty = $state(false);

	// --- Steps
	// svelte-ignore state_referenced_locally
	let step = $state<PlanStep>(initialStep);
	const stepIndex = $derived(PLAN_STEPS.findIndex((s) => s.id === step));
	const nextStep = $derived(PLAN_STEPS[stepIndex + 1] ?? null);
	const prevStep = $derived(stepIndex > 0 ? PLAN_STEPS[stepIndex - 1] : null);
	const onOutline = $derived(step === 'outline');
	const onObstacles = $derived(step === 'obstacles');
	const onLamps = $derived(step === 'lamps');
	const onZones = $derived(step === 'zones');
	const onReflectance = $derived(step === 'reflectance');

	// --- Obstacles, straight from the scene
	const obstacles = $derived(draftsFromObjects(objects));
	let selectedId = $state<string | null>(null);
	let cornersOpen = $state(false);
	const selected = $derived(selectedId ? obstacles.find((o) => o.id === selectedId) ?? null : null);
	const selectedFull = $derived(selected ? isFloorToCeiling(selected, roomZ) : false);
	// Reflectance step: the surface the pointer is over in the list
	let hoverSurface = $state<string | null>(null);
	const shapes = $derived<PlanShape[]>(
		obstacles
			.filter((o) => !(onObstacles && o.id === selectedId && !drawing))
			.map((o) => {
				const lit = onReflectance && hoverSurface === o.id;
				return { id: o.key, vertices: o.vertices, name: o.name, selected: (onObstacles && o.id === selectedId) || lit, dimmed: !onObstacles && !lit, disabled: !o.enabled };
			})
	);

	// Calc zones: flat planes and volumes are footprints drawn like obstacles
	const userZones = $derived(zones.filter((z) => !z.isStandard));
	let selectedZoneId = $state<string | null>(null);
	const selectedZone = $derived(selectedZoneId ? userZones.find((z) => z.id === selectedZoneId) ?? null : null);
	const selectedFootprint = $derived(selectedZone && selectedZone.type !== 'point' && zoneHasFootprint(selectedZone) ? selectedZone : null);
	let drawKind = $state<'plane' | 'volume' | null>(null);
	const footprintZones = $derived(userZones.filter((z) => z.type !== 'point' && zoneHasFootprint(z)));

	/**
	 * The same polygon up to where it starts and which way it winds. The store
	 * keeps outlines CCW (and an origin rectangle as plain x/y), so an applied
	 * draft can come back reordered; the corner table must not jump when it does.
	 */
	function samePolygon(a: Vertex[], b: Vertex[]): boolean {
		const n = a.length;
		if (n !== b.length) return false;
		if (n === 0) return true;
		const close = (p: Vertex, q: Vertex) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
		for (let start = 0; start < n; start++) {
			for (const dir of [1, -1]) {
				if (a.every((p, i) => close(p, b[(((start + dir * i) % n) + n) % n]))) return true;
			}
		}
		return false;
	}

	/** The stored polygon the canvas edits on this step. */
	const source = $derived(onOutline ? vertices : onObstacles ? (selected?.vertices ?? []) : onZones && selectedFootprint ? zoneFootprint(selectedFootprint) : []);

	// Follow the stored polygon (an undo, a units switch, a backend nudge), except
	// mid-gesture or while a local invalid edit is on screen.
	$effect(() => {
		const src = source;
		untrack(() => {
			if (drawing || dirty || canvas?.isDragging()) return;
			if (!samePolygon(draft, src)) draft = clone(src);
		});
	});

	/** Apply the draft as the outline or the selected obstacle's footprint, if valid and changed. */
	function commitDraft() {
		if (drawing || onReflectance || onLamps) return;
		if (onObstacles && !selected) return;
		if (onZones && !selectedFootprint) return;
		if (validatePolygon(draft) !== null) {
			dirty = true;
			return;
		}
		dirty = false;
		const next = normalizeCCW(draft);
		if (onOutline) {
			if (!samePolygon(next, vertices)) actions.setOutline(next);
		} else if (onZones) {
			const z = selectedFootprint!;
			// Reshaping a whole-room zone makes it a drawn one
			if (!samePolygon(next, zoneFootprint(z))) actions.updateZone(z.id, { ...zoneFootprintGeometry(z.type as 'plane' | 'volume', next), fit_room: false });
		} else if (selected && !samePolygon(next, selected.vertices)) {
			actions.updateObstacle(selected.id!, footprintGeometry(next));
		}
	}

	/** Drop a local invalid edit and show the stored polygon again. */
	function revertDraft() {
		dirty = false;
		draft = clone(source);
	}

	function selectObstacle(id: string | null) {
		if (drawing) return;
		if (dirty) revertDraft();
		selectedId = id;
		selectedIndex = -1;
		const o = id ? obstacles.find((x) => x.id === id) : null;
		draft = o ? clone(o.vertices) : [];
	}

	// Leaving a step (or closing) with an invalid outline asks first
	let pendingLeave = $state<(() => void) | null>(null);
	function leave(then: () => void) {
		if (drawing) canvas?.cancelDraw();
		if (dirty) {
			pendingLeave = then;
			return;
		}
		then();
	}
	function answerLeave(keepSaved: boolean) {
		const then = pendingLeave;
		pendingLeave = null;
		if (!keepSaved || !then) return;
		revertDraft();
		then();
	}

	function goStep(next: PlanStep) {
		if (next === step) return;
		leave(() => {
			if (tool === 'custom') { cancelMeasure(); tool = 'edit'; }
			planSelected = false;
			hoverSurface = null;
			selectedId = null;
			selectedLampIds = [];
			selectedZoneId = null;
			markerDrag = null;
			marquee = null;
			drawKind = null;
			placing = false;
			placeCursor = null;
			selectedIndex = -1;
			step = next;
			draft = clone(next === 'outline' ? vertices : []);
		});
	}

	function requestClose() {
		leave(onClose);
	}

	// --- Obstacle actions
	function startObstacleDraw() {
		selectObstacle(null);
		canvas?.startDraw();
	}
	function stopObstacleDraw() {
		if (drawing) canvas?.cancelDraw();
	}
	async function onDrawEnd(committed: boolean) {
		if (onZones) {
			const kind = drawKind;
			drawKind = null;
			if (!committed || draft.length < 3 || !kind) return;
			try {
				selectedZoneId = await actions.addZone(kind, { ...zoneFootprintGeometry(kind, draft), fit_room: false });
			} catch (e) {
				console.error('Failed to add zone:', e);
				draft = [];
			}
			return;
		}
		if (!committed || draft.length < 3) return;
		if (onOutline) {
			commitDraft();
			return;
		}
		if (!onObstacles) return;
		// The new obstacle is selected and editable; Draw is one click away for the next
		const d = draftFromPolygon(draft, roomZ, obstacles);
		try {
			selectedId = await actions.addObstacle(objectFromDraft(d));
		} catch (e) {
			console.error('Failed to add obstacle:', e);
			draft = [];
		}
	}

	function updateSelected(partial: Partial<SceneObject>) {
		if (selected?.id) actions.updateObstacle(selected.id, partial);
	}
	function toggleFullHeight(on: boolean) {
		if (!selected) return;
		updateSelected(on ? floorToCeilingUpdate(roomZ) : { z: 0, height: Math.max(fromMeters(0.1, units), roomZ - Math.min(fromMeters(0.1, units), roomZ / 4)) });
	}
	function commitBottom(v: number) { if (selected) updateSelected(bottomUpdate(selected, v)); }
	function commitTop(v: number) { if (selected) updateSelected(topUpdate(selected, v)); }
	// R and T are validated as a pair by guv_calcs, so they travel together
	function commitReflectance(v: number) { if (selected) updateSelected({ reflectance: v, transmittance: selected.transmittance }); }
	function commitTransmittance(v: number) { if (selected) updateSelected({ reflectance: selected.reflectance, transmittance: v }); }
	function commitName(name: string) {
		if (selected && name !== selected.name) updateSelected({ name });
	}
	async function duplicateSelected() {
		if (!selected || drawing) return;
		const copy = duplicateDraft(selected, snapStep * 2, obstacles);
		try {
			const id = await actions.addObstacle(objectFromDraft(copy));
			selectObstacle(null);
			selectedId = id;
		} catch (e) {
			console.error('Failed to copy obstacle:', e);
		}
	}
	function deleteSelected() {
		if (!selected?.id || drawing) return;
		const id = selected.id;
		selectObstacle(null);
		actions.removeObstacle(id);
	}
	function onWindowKey(event: KeyboardEvent) {
		const t = event.target as HTMLElement | null;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
		if (onLamps && !drawing) {
			const key = event.key.toLowerCase();
			if (!event.ctrlKey && !event.metaKey && !event.altKey && (key === 'm' || key === 'a') && lamps.length) {
				lampMode = key === 'm' ? 'move' : 'aim';
				return;
			}
			if ((event.ctrlKey || event.metaKey) && key === 'a') {
				event.preventDefault();
				selectedLampIds = lamps.map((l) => l.id);
				return;
			}
			if (selectedLampIds.length === 0) return;
			const st = snapStep;
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				deleteSelectedLamps();
			} else if ((event.ctrlKey || event.metaKey) && key === 'd') {
				event.preventDefault();
				copySelectedLamps();
			} else if (event.key.startsWith('Arrow')) {
				event.preventDefault();
				const dx = event.key === 'ArrowLeft' ? -st : event.key === 'ArrowRight' ? st : 0;
				const dy = event.key === 'ArrowUp' ? st : event.key === 'ArrowDown' ? -st : 0;
				for (const m of markers) if (selectedLampIds.includes(m.id)) moveMarker(m, dx, dy);
			}
			return;
		}
		const markerSel = onZones && selectedZone?.type === 'point' ? selectedZoneId : null;
		if (onZones && !placing && !drawing && (markerSel || selectedZone)) {
			const st = snapStep;
			if (event.key === 'Delete' || event.key === 'Backspace') {
				if (onZones && selectedIndex >= 0) return; // the canvas removes a corner
				event.preventDefault();
				deleteSelectedZone();
			} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
				event.preventDefault();
				copySelectedZone();
			} else if (event.key.startsWith('Arrow')) {
				event.preventDefault();
				const dx = event.key === 'ArrowLeft' ? -st : event.key === 'ArrowRight' ? st : 0;
				const dy = event.key === 'ArrowUp' ? st : event.key === 'ArrowDown' ? -st : 0;
				const m = markers.find((x) => x.id === markerSel);
				if (m) moveMarker(m, dx, dy);
				else canvas?.nudge(dx, dy);
			}
			return;
		}
		if (!onObstacles) return;
		if ((event.key === 'Delete' || event.key === 'Backspace') && selected && selectedIndex < 0 && !drawing) {
			event.preventDefault();
			deleteSelected();
		} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selected && !drawing) {
			event.preventDefault();
			duplicateSelected();
		} else if (event.key.startsWith('Arrow') && selected && !drawing) {
			event.preventDefault();
			const s = snapStep;
			canvas?.nudge(event.key === 'ArrowLeft' ? -s : event.key === 'ArrowRight' ? s : 0, event.key === 'ArrowUp' ? s : event.key === 'ArrowDown' ? -s : 0);
		}
	}

	// --- Lamps and calc points. Each is a ring (drag to move it; the aim point
	// travels along) with a dot at its aim point (drag to aim). Each finished
	// drag is one update. Lamps live on the Lamps step, points on Calc zones.
	interface Marker { id: string; name: string; x: number; y: number; ax: number; ay: number; enabled: boolean }
	// Lamps: one or several selected (Shift-click, or drag a box on empty space).
	// Move drags the selection; Aim points it at where the drag ends.
	let selectedLampIds = $state<string[]>([]);
	const selectedLampId = $derived(selectedLampIds.length === 1 ? selectedLampIds[0] : null);
	const selectedLamp = $derived(selectedLampId ? lamps.find((l) => l.id === selectedLampId) ?? null : null);
	let lampMode = $state<'move' | 'aim'>('move');
	let placing = $state(false);
	let placeCursor = $state<Vertex | null>(null);
	let markerDrag = $state<{ id: string; part: 'body' | 'aim' | 'aimAt'; start: Vertex; dx: number; dy: number; target: Vertex | null; group: string[] } | null>(null);
	let marquee = $state<{ a: Vertex; b: Vertex; add: boolean } | null>(null);

	// --- Add lamp (right panel): choose a fixture, then each placement button
	// adds one, placed automatically
	let addFixture = $state('');
	let addingLamp = $state<PlacementMode | null>(null);
	let fixtureSelect = $state<HTMLSelectElement | undefined>(undefined);
	const PLACEMENTS: { mode: PlacementMode; label: string; title: string }[] = [
		{ mode: 'downlight', label: 'Downlight', title: 'On the ceiling, aimed straight down, where it adds the most coverage' },
		{ mode: 'corner', label: 'Corner', title: 'High in a corner, aimed across the room (each click takes the next free corner)' },
		{ mode: 'edge', label: 'Edge', title: 'High on a wall, aimed into the room (each click takes the next free wall)' },
		{ mode: 'horizontal', label: 'Horizontal', title: 'High on a wall, aimed level across the room for upper-room use' },
	];
	function chooseFixture(select: HTMLSelectElement) {
		if (select.value === '__add_custom__') {
			select.value = addFixture;
			onAddCustomLamp();
			return;
		}
		addFixture = select.value;
	}
	async function addPlaced(mode: PlacementMode) {
		if (!addFixture || addingLamp) return;
		addingLamp = mode;
		try {
			selectLamp(await actions.addPlacedLamp(addFixture, mode));
		} catch (e) {
			console.error('Failed to add lamp:', e);
		} finally {
			addingLamp = null;
		}
	}
	function toggleLamp(id: string) {
		selectedLampIds = selectedLampIds.includes(id) ? selectedLampIds.filter((x) => x !== id) : [...selectedLampIds, id];
	}
	async function copySelectedLamps() {
		const ids = selectedLampIds.filter((id) => lamps.some((l) => l.id === id));
		if (!ids.length) return;
		try {
			selectedLampIds = await actions.copyLamps(ids, snapStep * 2, snapStep * 2);
		} catch (e) {
			console.error('Failed to copy lamps:', e);
		}
	}
	function deleteSelectedLamps() {
		const ids = [...selectedLampIds];
		selectLamp(null);
		for (const id of ids) actions.removeLamp(id);
	}
	/** Drag on empty space (Lamps step) draws a box that selects the lamps inside; Shift adds to the selection. */
	function onBackgroundDragStart(event: PointerEvent): boolean {
		if (!onLamps || placing || drawing || !canvas) return false;
		const a = canvas.pointerToRoom(event);
		marquee = { a, b: a, add: event.shiftKey };
		return true;
	}
	function endMarquee() {
		const m = marquee;
		marquee = null;
		if (!m) return;
		const x0 = Math.min(m.a[0], m.b[0]), x1 = Math.max(m.a[0], m.b[0]);
		const y0 = Math.min(m.a[1], m.b[1]), y1 = Math.max(m.a[1], m.b[1]);
		if (x1 - x0 < snapStep / 2 && y1 - y0 < snapStep / 2) {
			// A click on empty space
			if (!m.add) selectLamp(null);
			return;
		}
		const inside = lamps.filter((l) => l.x >= x0 && l.x <= x1 && l.y >= y0 && l.y <= y1).map((l) => l.id);
		selectedLampIds = m.add ? [...new Set([...selectedLampIds, ...inside])] : inside;
	}

	const markers = $derived<Marker[]>(
		onLamps
			? lamps.map((l) => ({ id: l.id, name: l.name || l.id, x: l.x, y: l.y, ax: l.aimx, ay: l.aimy, enabled: l.enabled !== false }))
			: onZones
				? userZones.filter((z) => z.type === 'point').map((z) => ({ id: z.id, name: z.name || z.id, x: z.x ?? 0, y: z.y ?? 0, ax: z.aim_x ?? z.x ?? 0, ay: z.aim_y ?? z.y ?? 0, enabled: z.enabled !== false }))
				: []
	);
	const selectedMarkerId = $derived(onZones ? selectedZoneId : null);

	/** Where a marker and its aim point are drawn, including a drag in flight. */
	function markerView(m: Marker) {
		const d = markerDrag;
		if (!d || !d.group.includes(m.id)) return { x: m.x, y: m.y, ax: m.ax, ay: m.ay };
		if (d.part === 'aimAt') return d.target ? { x: m.x, y: m.y, ax: d.target[0], ay: d.target[1] } : { x: m.x, y: m.y, ax: m.ax, ay: m.ay };
		if (d.part === 'aim') return { x: m.x, y: m.y, ax: m.ax + d.dx, ay: m.ay + d.dy };
		return { x: m.x + d.dx, y: m.y + d.dy, ax: m.ax + d.dx, ay: m.ay + d.dy };
	}
	const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

	function selectLamp(id: string | null) {
		selectedLampIds = id ? [id] : [];
	}
	function selectZone(id: string | null) {
		if (drawing) return;
		if (dirty) revertDraft();
		selectedZoneId = id;
		selectedIndex = -1;
		const z = id ? userZones.find((x) => x.id === id) : null;
		draft = z && z.type !== 'point' && zoneHasFootprint(z) ? clone(zoneFootprint(z)) : [];
	}
	function setPlacing(on: boolean) {
		placing = on;
		tool = on ? 'custom' : 'edit';
		placeCursor = null;
		if (on) canvas?.focus();
	}
	function snappedPointer(event: MouseEvent): Vertex {
		const p = canvas!.pointerToRoom(event);
		return [canvas!.snapValue(p[0], event.altKey), canvas!.snapValue(p[1], event.altKey)];
	}
	async function placeAt(event: MouseEvent) {
		if (!canvas) return;
		const [x, y] = snappedPointer(event);
		try {
			if (onLamps) {
				// A new lamp copies the selected (or last placed) one, so a row of the same fixture is just clicks
				const like = selectedLampId ?? lamps.at(-1)?.id;
				selectLamp(await actions.addLamp(x, y, like));
			} else if (onZones) {
				selectZone(null);
				selectedZoneId = await actions.addZone('point', { x, y, aim_x: x, aim_y: y });
			}
		} catch (e) {
			console.error('Failed to place:', e);
		}
	}
	async function copySelectedZone() {
		const z = selectedZone;
		if (!z) return;
		try {
			const id = await actions.copyZone(z.id, snapStep * 2, snapStep * 2);
			selectZone(null);
			selectedZoneId = id;
		} catch (e) {
			console.error('Failed to copy zone:', e);
		}
	}
	function deleteSelectedZone() {
		const id = selectedZoneId;
		if (!id) return;
		selectZone(null);
		actions.removeZone(id);
	}
	function startZoneDraw(kind: 'plane' | 'volume') {
		if (drawing) {
			canvas?.cancelDraw();
			if (drawKind === kind) return;
		}
		setPlacing(false);
		selectZone(null);
		drawKind = kind;
		canvas?.startDraw();
	}
	function moveMarker(m: Marker, dx: number, dy: number) {
		if (dx === 0 && dy === 0) return;
		const x = r6(m.x + dx), y = r6(m.y + dy), ax = r6(m.ax + dx), ay = r6(m.ay + dy);
		if (onLamps) actions.updateLamp(m.id, { x, y, aimx: ax, aimy: ay });
		else actions.updateZone(m.id, { x, y, aim_x: ax, aim_y: ay });
	}
	function aimMarker(m: Marker, dx: number, dy: number) {
		const ax = r6(m.ax + dx), ay = r6(m.ay + dy);
		if (onLamps) actions.updateLamp(m.id, { aimx: ax, aimy: ay });
		else actions.updateZone(m.id, { aim_x: ax, aim_y: ay });
	}
	function onMarkerPointerDown(event: PointerEvent, id: string, part: 'body' | 'aim') {
		if (placing || drawing || event.button !== 0 || !canvas || canvas.isSpaceHeld()) return;
		event.preventDefault();
		event.stopPropagation();
		if (onLamps && event.shiftKey) {
			toggleLamp(id);
			return;
		}
		if (onLamps) {
			if (!selectedLampIds.includes(id)) selectLamp(id);
		} else selectZone(id);
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		const group = onLamps ? [...selectedLampIds] : [id];
		const kind = onLamps && part === 'body' && lampMode === 'aim' ? 'aimAt' : part;
		markerDrag = { id, part: kind, start: canvas.pointerToRoom(event), dx: 0, dy: 0, target: null, group: kind === 'aim' ? [id] : group };
	}
	/** Drag a marker or its aim point; the dragged point lands on the grid (Alt: free). */
	function onMarkerDragMove(event: PointerEvent): boolean {
		if (!markerDrag || !canvas) return false;
		const m = markers.find((x) => x.id === markerDrag!.id);
		if (!m) return false;
		if (markerDrag.part === 'aimAt') {
			markerDrag = { ...markerDrag, target: snappedPointer(event) };
			return true;
		}
		const p = canvas.pointerToRoom(event);
		const [ox, oy] = markerDrag.part === 'aim' ? [m.ax, m.ay] : [m.x, m.y];
		const nx = canvas.snapValue(ox + p[0] - markerDrag.start[0], event.altKey);
		const ny = canvas.snapValue(oy + p[1] - markerDrag.start[1], event.altKey);
		markerDrag = { ...markerDrag, dx: nx - ox, dy: ny - oy };
		return true;
	}
	function endMarkerDrag() {
		const d = markerDrag;
		markerDrag = null;
		if (!d) return;
		if (d.part === 'aimAt') {
			// Every selected lamp points at where the drag ended (one undo step)
			if (d.target) for (const id of d.group) actions.updateLamp(id, { aimx: r6(d.target[0]), aimy: r6(d.target[1]) });
			return;
		}
		if (d.dx === 0 && d.dy === 0) return;
		const m = markers.find((x) => x.id === d.id);
		if (!m) return;
		if (d.part === 'aim') aimMarker(m, d.dx, d.dy);
		else for (const g of markers) if (d.group.includes(g.id)) moveMarker(g, d.dx, d.dy);
	}
	function onCustomClick(event: MouseEvent) {
		if ((onLamps || onZones) && placing) placeAt(event);
		else onScaleClick(event);
	}
	function onCustomMove(event: PointerEvent) {
		if ((onLamps || onZones) && placing) {
			if (canvas) placeCursor = snappedPointer(event);
		} else onScaleMove(event);
	}
	function zoneSummary(z: CalcZone): string {
		if (z.type === 'point') return `point · ${fmt(z.z ?? 0)} ${unit} up`;
		if (!zoneHasFootprint(z)) return 'wall plane · edit in the sidebar';
		const where = z.fit_room ? 'whole room' : z.vertices?.length ? `${z.vertices.length} corners` : 'rectangle';
		if (z.type === 'volume') return `volume · ${where}`;
		return `plane · ${where} · ${fmt(z.height ?? 0)} ${unit} up`;
	}

	onMount(() => {
		// While drawing, Ctrl+Z drops the last corner; with an invalid edit on
		// screen it drops that edit. Otherwise the app-wide undo runs.
		setUndoInterceptor((key) => {
			if (key !== 'undo') return false;
			if (canvas?.undoLastPoint()) return true;
			if (dirty) { revertDraft(); return true; }
			return false;
		});
		// Children are mounted (and `canvas` bound) before this runs
		if (initialStep === 'lamps' && armDraw) fixtureSelect?.focus();
		if (initialStep !== 'obstacles') return;
		if (initialObstacleId) selectObstacle(initialObstacleId);
		else if (armDraw) startObstacleDraw();
	});
	onDestroy(() => setUndoInterceptor(null));

	// --- Reference image. The placement is in meters; `k` converts to display
	// units at render. A drag or an opacity slide previews locally and is applied
	// when it ends.
	let dragPlacement = $state<FloorPlanPlacement | null>(null);
	let previewOpacity = $state<number | null>(null);
	const placement = $derived<FloorPlanPlacement | null>(
		dragPlacement ?? (floorplan ? (previewOpacity !== null ? { ...floorplan, opacity: previewOpacity } : floorplan) : null)
	);
	let imageFileName = $state<string | null>(null);
	let imageError = $state<string | null>(null);
	let decoding = $state(false);
	let pdfFile: File | null = null;
	let pdfPageCount = $state(0);
	let pdfPage = $state(1);
	let fileInput = $state<HTMLInputElement | undefined>(undefined);
	const k = $derived(unitsPerMeter(units));
	const imageMissing = $derived(placement !== null && image === null);
	const hasImage = $derived(placement !== null && image !== null);
	const planImage = $derived(placement && image ? { ...imageRect(placement, k), href: image.src, opacity: placement.opacity } : null);
	/** The image's corners, so Fit shows the plan as well as the outline. */
	const imageFitPoints = $derived.by((): Vertex[] => {
		if (!placement) return [];
		const r = imageRect(placement, k);
		return [[r.x, r.y], [r.x + r.width, r.y + r.height]];
	});

	const unit = $derived(unitAbbrev(units));
	// Snap step: 10 cm in metric units, 3 inches in imperial ones. Alt disables snapping.
	const snapStep = $derived(unitSnap(units));

	const validationMessage = $derived(drawing ? null : validatePolygon(draft));
	const area = $derived(draft.length >= 3 ? polygonArea(draft) : 0);
	const edgeLengths = $derived(draft.length >= 2 ? polygonEdgeLengths(draft) : []);
	const midpoints = $derived(draft.length >= 2 ? edgeMidpoints(draft) : []);

	// --- Draw tool ---
	// "New outline" clears the current corners, so with corners present it asks first.
	let askNewOutline = $state(false);
	function requestNewOutline() {
		if (drawing) return;
		if (draft.length > 0) askNewOutline = true;
		else startDraw();
	}

	function startDraw() {
		askNewOutline = false;
		planSelected = false;
		canvas?.startDraw();
	}

	function cancelDraw() {
		canvas?.cancelDraw();
	}

	// --- Table ---
	function setVertexCoord(index: number, axis: 0 | 1, value: number) {
		const next = clone(draft);
		next[index][axis] = onObstacles ? value : Math.max(0, value);
		draft = next;
		commitDraft();
	}

	function removeVertex(index: number) {
		canvas?.removeVertex(index);
	}

	function addVertex() {
		if (draft.length < 2) return;
		// Split the longest wall at its midpoint
		let longest = 0;
		for (let i = 1; i < edgeLengths.length; i++) if (edgeLengths[i] > edgeLengths[longest]) longest = i;
		const [mx, my] = midpoints[longest];
		const next = clone(draft);
		next.splice(longest + 1, 0, [mx, my]);
		draft = next;
		selectedIndex = longest + 1;
		commitDraft();
	}

	// --- Reference image ---
	function chooseFile() {
		fileInput?.click();
	}

	async function onFileChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!isSupportedFloorPlanFile(file)) {
			imageError = 'Unsupported file type. Use PNG, JPEG, WebP, GIF, SVG or PDF.';
			return;
		}
		// Drawing and the image tools are mutually exclusive modes (as in
		// `handleUnitsChange`); an upload leaves draw mode.
		if (drawing) cancelDraw();
		pdfFile = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? file : null;
		pdfPage = 1;
		await installDecoded(file, 1);
	}

	async function installDecoded(file: File, page: number) {
		decoding = true;
		imageError = null;
		try {
			const decoded: DecodedFloorPlan = await decodeFloorPlanFile(file, { page });
			pdfPageCount = decoded.pageCount ?? 0;
			const id = crypto.randomUUID();
			const newImage: FloorPlanImage = { id, mime: decoded.mime, src: decoded.src };
			imageFileName = file.name;
			// Re-upload of the same-size image keeps a restored placement's calibration
			if (floorplan && floorplan.widthPx === decoded.widthPx && floorplan.heightPx === decoded.heightPx) {
				actions.setPlacement({ ...floorplan, imageId: id }, newImage);
			} else {
				// Size the image to the current room, then offer Set scale (Escape dismisses it)
				const bb = polygonBoundingBox(draft.length >= 3 ? draft : vertices);
				actions.setPlacement(initialPlacement(id, decoded.widthPx, decoded.heightPx, bb.xMax / k, bb.yMax / k), newImage);
				await tick();
				canvas?.fitView();
				// With an outline already drawn, ask whether this plan replaces it; then offer Set scale
				if (onOutline && draft.length >= 3) askClearOutline = true;
				else askSetScale = true;
			}
		} catch (e) {
			imageError = e instanceof FloorPlanDecodeError ? e.message : 'Could not read this file.';
		} finally {
			decoding = false;
		}
	}

	async function changePdfPage(page: number) {
		if (!pdfFile) return;
		pdfPage = page;
		await installDecoded(pdfFile, page);
	}

	function removeImage() {
		planSelected = false;
		imageFileName = null;
		imageError = null;
		pdfFile = null;
		pdfPageCount = 0;
		if (tool === 'custom') tool = 'edit';
		measure = null;
		actions.setPlacement(null);
	}

	function setOpacity(value: number) {
		previewOpacity = Math.min(1, Math.max(0.1, value));
	}
	function commitOpacity() {
		if (floorplan && previewOpacity !== null) actions.setPlacement({ ...floorplan, opacity: previewOpacity });
		previewOpacity = null;
	}

	function setOffset(axis: 'offsetX' | 'offsetY', displayValue: number) {
		if (floorplan) actions.setPlacement({ ...floorplan, [axis]: displayValue / k });
	}

	// --- Set scale: click two points a known distance apart, type the distance.
	let measure = $state<{ a: Vertex; b: Vertex | null } | null>(null);
	let measuredDistance = $state<number | null>(null);

	// After a new upload: with an outline present, keep it or clear it; then offer Set scale
	let askClearOutline = $state(false);
	let askSetScale = $state(false);
	function answerClearOutline(clear: boolean) {
		askClearOutline = false;
		if (clear) {
			// The stored outline stays until the new one is traced
			draft = [];
			dirty = true;
			selectedIndex = -1;
		}
		askSetScale = true;
	}
	function answerSetScale(now: boolean) {
		askSetScale = false;
		if (now) startSetScale();
		else {
			tool = 'edit';
			promptToTrace();
		}
	}

	// The plan is only a picture: nothing reads the room out of it. Once it is in
	// place and there is no outline yet, offer to start tracing (like Set scale).
	let askTrace = $state(false);
	function promptToTrace() {
		if (!onOutline || draft.length >= 3 || !hasImage) return;
		askTrace = true;
	}
	function answerTrace(now: boolean) {
		askTrace = false;
		if (now && !drawing) startDraw();
	}

	function startSetScale() {
		if (!placement) return;
		planSelected = false;
		if (tool === 'custom') {
			cancelMeasure();
			tool = 'edit';
			return;
		}
		if (drawing) cancelDraw();
		tool = 'custom';
		measure = null;
		measuredDistance = null;
		selectedIndex = -1;
		canvas?.focus();
	}

	function afterCalibration() {
		tool = 'edit';
		promptToTrace();
	}

	function onScaleClick(event: MouseEvent) {
		if (tool !== 'custom' || !placement || !canvas) return;
		// No grid snapping (the user points at pixels), but the second point snaps
		// to a right angle from the first: a measured wall is almost always straight.
		const raw = canvas.pointerToRoom(event);
		if (!measure) {
			measure = { a: raw, b: null };
		} else if (!measure.b) {
			const p = canvas.snapAngle(measure.a, raw, [1, 0], event).point;
			if (Math.hypot(p[0] - measure.a[0], p[1] - measure.a[1]) < 1e-9) return;
			measure = { a: measure.a, b: p };
		}
	}

	function onScaleMove(event: PointerEvent) {
		if (!canvas) return;
		const raw = canvas.pointerToRoom(event);
		cursorFree = measure && !measure.b ? canvas.snapAngle(measure.a, raw, [1, 0], event).point : raw;
	}

	function onScaleEnter(): boolean {
		if (measure?.b) {
			confirmMeasure();
			return true;
		}
		return false;
	}

	const measuredPixels = $derived.by(() => {
		if (!measure?.b || !placement) return 0;
		return Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]) / k / placement.scale;
	});

	async function confirmMeasure() {
		if (!measure?.b || !placement || measuredDistance === null) return;
		const a: [number, number] = [measure.a[0] / k, measure.a[1] / k];
		const b: [number, number] = [measure.b[0] / k, measure.b[1] / k];
		const newScale = scaleFromMeasurement(placement, a, b, measuredDistance / k);
		if (newScale === null) return;
		// Rescale about the room origin: a plan whose corner sits on (0,0) stays there,
		// so no part of the room drifts below the axes where it could not be traced.
		actions.setPlacement(rescaleAboutPoint(placement, [0, 0], newScale));
		measure = null;
		measuredDistance = null;
		await tick();
		canvas?.fitView();
		afterCalibration();
	}

	function cancelMeasure() {
		measure = null;
		measuredDistance = null;
	}

	// Focus the distance field as soon as the popover appears, so the user can type
	// the measurement straight after the second click.
	$effect(() => {
		if (measure?.b) document.getElementById('measured-distance')?.focus();
	});

	let cursorFree = $state<Vertex | null>(null);
	const measureLine = $derived.by(() => {
		if (!measure) return null;
		const [x1, y1] = [measure.a[0], -measure.a[1]];
		const end = measure.b ?? (tool === 'custom' && cursorFree ? cursorFree : null);
		if (!end) return { x1, y1, x2: x1, y2: y1, done: false };
		const [x2, y2] = [end[0], -end[1]];
		return { x1, y1, x2, y2, done: measure.b !== null };
	});

	// --- The plan: click to select it (highlight + position readout); a selected
	// plan drags anywhere on the image, snapping its offset to the grid unless Alt.
	// Clicking elsewhere or Escape deselects.
	let imageDrag = $state<{ startPointer: Vertex; startPlacement: FloorPlanPlacement } | null>(null);
	let planSelected = $state(false);
	const planInteractive = $derived(hasImage && !drawing && tool !== 'custom' && onOutline);

	function onPlanPointerDown(event: PointerEvent) {
		if (!placement || !planInteractive || event.button !== 0 || canvas?.isSpaceHeld()) return;
		event.preventDefault();
		event.stopPropagation();
		selectedIndex = -1;
		if (!planSelected) {
			planSelected = true;
			return;
		}
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		imageDrag = { startPointer: canvas!.pointerToRoom(event), startPlacement: { ...placement } };
	}

	function onHostMove(event: PointerEvent): boolean {
		if (marquee && canvas) {
			marquee = { ...marquee, b: canvas.pointerToRoom(event) };
			return true;
		}
		if (onMarkerDragMove(event)) return true;
		if (!imageDrag || !canvas) return false;
		const p = canvas.pointerToRoom(event);
		const dx = (p[0] - imageDrag.startPointer[0]) / k;
		const dy = (p[1] - imageDrag.startPointer[1]) / k;
		// The plan's corner may sit at a negative offset, so snap without the >= 0 clamp
		const snapOffset = (meters: number) => canvas!.snapValue(meters * k, event.altKey) / k;
		dragPlacement = {
			...imageDrag.startPlacement,
			offsetX: snapOffset(imageDrag.startPlacement.offsetX + dx),
			offsetY: snapOffset(imageDrag.startPlacement.offsetY + dy),
		};
		return true;
	}

	function onHostPointerUp() {
		endMarquee();
		endMarkerDrag();
		const moved = dragPlacement;
		imageDrag = null;
		if (moved) actions.setPlacement(moved);
		dragPlacement = null;
	}

	// Escape: cancel an in-progress gesture before letting the modal close
	function onEscapeKey(): boolean | void {
		if (onLamps) {
			if (placing) { setPlacing(false); return true; }
			if (selectedLampId) { selectLamp(null); return true; }
			return;
		}
		if (onZones) {
			if (drawing) { canvas?.cancelDraw(); return true; }
			if (placing) { setPlacing(false); return true; }
			if (selectedZoneId) { selectZone(null); return true; }
			return;
		}
		if (onObstacles) {
			if (drawing) { stopObstacleDraw(); return true; }
			if (selectedId) { selectObstacle(null); return true; }
			return;
		}
		if (planSelected) {
			planSelected = false;
			return true;
		}
		if (tool === 'custom' && measure) {
			cancelMeasure();
			return true;
		}
		if (tool === 'custom') {
			tool = 'edit';
			measure = null;
			return true;
		}
		if (drawing) {
			cancelDraw();
			return true;
		}
	}

	async function handleUnitsChange(event: Event) {
		const next = (event.target as HTMLSelectElement).value as LengthUnit;
		if (next === units) return;
		const factor = lengthFactor(units, next);
		if (drawing) cancelDraw();
		// A Set scale in progress carries on: its points and typed distance are in
		// display units, so convert them (the user may switch units just to type the
		// known length). The placement is in meters and needs no conversion.
		const scalePoint = ([x, y]: Vertex): Vertex => [x * factor, y * factor];
		if (measure) measure = { a: scalePoint(measure.a), b: measure.b ? scalePoint(measure.b) : null };
		if (measuredDistance !== null) measuredDistance = roundToUnit(measuredDistance * factor, next);
		cursorFree = null;
		// The stored scene converts itself; an unsaved local edit follows along
		if (dirty) draft = draft.map(([x, y]) => [roundToUnit(x * factor, next), roundToUnit(y * factor, next)] as Vertex);
		// Keep the same area on screen rather than refitting: with no outline yet the
		// fit falls back to a one-unit square, a sudden zoom to one inch
		canvas?.scaleView(factor);
		await actions.changeUnits(next);
	}

	function fmt(v: number): string {
		return displayDimension(v, precision);
	}

	const hasOutline = $derived(vertices.length >= 3);
	function stepDone(id: PlanStep): boolean {
		if (id === 'outline') return hasOutline;
		if (id === 'obstacles') return obstacles.length > 0;
		if (id === 'lamps') return lamps.length > 0;
		if (id === 'zones') return userZones.length > 0;
		return false;
	}

	// One-line "what next" hint under the toolbar, for every state of the editor
	const hint = $derived.by(() => {
		if (onReflectance) return 'Point at a surface in the list to find it on the plan';
		if (onZones) {
			if (drawing) return draft.length < 3 ? `Click the corners of the ${drawKind ?? 'zone'} (Esc cancels)` : 'Click the first corner or press Enter to close (Esc cancels)';
			if (placing) return 'Click where each calc point goes; Esc stops placing';
			if (selectedFootprint) return 'Drag to move, drag corners or walls to reshape; set its height and grid on the right';
			if (selectedZone?.type === 'point') return 'Drag the ring to move the point, the dot to aim it';
			return userZones.length ? 'Click a zone to select it, or draw or place another' : 'Draw a plane or volume, place a point, or press Next to skip';
		}
		if (onLamps) {
			if (!lamps.length) return 'Choose a fixture on the right, then a placement: each click adds a lamp';
			const n = selectedLampIds.length;
			if (n > 1) return lampMode === 'move' ? `${n} lamps selected: drag one to move them all; Delete removes them` : `${n} lamps selected: drag from one to where they should all point`;
			if (n === 1) return lampMode === 'move' ? 'Drag the lamp to move it, or its dot to aim it; Shift-click adds lamps to the selection' : 'Drag from the lamp to where it should point';
			return 'Click a lamp to select it, or drag a box around several (Shift-click adds one)';
		}
		if (onObstacles) {
			if (drawing) return draft.length < 3 ? 'Click the corners of the obstacle (Esc cancels)' : 'Click the first corner or press Enter to close (Esc cancels)';
			if (selected) return 'Drag to move, drag corners or walls to reshape; arrow keys nudge, Delete removes';
			return obstacles.length ? 'Click an obstacle to select it, or Draw a new one' : 'Draw an obstacle by clicking its corners, or press Next to skip';
		}
		if (tool === 'custom') return measure?.b ? 'Enter the distance' : measure ? 'Click the second point' : 'Click two points a known distance apart';
		if (drawing) return draft.length < 3 ? 'Esc cancels, Enter completes, Ctrl+Z removes the last corner' : 'Click the first corner or press Enter to close (Esc cancels)';
		if (planSelected) return 'Drag the plan to move it, or type its position (Esc deselects)';
		if (imageMissing) return 'Upload the floorplan again to restore it';
		if (!hasImage) return '';
		return 'Drag corners or walls; click a midpoint to add one';
	});
</script>

<svelte:window onkeydown={onWindowKey} />

<Modal title="Plan" onClose={requestClose} {onEscapeKey} maxWidth="min(1280px, 96vw)" maxHeight="calc(100vh - 24px)" titleFontSize="1rem">
	{#snippet body()}
		<div class="floor-plan-modal">
			<nav class="layer-rail" aria-label="Plan steps">
				{#each PLAN_STEPS as s, i (s.id)}
					<button type="button" class="layer" class:active={step === s.id} aria-current={step === s.id ? 'step' : undefined} onclick={() => goStep(s.id)}>
						<span class="step-num" class:done={stepDone(s.id)} aria-hidden="true">{stepDone(s.id) ? '✓' : i + 1}</span>{s.title}{#if s.id === 'obstacles' && obstacles.length}<span class="layer-count">{obstacles.length}</span>{/if}
					</button>
				{/each}
			</nav>
			<div class="canvas-column">
				<div class="toolbar">
					{#if onOutline}
					<button type="button" class="tool" class:active={drawing} disabled={drawing} onclick={requestNewOutline} title="Start a new outline: click out its corners (click the first corner or press Enter to close, Escape cancels; fewer than three corners keeps the old outline)">
						New outline
					</button>
					<button type="button" class="tool" onclick={chooseFile} disabled={decoding} title="Upload a floor plan image (PNG, JPEG, WebP, GIF, SVG or PDF) to trace over">
						{decoding ? 'Reading…' : 'Upload floorplan…'}
					</button>
					<input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf" onchange={onFileChosen} hidden />
					<button type="button" class="tool" class:active={tool === 'custom'} disabled={!hasImage} onclick={startSetScale} title={hasImage ? 'Click two points on the plan a known distance apart, then type that distance (Escape cancels)' : 'Upload a floorplan first'}>Set scale</button>
					{:else if onObstacles}
					<button type="button" class="tool draw-tool" class:active={drawing} onclick={() => drawing ? stopObstacleDraw() : startObstacleDraw()} title="Draw an obstacle: click its corners; Enter or the first corner closes it. New obstacles reach floor to ceiling; set Bottom and Top after (Esc cancels)">Draw</button>
					<button type="button" class="tool" disabled={!selected || drawing} onclick={duplicateSelected} title="Copy the selected obstacle (Ctrl+D)">Copy</button>
					<button type="button" class="tool" disabled={!selected || drawing} onclick={deleteSelected} title="Remove the selected obstacle (Delete)">Delete</button>
					{:else if onLamps}
					<button type="button" class="tool icon-label" class:active={lampMode === 'move' && lamps.length > 0} aria-pressed={lampMode === 'move'} disabled={!lamps.length} onclick={() => (lampMode = 'move')} title="Drag lamps to move them (M)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></svg>
						Move
					</button>
					<button type="button" class="tool icon-label" class:active={lampMode === 'aim' && lamps.length > 0} aria-pressed={lampMode === 'aim'} disabled={!lamps.length} onclick={() => (lampMode = 'aim')} title="Drag from a lamp to where it should point (A)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><line x1="12" y1="1" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="23" /><line x1="1" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="23" y2="12" /></svg>
						Aim
					</button>
					<button type="button" class="tool icon-label" disabled={!lamps.length || !selectedLampIds.length} onclick={copySelectedLamps} title="Copy the selected lamps (Ctrl+D)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
						Copy
					</button>
					<button type="button" class="tool icon-label" disabled={!lamps.length || !selectedLampIds.length} onclick={deleteSelectedLamps} title="Remove the selected lamps (Delete)">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
						Delete
					</button>
					{:else if onZones}
					<button type="button" class="tool" class:active={drawing && drawKind === 'plane'} onclick={() => startZoneDraw('plane')} title="Draw a calculation plane: click its corners (Enter or the first corner closes it); set its height after">Draw plane</button>
					<button type="button" class="tool" class:active={drawing && drawKind === 'volume'} onclick={() => startZoneDraw('volume')} title="Draw a calculation volume: click its footprint's corners; it spans floor to ceiling until you set its range">Draw volume</button>
					<button type="button" class="tool" class:active={placing} disabled={drawing} onclick={() => setPlacing(!placing)} title="Click on the plan to place calculation points (Esc stops)">Place point</button>
					<button type="button" class="tool" disabled={!selectedZone || placing || drawing} onclick={copySelectedZone} title="Copy the selected zone (Ctrl+D)">Copy</button>
					<button type="button" class="tool" disabled={!selectedZone || placing || drawing} onclick={deleteSelectedZone} title="Remove the selected zone (Delete)">Delete</button>
					{/if}
					<div class="toolbar-right">
					<button type="button" class="tool icon-tool" disabled={!$history.canUndo} onclick={() => history.undo()} aria-label="Undo" title={$history.undoLabel ? `Undo ${$history.undoLabel.toLowerCase()} (${undoShortcut})` : `Undo (${undoShortcut})`}>↶</button>
					<button type="button" class="tool icon-tool" disabled={!$history.canRedo} onclick={() => history.redo()} aria-label="Redo" title={$history.redoLabel ? `Redo ${$history.redoLabel.toLowerCase()} (${redoShortcut})` : `Redo (${redoShortcut})`}>↷</button>
					<select class="units-select" value={units} onchange={handleUnitsChange} title="Units" aria-label="Units">
						{#each LENGTH_UNITS as u (u)}
							<option value={u}>{unitAbbrev(u)}</option>
						{/each}
					</select>
					</div>
				</div>
				<p class="plan-hint" aria-live="polite">{hint}</p>

				<PlanCanvas
					bind:this={canvas}
					bind:draft
					bind:drawing
					bind:selectedIndex
					bind:tool
					{units}
					{precision}
					fallbackFit={vertices}
					extraFitPoints={imageFitPoints}
					lamps={onLamps ? [] : lamps}
					objects={[]}
					{shapes}
					outline={onOutline ? undefined : vertices}
					allowNegative={onObstacles}
					draggableBody={onObstacles || (onZones && !!selectedFootprint)}
					onShapeClick={onObstacles ? selectObstacle : undefined}
					{onDrawEnd}
					onEdit={commitDraft}
					invalid={!drawing && validationMessage !== null && draft.length >= 3}
					ariaLabel="Floor plan canvas"
					{onCustomClick}
					{onCustomMove}
					onCustomLeave={() => { cursorFree = null; placeCursor = null; }}
					onCustomEnter={onScaleEnter}
					{onHostMove}
					{onHostPointerUp}
					{onBackgroundDragStart}
					onBackgroundPointerDown={() => { planSelected = false; if (onObstacles) selectObstacle(null); if (onLamps) selectLamp(null); if (onZones) selectZone(null); }}
				>
					{#snippet underlay(c)}
						<!-- Reference image (bottom-left anchored; SVG y is flipped) -->
						{#if planImage}
							<image
								class="plan-image"
								href={planImage.href}
								x={planImage.x}
								y={-(planImage.y + planImage.height)}
								width={planImage.width}
								height={planImage.height}
								opacity={planImage.opacity}
								preserveAspectRatio="none"
								role="img"
								aria-label="Floor plan reference image"
								class:interactive={planInteractive}
								class:selected={planSelected}
								onpointerdown={onPlanPointerDown}
							/>
							{#if planSelected}
								<rect class="plan-outline" x={planImage.x} y={-(planImage.y + planImage.height)} width={planImage.width} height={planImage.height} stroke-width={c.px * 2} stroke-dasharray="{c.px * 6} {c.px * 4}" />
							{/if}
						{/if}
					{/snippet}
					{#snippet overlay(c)}
						{#if onZones}
							{#each footprintZones.filter((z) => z.id !== selectedZoneId || drawing) as z (z.id)}
								{@const fp = zoneFootprint(z)}
								<polygon class="plan-zone" class:volume={z.type === 'volume'} class:off={z.enabled === false} points={fp.map(([x, y]) => `${x},${-y}`).join(' ')} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 6} {c.px * 3}" role="button" tabindex="-1" aria-label="Zone {z.name || z.id}" onpointerdown={(e) => { if (drawing || placing || e.button !== 0) return; e.stopPropagation(); selectZone(z.id); }} />
								<text class="plan-lamp-label" x={Math.min(...fp.map((p) => p[0])) + c.px * 4} y={-Math.max(...fp.map((p) => p[1])) + c.px * 13} font-size={c.px * 11}>{z.name || z.id}</text>
							{/each}
						{/if}
						{#if onLamps || onZones}
							{#each markers as m (m.id)}
								{@const v = markerView(m)}
								{@const sel = onLamps ? selectedLampIds.includes(m.id) : m.id === selectedMarkerId}
								{#if Math.hypot(v.ax - v.x, v.ay - v.y) > c.px * 2}
									<line class="aim-line" class:selected={sel} class:point={onZones} x1={v.x} y1={-v.y} x2={v.ax} y2={-v.ay} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 5} {c.px * 3}" />
								{/if}
								<circle class="plan-lamp" class:point={onZones} class:aiming={onLamps && lampMode === 'aim'} class:selected={sel} class:off={!m.enabled} cx={v.x} cy={-v.y} r={c.handleR * 1.5} stroke-width={c.handleR * 0.9} role="button" tabindex="-1" aria-label="{onLamps ? 'Lamp' : 'Point'} {m.name}" onpointerdown={(e) => onMarkerPointerDown(e, m.id, 'body')} />
								<circle class="plan-aim" class:point={onZones} class:selected={sel} cx={v.ax} cy={-v.ay} r={c.handleR * 0.7} role="button" tabindex="-1" aria-label="Aim of {m.name}" onpointerdown={(e) => onMarkerPointerDown(e, m.id, 'aim')} />
								<text class="plan-lamp-label" x={v.x + c.handleR * 2.3} y={-v.y + c.px * 4} font-size={c.px * 11}>{m.name}</text>
							{/each}
							{#if marquee}
								{@const mx = Math.min(marquee.a[0], marquee.b[0])}
								{@const my = Math.max(marquee.a[1], marquee.b[1])}
								<rect class="marquee" x={mx} y={-my} width={Math.abs(marquee.b[0] - marquee.a[0])} height={Math.abs(marquee.b[1] - marquee.a[1])} stroke-width={c.px * 1.5} stroke-dasharray="{c.px * 5} {c.px * 3}" />
							{/if}
							{#if placing && placeCursor}
								<circle class="plan-lamp ghost" class:point={onZones} cx={placeCursor[0]} cy={-placeCursor[1]} r={c.handleR * 1.5} stroke-width={c.handleR * 0.9} />
							{/if}
						{/if}
						{#if onReflectance && hoverSurface === 'walls' && vertices.length >= 3}
							<polygon class="surface-highlight" points={vertices.map(([x, y]) => `${x},${-y}`).join(' ')} stroke-width={c.px * 5} />
						{/if}
						{#if measureLine}
							<line x1={measureLine.x1} y1={measureLine.y1} x2={measureLine.x2} y2={measureLine.y2} class="measure-line" stroke-width={c.px * 2} stroke-dasharray="{c.px * 3} {c.px * 2}" />
							<circle cx={measureLine.x1} cy={measureLine.y1} r={c.handleR * 0.9} class="measure-dot" stroke-width={c.px * 2} />
							{#if measureLine.done}
								<circle cx={measureLine.x2} cy={measureLine.y2} r={c.handleR * 0.9} class="measure-dot" stroke-width={c.px * 2} />
							{/if}
						{/if}
					{/snippet}
					{#snippet hud(c)}
						{#if planSelected && placement && planImage}
							{@const anchor = c.toScreen(planImage.x, planImage.y)}
							<div class="plan-readout" style="left: {anchor[0]}px; top: {anchor[1] + 6}px" role="group" aria-label="Floorplan position">
								<label>x <ValidatedNumberInput value={placement.offsetX * k} {precision} step={snapStep} oncommit={(v) => setOffset('offsetX', v)} /></label>
								<label>y <ValidatedNumberInput value={placement.offsetY * k} {precision} step={snapStep} oncommit={(v) => setOffset('offsetY', v)} /></label>
								<span>{unit}</span>
							</div>
						{/if}
						{#if measure?.b}
							<div class="measure-popover" role="dialog" aria-label="Set scale">
								<span class="popover-title">How long is this line?</span>
								<span>{Math.round(measuredPixels)} px =</span>
								<label class="visually-hidden" for="measured-distance">Measured distance</label>
								<input
									id="measured-distance"
									type="number"
									inputmode="decimal"
									min="0"
									step="any"
									placeholder="distance"
									value={measuredDistance ?? ''}
									oninput={(e) => { const v = parseFloat((e.currentTarget as HTMLInputElement).value); measuredDistance = Number.isFinite(v) ? v : null; }}
									onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmMeasure(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelMeasure(); } }}
								/>
								<select class="measure-units" value={units} onchange={handleUnitsChange} aria-label="Distance units">
									{#each LENGTH_UNITS as u (u)}
										<option value={u}>{unitAbbrev(u)}</option>
									{/each}
								</select>
								<button type="button" class="primary" disabled={!(measuredDistance && measuredDistance > 0)} onclick={confirmMeasure}>OK</button>
								<button type="button" class="secondary" onclick={cancelMeasure}>Cancel</button>
							</div>
						{/if}
					{/snippet}
				</PlanCanvas>
			</div>

			<div class="side-column" class:wide={onReflectance || onLamps || onZones}>
				{#if onOutline}
				<div class="summary">
					<div><span class="summary-label">Floor area</span><span>{fmt(area)} {unit}²</span></div>
					{#if validationMessage && draft.length >= 3}
						<p class="plan-error" role="alert">Not saved: {validationMessage}</p>
					{:else if dirty && !drawing}
						<p class="plan-error" role="alert">Not saved: draw the new outline (the last saved one is kept until then)</p>
					{/if}
				</div>

				{#if placement || imageError}
					<div class="reference-panel">
						{#if imageError}
							<p class="plan-error" role="alert">{imageError}</p>
						{/if}
						{#if imageMissing}
							<p class="plan-note">The reference image could not be restored — upload it again to restore it (same file keeps the calibration).</p>
						{:else if placement}
							<div class="reference-meta">{imageFileName ?? 'Saved image'} · {placement.widthPx}×{placement.heightPx} px</div>
							{#if pdfPageCount > 1}
								<label class="reference-row">
									<span>Page</span>
									<select value={pdfPage} onchange={(e) => changePdfPage(Number((e.currentTarget as HTMLSelectElement).value))} aria-label="PDF page">
										{#each Array.from({ length: pdfPageCount }, (_, i) => i + 1) as n}
											<option value={n}>{n} of {pdfPageCount}</option>
										{/each}
									</select>
								</label>
							{/if}
							<label class="reference-row">
								<span>Opacity</span>
								<input type="range" min="0.1" max="1" step="0.05" value={placement.opacity} oninput={(e) => setOpacity(Number((e.currentTarget as HTMLInputElement).value))} onchange={commitOpacity} aria-label="Reference image opacity" />
							</label>
						{/if}
						{#if placement}
							<button type="button" class="secondary remove-image-btn" onclick={removeImage}>Remove</button>
						{/if}
					</div>
				{/if}

				<div class="vertex-table">
					<div class="vertex-header">
						<span></span>
						<span>X ({unit})</span>
						<span>Y ({unit})</span>
						<span></span>
					</div>
					<div class="vertex-rows">
						{#each draft as [vx, vy], i (i)}
							<div class="vertex-row" class:selected={selectedIndex === i}>
								<span class="row-index" title="Corner {i + 1}">{i + 1}</span>
								<ValidatedNumberInput value={vx} {precision} min={0} step={snapStep} disabled={drawing} oncommit={(v) => setVertexCoord(i, 0, v)} />
								<ValidatedNumberInput value={vy} {precision} min={0} step={snapStep} disabled={drawing} oncommit={(v) => setVertexCoord(i, 1, v)} />
								<button
									type="button"
									class="secondary remove-btn"
									title="Remove corner {i + 1}"
									aria-label="Remove corner {i + 1}"
									disabled={drawing || draft.length <= 3}
									onclick={() => removeVertex(i)}
								>×</button>
							</div>
						{/each}
					</div>
					<button type="button" class="secondary add-vertex-btn" disabled={drawing || draft.length < 2} onclick={addVertex}>Add corner</button>
				</div>
				{:else if onObstacles}
				<div class="obstacle-list" role="listbox" aria-label="Obstacles">
					{#each obstacles as o (o.key)}
						<button type="button" class="obstacle-row" class:selected={o.id === selectedId} role="option" aria-selected={o.id === selectedId} onclick={() => selectObstacle(o.id)}>
							<span class="obstacle-name">{o.name}</span>
							<span class="obstacle-height">{objectHeightText(o, roomZ, precision, unit)}</span>
						</button>
					{/each}
					{#if obstacles.length === 0}
						<p class="plan-note">No obstacles yet. Desks, partitions, columns: anything that blocks or reflects light. Nothing to add? Press Next.</p>
					{/if}
				</div>
				{#if selected}
					<div class="obstacle-props">
						{#if validationMessage && draft.length >= 3}
							<p class="plan-error" role="alert">Not saved: {validationMessage}</p>
						{/if}
						<label class="prop-row">
							<span>Name</span>
							<input id="obstacle-name" type="text" value={selected.name} onchange={(e) => commitName((e.currentTarget as HTMLInputElement).value)} />
						</label>
						<label class="prop-check">
							<input id="obstacle-full-height" type="checkbox" checked={selectedFull} onchange={(e) => toggleFullHeight((e.currentTarget as HTMLInputElement).checked)} />
							<span>Floor to ceiling</span>
						</label>
						{#if !selectedFull}
							<div class="prop-pair">
								<label><span>Bottom ({unit})</span><ValidatedNumberInput id="obstacle-bottom" value={selected.z} {precision} min={0} max={roomZ} step={snapStep} oncommit={commitBottom} /></label>
								<label><span>Top ({unit})</span><ValidatedNumberInput id="obstacle-top" value={objectTop(selected)} {precision} min={0} max={roomZ} step={snapStep} oncommit={commitTop} /></label>
							</div>
						{/if}
						<div class="prop-pair">
							<label><span>Reflectance</span><ValidatedNumberInput id="obstacle-reflectance" value={selected.reflectance} precision={2} min={0} max={Math.max(0, 1 - selected.transmittance)} step={0.05} oncommit={commitReflectance} /></label>
							<label><span>Transmittance</span><ValidatedNumberInput id="obstacle-transmittance" value={selected.transmittance} precision={2} min={0} max={Math.max(0, 1 - selected.reflectance)} step={0.05} oncommit={commitTransmittance} /></label>
						</div>
						<button type="button" class="disclosure" onclick={() => cornersOpen = !cornersOpen} aria-expanded={cornersOpen}>
							<span class="collapse-icon">{cornersOpen ? '▼' : '▶'}</span> Corners
						</button>
						{#if cornersOpen}
							<div class="vertex-table">
								<div class="vertex-header">
									<span></span>
									<span>X ({unit})</span>
									<span>Y ({unit})</span>
									<span></span>
								</div>
								<div class="vertex-rows">
									{#each draft as [vx, vy], i (i)}
										<div class="vertex-row" class:selected={selectedIndex === i}>
											<span class="row-index" title="Corner {i + 1}">{i + 1}</span>
											<ValidatedNumberInput value={vx} {precision} step={snapStep} disabled={drawing} oncommit={(v) => setVertexCoord(i, 0, v)} />
											<ValidatedNumberInput value={vy} {precision} step={snapStep} disabled={drawing} oncommit={(v) => setVertexCoord(i, 1, v)} />
											<button type="button" class="secondary remove-btn" title="Remove corner {i + 1}" aria-label="Remove corner {i + 1}" disabled={drawing || draft.length <= 3} onclick={() => removeVertex(i)}>×</button>
										</div>
									{/each}
								</div>
								<button type="button" class="secondary add-vertex-btn" disabled={drawing || draft.length < 2} onclick={addVertex}>Add corner</button>
							</div>
						{/if}
					</div>
				{/if}
				{:else if onLamps}
				<section class="add-lamp" aria-label="Add lamp">
					<h3 class="add-lamp-title">Add lamp</h3>
					<select bind:this={fixtureSelect} value={addFixture} onchange={(e) => chooseFixture(e.currentTarget)} aria-label="Fixture">
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
					{#if addFixture}
						<div class="placements" role="group" aria-label="Placement">
							{#each PLACEMENTS as pl (pl.mode)}
								<button type="button" class="secondary placement-btn" disabled={addingLamp !== null} onclick={() => addPlaced(pl.mode)} title={pl.title}>{addingLamp === pl.mode ? 'Adding…' : pl.label}</button>
							{/each}
						</div>
						<p class="plan-note">Each click adds one, placed automatically; adjust it on the plan.</p>
					{/if}
				</section>
				<div class="obstacle-list" role="listbox" aria-label="Lamps" aria-multiselectable="true">
					{#each lamps as l (l.id)}
						<button type="button" class="obstacle-row" class:selected={selectedLampIds.includes(l.id)} role="option" aria-selected={selectedLampIds.includes(l.id)} onclick={(e) => (e.shiftKey ? toggleLamp(l.id) : selectLamp(l.id))}>
							<span class="obstacle-name">{l.name || l.id}</span>
							<span class="obstacle-height">{lampHasPhotometry(l) ? `height ${fmt(l.z)} ${unit}` : 'choose a fixture'}</span>
						</button>
					{/each}
				</div>
				{#if selectedLampIds.length > 1}
					<p class="plan-note">{selectedLampIds.length} lamps selected. Move drags them together; Aim points them all at one spot.</p>
				{:else if selectedLamp && lampPanel}
					<div class="lamp-panel">
						{@render lampPanel(selectedLamp, () => selectLamp(null))}
					</div>
				{/if}
				{:else if onZones}
				<div class="obstacle-list" role="listbox" aria-label="Calc zones">
					{#each userZones as z (z.id)}
						<button type="button" class="obstacle-row" class:selected={z.id === selectedZoneId} role="option" aria-selected={z.id === selectedZoneId} onclick={() => selectZone(z.id)}>
							<span class="obstacle-name">{z.name || z.id}</span>
							<span class="obstacle-height">{zoneSummary(z)}</span>
						</button>
					{/each}
					{#if userZones.length === 0}
						<p class="plan-note">No calc zones of your own yet; the safety zones are added for you. Draw a plane or volume, place a point, or press Next to skip.</p>
					{/if}
				</div>
				{#if selectedZone && zonePanel}
					<div class="lamp-panel">
						{@render zonePanel(selectedZone, () => selectZone(null))}
					</div>
				{/if}
				{:else}
				<div class="reflectance-panel">
					<ReflectanceStep {onShowReflectanceSettings} onHover={(s) => hoverSurface = s} />
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

{#if pendingLeave}
	<ConfirmDialog
		title="Outline not saved"
		message="The outline on screen isn't valid, so it wasn't applied. Keep the last saved outline, or go back and fix it."
		confirmLabel="Keep saved outline"
		cancelLabel="Keep editing"
		variant="warning"
		onConfirm={() => answerLeave(true)}
		onCancel={() => answerLeave(false)}
	/>
{/if}
{#if askNewOutline}
	<ConfirmDialog
		title="Start a new outline?"
		message="This removes the {draft.length} corner{draft.length === 1 ? '' : 's'} of the current outline so you can draw it again from scratch. Cancelling the drawing before three corners restores them."
		confirmLabel="Clear and draw"
		cancelLabel="Keep"
		variant="warning"
		onConfirm={startDraw}
		onCancel={() => askNewOutline = false}
	/>
{/if}

{#if askClearOutline}
	<ConfirmDialog
		title="Clear the old outline?"
		message="The floorplan is loaded. Remove the existing corners so you can trace the room fresh, or keep them."
		confirmLabel="Clear"
		cancelLabel="Keep"
		variant="warning"
		onConfirm={() => answerClearOutline(true)}
		onCancel={() => answerClearOutline(false)}
	/>
{/if}

{#if askTrace}
	<ConfirmDialog
		title="Trace the room outline"
		message="Place at least three points on the plan to mark the room's corners."
		confirmLabel="Start tracing"
		cancelLabel="Later"
		variant="success"
		onConfirm={() => answerTrace(true)}
		onCancel={() => answerTrace(false)}
	/>
{/if}

{#if askSetScale}
	<ConfirmDialog
		title="Set the scale now?"
		message="Click two points on the plan a known distance apart and type that distance. You can also do this later with Set scale."
		confirmLabel="Set scale now"
		cancelLabel="Later"
		variant="success"
		onConfirm={() => answerSetScale(true)}
		onCancel={() => answerSetScale(false)}
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
