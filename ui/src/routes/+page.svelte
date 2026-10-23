<script lang="ts">
	import { buildExploreZoneOptions } from '$lib/utils/exploreZones';
	import { project, room, lamps, zones, objects, results, syncErrors, fetchStateHashesDebounced, wasRestoredFromStorage, needsCalculation, plotSettings } from '$lib/stores/project';
	import { calculationStatus } from '$lib/stores/calculationStatus';
	import { refreshPositionWarnings } from '$lib/stores/audit';
	import StartChooserModal, { type StartChoice } from '$lib/components/StartChooserModal.svelte';
	import { roomVertices } from '$lib/utils/roomGeometry';
	import { zoneHasFootprint, zoneFootprint, footprintGeometry } from '$lib/utils/zoneFootprint';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { undoKeyOf, inTextField, interceptUndo } from '$lib/utils/undoKeys';
	import RoomViewer from '$lib/components/RoomViewer.svelte';
	import LampEditor from '$lib/components/LampEditor.svelte';
	import ZoneEditor from '$lib/components/ZoneEditor.svelte';
	import ObjectEditor from '$lib/components/ObjectEditor.svelte';
	import CalculateButton from '$lib/components/CalculateButton.svelte';
	import ZoneStatsPanel from '$lib/components/ZoneStatsPanel.svelte';
	import ResizablePanel from '$lib/components/ResizablePanel.svelte';
	import HelpModal from '$lib/components/HelpModal.svelte';
	import AboutModal from '$lib/components/AboutModal.svelte';
	import CiteModal from '$lib/components/CiteModal.svelte';
	import ReflectanceSettingsModal from '$lib/components/ReflectanceSettingsModal.svelte';
	import type { PlanActions, PlanScene } from '$lib/plan/planActions';
	import { PlanController, isTypingTarget } from '$lib/plan/planController.svelte';
	import PlanPane from '$lib/plan/PlanPane.svelte';
	import ViewsPane from '$lib/workspace/ViewsPane.svelte';
	import EditorPanel from '$lib/workspace/EditorPanel.svelte';
	import SummaryPanel from '$lib/workspace/SummaryPanel.svelte';
	import { scrollRowIntoView } from '$lib/workspace/parts/scrollRowIntoView';
	import { swapped } from '$lib/workspace/layoutGeometry';
	import { planContext, type EditorStage, type RoomPart } from '$lib/workspace/editorNav';
	import { workspaceUi } from '$lib/stores/workspaceUi';
	import AuditModal from '$lib/components/AuditModal.svelte';
	import AdvancedLampSettingsModal from '$lib/components/AdvancedLampSettingsModal.svelte';
	import type { AdvancedLampSettingsResponse } from '$lib/api/client';
	import ExploreDataModal from '$lib/components/ExploreDataModal.svelte';
	import SpectrumViewerModal from '$lib/components/SpectrumViewerModal.svelte';
	import ExportModal from '$lib/components/ExportModal.svelte';
	import ReportModal from '$lib/components/ReportModal.svelte';
	import type { SceneCaptureApi } from '$lib/utils/reportCapture';
	import SyncErrorToast from '$lib/components/SyncErrorToast.svelte';
	import ModalDock from '$lib/components/ModalDock.svelte';
	import { restoreByTitle, restoreById } from '$lib/stores/modalDock.svelte';
	import MenuBar from '$lib/components/MenuBar.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import { getVersion, saveSession, loadSession, getLampOptionsCached, placeSessionLamp } from '$lib/api/client';
	import { attachSidecar, extractSidecar, extractReportMeta, extractHidden, extractPlotSettings, stripSidecar } from '$lib/utils/floorplanSidecar';
	import { floorplanImage } from '$lib/stores/floorplanImage';
	import type { LampInstance, CalcZone, ZoneDisplayMode, SceneObject } from '$lib/types/project';
	import { defaultLamp, defaultZone, defaultObject, ROOM_DEFAULTS } from '$lib/types/project';
	import { userSettings, type WorkspaceLayout } from '$lib/stores/settings';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import type { IsosurfaceData } from '$lib/utils/isosurface';
	import { volumeIsoScale, type IsoScale } from '$lib/utils/plotScale';
	import { zoneValueFactor } from '$lib/utils/calculations';
	import { performCalculation } from '$lib/utils/calculate';
	import { pickMode } from '$lib/stores/pickMode';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import LampManagerModal from '$lib/components/LampManagerModal.svelte';
	import { lampLibrary, customLamps } from '$lib/stores/lampLibrary';
	import { getNextCornerIndex, getNextEdgeIndex, type PlacementMode } from '$lib/utils/lampPlacement';
	import type { FixtureOption } from '$lib/utils/lampFixture';
	import type { CustomLampType } from '$lib/types/lampLibrary';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import FilenameDialog from '$lib/components/FilenameDialog.svelte';
	import { createProjectFile } from '$lib/utils/projectFile';

	let showHelpModal = $state(false);
	let showAboutModal = $state(false);
	let showCiteModal = $state(false);
	let showReflectanceSettings = $state(false);
	let showAuditModal = $state(false);
	let advancedSettingsLampId = $state<string | null>(null);
	let showExploreDataModal = $state(false);
	let showSpectrumViewer = $state(false);
	let showExportModal = $state(false);
	let showReportModal = $state(false);
	let captureApi = $state<SceneCaptureApi | null>(null);
	let showSettingsModal = $state(false);
	let showLampManager = $state(false);
	let showStartChooser = $state(false);
	// Fixtures the Plan's Add lamp offers: built-in presets and the custom lamp library
	let lampPresets = $state<{ id: string; name: string }[]>([]);
	onMount(() => {
		getLampOptionsCached().then((o) => (lampPresets = o.presets_222nm.filter((p) => p.id !== 'custom'))).catch(() => {});
	});
	const planFixtures = $derived<FixtureOption[]>([
		...lampPresets.map((p) => ({ key: `preset:${p.id}`, label: p.name, group: 'Presets (222 nm)' })),
		...$customLamps.map((d) => ({ key: `custom:${d.id}`, label: d.name, group: 'Custom lamps' })),
	]);
	/** A new lamp with a fixture, placed by a placement mode (the backend's placement, else the local one). */
	async function addPlacedLamp(fixture: string, mode: PlacementMode): Promise<string> {
		const units = $userSettings.units;
		const lamp = defaultLamp($room, $lamps, mode, units);
		lamp.name = `Lamp ${$lamps.length + 1}`;
		if (fixture.startsWith('preset:')) {
			lamp.lamp_type = 'krcl_222';
			lamp.preset_id = fixture.slice('preset:'.length);
		}
		const id = await project.addLamp(lamp);
		if (fixture.startsWith('custom:')) await project.applyCustomLamp(id, fixture.slice('custom:'.length));
		// Corners and walls cycle: take the next free one
		const others = get(lamps).filter((l) => l.id !== id);
		const positionIndex = mode === 'corner' ? getNextCornerIndex($room, others, -1, units)
			: mode === 'edge' || mode === 'horizontal' ? getNextEdgeIndex($room, others, -1, units)
			: undefined;
		try {
			const p = await placeSessionLamp(id, mode, positionIndex);
			// Rounded to the room's precision, as the lamp editor's placement buttons do
			const r = (v: number) => parseFloat(v.toFixed($room.precision));
			project.updateLamp(id, { x: r(p.x), y: r(p.y), z: r(p.z), angle: p.angle ?? 0, aimx: r(p.aimx), aimy: r(p.aimy), aimz: r(p.aimz) });
		} catch (e) {
			console.warn('Lamp placement failed, using the local placement:', e);
		}
		return id;
	}

	// The Plan applies each finished edit straight to the project.
	const planActions: PlanActions = {
		addPlacedLamp: (fixture, mode) => project.history.batch('Add lamp', () => addPlacedLamp(fixture, mode)),
		copyLamps: (ids, dx, dy) => project.history.batch('Copy lamps', async () => {
			const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
			const out: string[] = [];
			for (const id of ids) {
				const src = get(lamps).find((l) => l.id === id);
				const newId = await project.copyLamp(id);
				if (src) project.updateLamp(newId, { x: r6(src.x + dx), y: r6(src.y + dy), aimx: r6(src.aimx + dx), aimy: r6(src.aimy + dy) });
				out.push(newId);
			}
			return out;
		}),
		setOutline: (vertices) => project.updateRoom({ shape: 'polygon', vertices }),
		setPlacement: (placement, image) => {
			if (image && placement) project.setFloorPlan(placement, image);
			else if (!placement) project.clearFloorPlan();
			else project.updateRoom({ floorplan: placement });
		},
		addObstacle: (obj) => project.addObject(obj),
		updateObstacle: (id, partial) => project.updateObject(id, partial),
		removeObstacle: (id) => project.removeObject(id),
		addLamp: (x, y, likeId) => project.history.batch('Add lamp', async () => {
			const like = likeId ? $lamps.find((l) => l.id === likeId) : undefined;
			const name = `Lamp ${$lamps.length + 1}`;
			if (like) {
				// Same fixture and the same aim relative to the lamp
				const id = await project.copyLamp(like.id);
				project.updateLamp(id, { name, x, y, aimx: x + (like.aimx - like.x), aimy: y + (like.aimy - like.y) });
				return id;
			}
			return project.addLamp({ ...newLampFromSettings(), name, x, y, aimx: x, aimy: y, aimz: 0 });
		}),
		updateLamp: (id, partial) => project.updateLamp(id, partial),
		removeLamp: (id) => project.removeLamp(id),
		addZone: (type, geometry) => project.addZone({ ...newZoneFromSettings(type), ...geometry }),
		updateZone: (id, partial) => project.updateZone(id, partial),
		removeZone: (id) => project.removeZone(id),
		copyZone: (id, dx, dy) => project.history.batch('Copy zone', async () => {
			const src = $zones.find((z) => z.id === id);
			const newId = await project.copyZone(id);
			if (!src) return newId;
			const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
			if (src.type === 'point') {
				project.updateZone(newId, { x: r6((src.x ?? 0) + dx), y: r6((src.y ?? 0) + dy), aim_x: r6((src.aim_x ?? 0) + dx), aim_y: r6((src.aim_y ?? 0) + dy) });
			} else if (zoneHasFootprint(src)) {
				const moved = zoneFootprint(src).map(([x, y]) => [r6(x + dx), r6(y + dy)] as [number, number]);
				project.updateZone(newId, { ...footprintGeometry(src.type, moved), fit_room: false });
			}
			return newId;
		}),
		changeUnits: (u) => project.changeUnits(u),
		updateRoom: (partial) => project.updateRoom(partial),
		setHidden: (kind, id, hidden) => project.setHidden(kind, id, hidden),
	};

	const planImage = $derived($room.floorplan && $floorplanImage?.id === $room.floorplan.imageId ? $floorplanImage : null);

	// Items hidden with the eye icons, saved with the project
	const hiddenLampIds = $derived(new Set($project.hidden?.lamps ?? []));
	const hiddenZoneIds = $derived(new Set($project.hidden?.zones ?? []));
	const hiddenObjectIds = $derived(new Set($project.hidden?.objects ?? []));

	// The workspace: one plan controller shared by the editor column and the 2D
	// view. Its scene reads the stores through getters, so each derived value
	// tracks only the stores it reads.
	const planVertices = $derived(roomVertices($room));
	const planHidden = $derived({ lamps: hiddenLampIds, zones: hiddenZoneIds, objects: hiddenObjectIds });
	const planScene: PlanScene = {
		get vertices() { return planVertices; },
		get units() { return $userSettings.units; },
		get precision() { return $room.precision; },
		get lamps() { return $lamps; },
		get objects() { return $objects; },
		get zones() { return $zones; },
		get floorplan() { return $room.floorplan ?? null; },
		get image() { return planImage; },
		get roomZ() { return $room.z; },
		get fixtures() { return planFixtures; },
		get room() { return $room; },
		get hidden() { return planHidden; },
	};
	const plan = new PlanController({ actions: planActions, scene: () => planScene });

	/** Point the plan at what the workspace shows (the summary is view-only). */
	function syncPlanContext() {
		const s = get(workspaceUi);
		plan.setContext(planContext(s.mode, s.stage, s.part));
	}
	// The plan's context follows the workspace, on mount and after every change
	$effect(() => {
		const s = $workspaceUi;
		untrack(() => plan.setContext(planContext(s.mode, s.stage, s.part)));
	});

	/** Show the editor column (the Configure tab on a phone). */
	function revealEditor() {
		if (isMobile) activeMobileTab = 'configure'; else leftPanelCollapsed = false;
	}

	/** Open an editor step, asking first if an invalid outline is on screen; `then` runs once there. */
	function openStep(stage: EditorStage, part: RoomPart | undefined, then?: () => void) {
		const s = get(workspaceUi);
		const here = s.mode === 'editor' && s.stage === stage && (stage !== 'room' || (part ?? s.part) === s.part);
		const go = () => {
			workspaceUi.goTo(stage, part);
			syncPlanContext();
			revealEditor();
			then?.();
		};
		if (here) go();
		else plan.requestLeave(go);
	}

	function finishEditing() {
		workspaceUi.showSummary();
		syncPlanContext();
	}

	function editFromSummary(stage: EditorStage, part?: RoomPart) {
		workspaceUi.goTo(stage, part);
		syncPlanContext();
	}

	/** View › Layout: a new layout starts at 50/50 with the inset showing. */
	function setWorkspaceLayout(layout: WorkspaceLayout) {
		userSettings.update((s) => ({ ...s, workspaceLayout: layout, workspaceSplit: 0.5, workspaceInsetHidden: false }));
	}
	function swapViews() {
		const s = get(userSettings);
		const next = swapped(s.workspaceLayout, s.workspaceSwap);
		userSettings.update((u) => ({ ...u, workspaceLayout: next.layout, workspaceSwap: next.swap }));
	}
	function onViewsChange(patch: Partial<{ layout: WorkspaceLayout; swap: boolean; split: number; inset: { x: number; y: number } | null; insetHidden: boolean }>) {
		userSettings.update((s) => ({
			...s,
			...(patch.layout !== undefined && { workspaceLayout: patch.layout }),
			...(patch.swap !== undefined && { workspaceSwap: patch.swap }),
			...(patch.split !== undefined && { workspaceSplit: patch.split }),
			...(patch.inset !== undefined && { workspaceInset: patch.inset }),
			...(patch.insetHidden !== undefined && { workspaceInsetHidden: patch.insetHidden }),
		}));
	}

	let startChooserBusy = $state(false);
	let lampManagerInitialType = $state<CustomLampType | null>(null);
	// The lamp that launched the manager via 'Add custom lamp...', if any. A
	// definition created in that session is auto-applied to this lamp.
	let lampManagerTargetLampId = $state<string | null>(null);
	// Definition the manager opens straight into editing (editor "Spectrum..." button)
	let lampManagerEditDefId = $state<string | null>(null);
	let settingsInitialTab = $state<'room' | 'lamps' | 'zones' | 'results' | 'display'>('room');

	/** Open the lamp manager for a lamp ('Add custom lamp...', or its definition's spectrum). */
	function openLampManagerFor(type: CustomLampType, lampId: string, editDefId?: string) {
		lampManagerInitialType = editDefId ? null : type;
		lampManagerEditDefId = editDefId ?? null;
		lampManagerTargetLampId = lampId;
		if (!restoreById('lamp-manager')) showLampManager = true;
	}

	/** If a minimized modal with the given title exists, restore it; otherwise run the open callback. */
	function openOrRestore(title: string, open: () => void) {
		if (!restoreByTitle(title)) open();
	}

	// If all lamps share a single wavelength, use it as the default species filter
	const singleLampWavelength = $derived.by(() => {
		const lampList = $lamps;
		if (lampList.length === 0) return undefined;
		const wavelengths = new Set(lampList.map(l => {
			if (l.wavelength != null) return l.wavelength;
			if (l.lamp_type === 'krcl_222') return 222;
			if (l.lamp_type === 'lp_254') return 254;
			return undefined;
		}).filter((w): w is number => w != null));
		return wavelengths.size === 1 ? [...wavelengths][0] : undefined;
	});
	let appVersion = $state<string | null>(null);
	let guvCalcsVersion = $state<string | null>(null);
	let leftPanelCollapsed = $state(false);
	let rightPanelCollapsed = $state(false); // Open so the empty state tells the user where results will land
	let hasEverCalculated = $state(false);

	// Mobile responsive state
	let isMobile = $state(false);
	type MobileTab = 'configure' | 'viewer' | 'results';
	let activeMobileTab = $state<MobileTab>('viewer');

	function checkMobile() {
		isMobile = window.innerWidth < 768;
	}

	// Dialog state
	let showNewProjectConfirm = $state(false);
	let alertDialog = $state<{ title: string; message: string } | null>(null);
	let isLoadingFile = $state(false);
	let lampLibraryNotice = $state<string | null>(null);

	// Position warnings only surface in the next-step card once results exist,
	// so refresh them after each calculation rather than after every edit
	// (the audit modal refreshes on open as well).
	$effect(() => {
		if (!$results?.calculatedAt) return;
		refreshPositionWarnings();
	});


	// Common display mode across all zones (null if mixed or no zones)
	const commonZoneDisplayMode = $derived.by<ZoneDisplayMode | null>(() => {
		if ($zones.length === 0) return null;
		const first = $zones[0].display_mode ?? 'heatmap';
		return $zones.every(z => (z.display_mode ?? 'heatmap') === first) ? first : null;
	});

	// Global value range across plane zones only (for global heatmap normalization)
	const globalValueRange = $derived.by(() => {
		if (!$results?.zones) return null;
		let min = Infinity, max = -Infinity;
		for (const zone of $zones) {
			if (zone.enabled === false) continue;
			if (zone.type !== 'plane') continue;
			const result = $results.zones[zone.id];
			if (!result?.values) continue;
			if (result.statistics.min != null && result.statistics.min < min) min = result.statistics.min;
			if (result.statistics.max != null && result.statistics.max > max) max = result.statistics.max;
		}
		if (!isFinite(min) || !isFinite(max)) return null;
		return { min, max };
	});

	// Explore data modal: zone options and fluence from results
	const exploreZoneOptions = $derived(buildExploreZoneOptions($zones, $results?.zones));
	const exploreDefaultFluence = $derived($results?.zones?.['WholeRoomFluence']?.statistics?.mean);

	// 3D highlighting follows the plan's selection
	const selectedLampIds = $derived(plan.selectedLampIds);
	const selectedZoneIds = $derived(plan.selectedZoneId ? [plan.selectedZoneId] : []);
	const selectedObjectIds = $derived(plan.selectedId ? [plan.selectedId] : []);

	// 3D hover highlight: a row under the pointer (editor or summary), or a lamp in the results panel
	let hoveredLampId = $state<string | null>(null);
	const hoveredOf = (kind: 'lamps' | 'zones' | 'objects') => (plan.hoveredItem?.kind === kind ? [plan.hoveredItem.id] : []);
	const highlightedLampIds = $derived(hoveredLampId ? [hoveredLampId] : hoveredOf('lamps'));
	const highlightedZoneIds = $derived(hoveredOf('zones'));
	const highlightedObjectIds = $derived(hoveredOf('objects'));

	// Each volume's isosurfaces, from its plot settings (shared by the room view and its plot window)
	const isoScaleMap = $derived.by(() => {
		const map: Record<string, IsoScale> = {};
		const colormap = $room.colormap || 'plasma';
		for (const zone of $zones) {
			if (zone.type !== 'volume') continue;
			const result = $results?.zones?.[zone.id];
			if (!result?.values) continue;
			map[zone.id] = volumeIsoScale($plotSettings[zone.id], result.values as number[][][], zoneValueFactor(zone, result), colormap).iso;
		}
		return map;
	});

	// Pre-built isosurface geometries per zone, reported by CalcVol3D.
	// The modal reuses these instead of re-running marching cubes.
	let isoGeometryMap = $state<Record<string, { isosurfaces: IsosurfaceData[]; valueRange: { min: number; max: number; range: number } }>>({});

	function handleIsoGeometryReady(zoneId: string, data: { isosurfaces: IsosurfaceData[]; valueRange: { min: number; max: number; range: number } }) {
		isoGeometryMap = { ...isoGeometryMap, [zoneId]: data };
	}

	// Visible IDs: everything not hidden with its eye
	const visibleLampIds = $derived($lamps.filter(l => !hiddenLampIds.has(l.id)).map(l => l.id));
	const visibleZoneIds = $derived($zones.filter(z => !hiddenZoneIds.has(z.id)).map(z => z.id));
	const visibleObjectIds = $derived($objects.filter(o => !hiddenObjectIds.has(o.id)).map(o => o.id));

	// 3D scene click selection - tracks which object was last selected via 3D click
	// Used for toggle (click again to deselect) and cycling (overlapping objects)
	type SceneSelection = { type: 'lamp' | 'zone' | 'object'; id: string };
	let sceneSelection = $state<SceneSelection | null>(null);
	let pendingClickTargets: SceneSelection[] = [];
	let clickBatchTimer: ReturnType<typeof setTimeout> | null = null;

	function handleLampClick(lampId: string) {
		pendingClickTargets.push({ type: 'lamp', id: lampId });
		if (!clickBatchTimer) {
			clickBatchTimer = setTimeout(processClickBatch, 0);
		}
	}

	function handleZoneClick(zoneId: string) {
		pendingClickTargets.push({ type: 'zone', id: zoneId });
		if (!clickBatchTimer) {
			clickBatchTimer = setTimeout(processClickBatch, 0);
		}
	}

	function handleObjectClick(objectId: string) {
		pendingClickTargets.push({ type: 'object', id: objectId });
		if (!clickBatchTimer) {
			clickBatchTimer = setTimeout(processClickBatch, 0);
		}
	}

	async function processClickBatch() {
		const unsorted = [...pendingClickTargets];
		pendingClickTargets = [];
		clickBatchTimer = null;

		if (unsorted.length === 0) return;
		// The summary is view-only: 3D clicks select nothing there
		if (get(workspaceUi).mode !== 'editor') return;

		// Sort by selection priority: lamps first, then objects (solid, small),
		// then non-volume zones, volumes last
		const zoneMap = new Map($zones.map(z => [z.id, z]));
		function clickPriority(t: SceneSelection): number {
			if (t.type === 'lamp') return 0;
			if (t.type === 'object') return 1;
			const zone = zoneMap.get(t.id);
			if (zone && zone.type === 'volume') return 3;
			return 2;
		}
		const targets = unsorted.sort((a, b) => clickPriority(a) - clickPriority(b));

		const prev = sceneSelection;

		// Only consider the previous selection if the plan still has it selected
		const prevStillOpen = prev !== null && isSelectedInPlan(prev);

		// Find current selection among clicked targets
		const prevIdx = prev && prevStillOpen
			? targets.findIndex(t => t.type === prev.type && t.id === prev.id)
			: -1;

		let next: SceneSelection | null;

		if (prevIdx !== -1) {
			// Currently selected object was clicked - cycle to next, or deselect if last
			const nextIdx = prevIdx + 1;
			next = nextIdx < targets.length ? targets[nextIdx] : null;
		} else {
			// Nothing selected or selection wasn't at this click location
			next = targets[0];
		}

		sceneSelection = next;

		if (!next) {
			if (prev && prevStillOpen) deselectInPlan(prev);
			return;
		}
		// Open the item's step, select it there and scroll its row into view
		const target = next;
		const step: [EditorStage, RoomPart | undefined] = target.type === 'lamp' ? ['lamps', undefined]
			: target.type === 'object' ? ['room', 'structures']
			: ['zones', undefined];
		openStep(step[0], step[1], () => {
			if (target.type === 'lamp') plan.selectedLampIds = [target.id];
			else if (target.type === 'object') plan.selectObstacle(target.id);
			else plan.selectZone(target.id);
			scrollRowIntoView(target.id);
		});
	}

	function isSelectedInPlan(s: SceneSelection): boolean {
		if (s.type === 'lamp') return plan.onLamps && plan.selectedLampIds.includes(s.id);
		if (s.type === 'object') return plan.onObstacles && plan.selectedId === s.id;
		return plan.onZones && plan.selectedZoneId === s.id;
	}

	function deselectInPlan(s: SceneSelection) {
		if (s.type === 'lamp') plan.selectLamp(null);
		else if (s.type === 'object') plan.selectObstacle(null);
		else plan.selectZone(null);
	}

	// Auto-expand right panel on first calculation
	$effect(() => {
		if ($results && !hasEverCalculated) {
			hasEverCalculated = true;
			rightPanelCollapsed = false;
		}
	});

	// Re-establish session when page is restored from bfcache (back/forward navigation)
	function handlePageShow(event: PageTransitionEvent) {
		if (event.persisted) {
			project.initSession().catch((e: unknown) => {
				syncErrors.add('Session restoration', e, 'warning');
			});
		}
	}

	// --- Beforeunload: warn about unsaved project changes ---
	let lastSavedSnapshot: string | null = $state(null);

	function markProjectClean() {
		// Snapshot project state excluding volatile fields
		const { results, lastModified, ...stable } = $project;
		lastSavedSnapshot = JSON.stringify(stable);
	}

	function isProjectDirty(): boolean {
		if (lastSavedSnapshot === null) {
			// Never saved — dirty if any lamps or zones exist
			return $lamps.length > 0 || $zones.length > 0;
		}
		const { results, lastModified, ...stable } = $project;
		return JSON.stringify(stable) !== lastSavedSnapshot;
	}

	function handleBeforeUnload(e: BeforeUnloadEvent) {
		if (isProjectDirty()) {
			e.preventDefault();
			e.returnValue = '';
		}
	}

	onMount(async () => {
		// Initialize mobile detection
		checkMobile();
		window.addEventListener('resize', checkMobile);

		// If we have results from a previous session, keep the panel open
		const p = $project;
		if (p.results) {
			hasEverCalculated = true;
			rightPanelCollapsed = false;
		}

		// Listen for bfcache restoration (browser back/forward button)
		window.addEventListener('pageshow', handlePageShow);
		window.addEventListener('beforeunload', handleBeforeUnload);

		// Initialize the custom lamp library (IndexedDB + project-scoped sessionStorage).
		// Await it so a session (re)init's reuploadCustomFiles cannot race the load and
		// see custom-lamp definitions as missing (silently dropping their photometry).
		await lampLibrary.init(wasRestoredFromStorage());

		// Fetch version info and initialize session in parallel (independent)
		const [versionResult, sessionResult] = await Promise.allSettled([
			getVersion(),
			project.initSession(),
		]);

		if (versionResult.status === 'fulfilled') {
			appVersion = versionResult.value.version;
			guvCalcsVersion = versionResult.value.guv_calcs_version;
		} else {
			console.warn('Failed to fetch version:', versionResult.reason);
		}

		if (sessionResult.status === 'rejected') {
			console.warn('Failed to initialize session:', sessionResult.reason);
			syncErrors.add('Session initialization', sessionResult.reason, 'warning');
		}

		// Handle ?preview_lamp=<preset_id> URL parameter
		if (sessionResult.status === 'fulfilled') {
			const urlParams = new URLSearchParams(window.location.search);
			const previewLampId = urlParams.get('preview_lamp');

			if (!previewLampId && $userSettings.showStartChooser && !wasRestoredFromStorage() && $lamps.length === 0) {
				showStartChooser = true;
			}

			if (previewLampId) {
				// Clean the URL immediately regardless of outcome
				const cleanUrl = new URL(window.location.href);
				cleanUrl.searchParams.delete('preview_lamp');
				history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search);

				try {
					// Validate against available lamp options (match by ID or display name)
					const lampOptions = await getLampOptionsCached();
					const needle = previewLampId.toLowerCase();
					const validPreset = lampOptions.presets_222nm.find(
						p => p.id !== 'custom' && (p.id === needle || p.name.toLowerCase() === needle)
					);

					if (validPreset) {
						// Start fresh so the preview shows only this lamp
						project.reset({ skipBackendSync: true });
						await project.initSession();
						await placePresetLampAndCalculate(validPreset);
					} else {
						console.warn(`Preview lamp: invalid preset ID "${previewLampId}"`);
					}
				} catch (e) {
					console.warn('Preview lamp handling failed:', e);
				}
			}
		}

		// Record a "clean" baseline once the initial load has fully settled.
		// A fresh project already contains standard calc zones, so without a
		// baseline isProjectDirty() reports the untouched page as dirty and a
		// plain reload pops the unsaved-changes prompt. refreshStandardZones()
		// resolves after the backend has filled in the real zone values, so the
		// snapshot captures the settled state rather than placeholders.
		if (sessionResult.status === 'fulfilled') {
			try {
				await project.refreshStandardZones();
			} catch (e) {
				console.warn('Zone settle before clean baseline failed:', e);
			}
		}
		markProjectClean();
	});

	onDestroy(() => {
		window.removeEventListener('pageshow', handlePageShow);
		window.removeEventListener('beforeunload', handleBeforeUnload);
		window.removeEventListener('resize', checkMobile);
		if (clickBatchTimer) clearTimeout(clickBatchTimer);
	});

	/**
	 * Add one lamp from a built-in preset, let the backend place it (fixture
	 * size, wall clearance, tilt), then calculate. Shared by ?preview_lamp and
	 * the "typical room" start option.
	 */
	async function placePresetLampAndCalculate(preset: { id: string; name: string; default_placement_mode?: string }, lampName = preset.name) {
		const placementMode = (preset.default_placement_mode as 'downlight' | 'corner' | 'edge' | 'horizontal') || 'downlight';
		const newLamp = defaultLamp($room, $lamps, placementMode, $userSettings.units);
		newLamp.name = lampName;
		newLamp.lamp_type = 'krcl_222';
		newLamp.preset_id = preset.id;
		const lampId = await project.addLamp(newLamp);

		try {
			const placement = await placeSessionLamp(lampId, placementMode);
			project.updateLamp(lampId, {
				x: placement.x,
				y: placement.y,
				z: placement.z,
				aimx: placement.aimx,
				aimy: placement.aimy,
				aimz: placement.aimz,
				tilt: placement.tilt,
				orientation: placement.orientation,
			});
		} catch (e) {
			console.warn('Lamp placement failed, using defaults:', e);
		}

		const calcResult = await performCalculation();
		if (calcResult.success) {
			hasEverCalculated = true;
			rightPanelCollapsed = false;
		} else {
			console.warn('Calculation failed:', calcResult.error);
		}
	}

	async function handleStartChoice(choice: StartChoice) {
		if (choice === 'open') {
			showStartChooser = false;
			openProject(true);
			return;
		}
		if (choice === 'empty') {
			// Straight into drawing the room: the editor at Room › Floorplan
			showStartChooser = false;
			workspaceUi.reset('editor');
			workspaceUi.goTo('room', 'floorplan');
			syncPlanContext();
			revealEditor();
			return;
		}
		startChooserBusy = true;
		try {
			await project.sessionReady();
			// A typical US office in feet, and the standard zones rebuilt for it before the lamp lands
			// changeUnits converts the room through the backend and applies the echo, so it
			// must finish before the feet dimensions go in or they get converted too.
			if ($userSettings.units !== 'feet') await project.changeUnits('feet');
			project.updateRoom({ x: 13, y: 20, z: 9 });
			await project.refreshStandardZones();
			const options = await getLampOptionsCached();
			const preset = options.presets_222nm.find(p => p.id === 'ushio_b1') ?? options.presets_222nm.find(p => p.id !== 'custom');
			if (preset) await placePresetLampAndCalculate(preset, `Lamp ${$lamps.length + 1}`);
			// A finished setup lands on the summary
			finishEditing();
		} catch (e) {
			console.warn('Typical room setup failed:', e);
			syncErrors.add('Typical room setup', e, 'warning');
		} finally {
			startChooserBusy = false;
			showStartChooser = false;
		}
	}

	function startFresh() {
		showNewProjectConfirm = true;
	}

	/** New Project: an empty project, edited from Room › Floorplan. */
	function startNewProject() {
		showNewProjectConfirm = false;
		project.reset();
		projectFile.forget();
		markProjectClean();
		workspaceUi.reset('editor');
		syncPlanContext();
		plan.resetForNewScene();
	}

	/** The project as .guv text, with the app-owned block (floor plan, report details, hidden items). */
	async function buildGuvContent(): Promise<string> {
		const image = floorplanImage.get();
		const placement = $room.floorplan;
		const sidecar = image && placement && placement.imageId === image.id
			? { placement, image: { mime: image.mime, src: image.src } }
			: null;
		return attachSidecar(await saveSession(), sidecar, $project.reportMeta ?? null, $project.hidden ?? null, $project.plotSettings ?? null);
	}

	function downloadText(filename: string, content: string) {
		const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	/** Load a project file; true once it is the open project. */
	async function openProjectFile(file: File): Promise<boolean> {
		// Extract project name from filename (remove .guv extension)
		const projectName = file.name.replace(/\.guv$/i, '');

		isLoadingFile = true;
		const text = await file.text();
		let loadStarted = false;
		let loaded = false;
		try {
			// Validate JSON without keeping the parsed object - the raw text
			// is sent directly to avoid a redundant JSON.stringify round-trip
			JSON.parse(text);
			// Wait for session init to settle first: an in-flight init can otherwise
			// land after the load and overwrite it with the default room.
			await project.sessionReady();
			// Pause + mark the replay boundary BEFORE the round-trip so stale queued
			// edits from the previous project can't drain onto the loaded one.
			project.beginLoad();
			loadStarted = true;
			// Strip the app-owned block before the round-trip: the backend has no use
			// for it and it can carry megabytes of base64 image data.
			const response = await loadSession(stripSidecar(text));
			if (response.success) {
				// Update the frontend store with the loaded state (clears + resumes)
				project.loadFromApiResponse(response, projectName);
				loaded = true;
				if (summaryAfterLoad) finishEditing();
				const sidecar = extractSidecar(text);
				const loadedMeta = extractReportMeta(text);
				if (loadedMeta) project.updateReportMeta(loadedMeta);
				project.setHiddenItems(extractHidden(text));
				project.setPlotSettings(extractPlotSettings(text));
				if (sidecar) {
					project.setFloorPlan(sidecar.placement, { id: sidecar.placement.imageId, mime: sidecar.image.mime, src: sidecar.image.src });
				}
				// The plan shows the new room: no stale draft, selection or zoom
				plan.resetForNewScene();
				// Re-link embedded custom lamps to library definitions by content hash
				// (or add project-scoped ones for anything unmatched); passive toast.
				const createdCustomLamps = await project.linkLoadedCustomLamps();
				if (createdCustomLamps > 0) {
					lampLibraryNotice = `${createdCustomLamps} custom lamp${createdCustomLamps === 1 ? '' : 's'} added from file — manage in Edit → Manage Custom Lamps`;
					setTimeout(() => (lampLibraryNotice = null), 6000);
				}
			} else {
				project.abortLoad(); // load failed: pre-load session is still live
				alertDialog = { title: 'Load Failed', message: 'Failed to load file: ' + response.message };
			}
		} catch (e) {
			if (loadStarted) project.abortLoad();
			console.error('Load failed:', e);
			alertDialog = { title: 'Load Failed', message: 'Failed to load file: invalid format or server error' };
		} finally {
			isLoadingFile = false;
			summaryAfterLoad = false;
			markProjectClean();
		}
		return loaded;
	}

	async function loadFromFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		// Opened without the File System Access API: nothing to write back to
		if (await openProjectFile(file)) projectFile.forget();
		input.value = '';
	}

	// Save As without the File System Access API asks for the download's name here
	let filenamePrompt = $state<{ suggested: string; resolve: (name: string | null) => void } | null>(null);

	function askFilename(suggested: string): Promise<string | null> {
		return new Promise((resolve) => { filenamePrompt = { suggested, resolve }; });
	}

	function answerFilename(name: string | null) {
		filenamePrompt?.resolve(name);
		filenamePrompt = null;
	}

	const projectFile = createProjectFile({
		projectName: () => $project.name,
		buildContent: buildGuvContent,
		load: openProjectFile,
		rename: (name) => project.setName(name),
		markClean: markProjectClean,
		askFilename,
		openInput: () => document.getElementById('load-file')?.click(),
		download: downloadText,
	});
	const openFileName = projectFile.fileName;

	async function saveProject(saveAs = false) {
		try {
			await (saveAs ? projectFile.saveAs() : projectFile.save());
		} catch (e) {
			console.error('Save failed:', e);
			alertDialog = { title: 'Save Failed', message: 'Failed to save file. Make sure the session is initialized.' };
		}
	}

	// Opening from the landing lands on the summary of the loaded project
	let summaryAfterLoad = false;

	async function openProject(toSummary = false) {
		summaryAfterLoad = toSummary;
		try {
			await projectFile.open();
		} catch (e) {
			console.error('Open failed:', e);
			alertDialog = { title: 'Load Failed', message: 'Failed to open the file.' };
		}
	}

	function handleSaveShortcut(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
			event.preventDefault();
			saveProject(event.shiftKey);
		}
	}

	/** A new lamp with the user's default type, fixture and placement (positioned away from existing lamps). */
	function newLampFromSettings(): Omit<LampInstance, 'id'> {
		const s = $userSettings;
		const newLamp = defaultLamp($room, $lamps, s.lampPlacement, s.units);
		newLamp.name = `Lamp ${$lamps.length + 1}`;
		newLamp.lamp_type = s.lampType;
		if (s.lampType === 'krcl_222' && s.lampPreset222) {
			newLamp.preset_id = s.lampPreset222;
		} else if (s.lampType === 'lp_254' || s.lampType === 'other') {
			newLamp.preset_id = 'custom';
		}
		return newLamp;
	}

	/** Edit › Add Lamp: a lamp on the user's defaults, opened in the Lamps step. */
	function addNewLamp() {
		openStep('lamps', undefined, async () => {
			try {
				const id = await project.addLamp(newLampFromSettings());
				plan.selectLamp(id);
				await scrollRowIntoView(id);
			} catch (e) {
				console.error('Failed to add lamp:', e);
			}
		});
	}

	/** A new zone of a type with the user's default display, grid offset, calc mode and dose settings. */
	function newZoneFromSettings(zoneType: 'plane' | 'volume' | 'point'): Omit<CalcZone, 'id'> {
		const s = $userSettings;
		const typeCount = $zones.filter(z => !z.isStandard).length;
		return defaultZone($room, typeCount, {
			type: zoneType,
			display_mode: zoneType === 'volume' ? s.volumeDisplayMode : s.planeDisplayMode,
			offset: s.zoneOffset,
			calc_mode: s.zoneCalcMode,
			dose: s.zoneDose,
			hours: s.zoneHours,
			minutes: s.zoneMinutes,
			seconds: s.zoneSeconds,
		});
	}

	/** Edit › Add Zone: a zone on the user's defaults, opened in the Zones step. */
	function addNewZone() {
		openStep('zones', undefined, async () => {
			try {
				const id = await project.addZone(newZoneFromSettings($userSettings.zoneType));
				plan.selectZone(id);
				await scrollRowIntoView(id);
			} catch (e) {
				console.error('Failed to add zone:', e);
			}
		});
	}

	/** Edit › Add Obstacle: a default box, opened in Room › Structures. */
	function addNewObject() {
		openStep('room', 'structures', async () => {
			try {
				const id = await planActions.addObstacle(defaultObject($room, $userSettings.units));
				plan.selectObstacle(id);
				await scrollRowIntoView(id);
			} catch (e) {
				console.error('Failed to add structure:', e);
			}
		});
	}

	// Undo/redo shortcuts. A drawing in progress gets the first look (Ctrl+Z
	// removes its last corner); text fields keep the browser's own text undo.
	function onGlobalKeydown(event: KeyboardEvent) {
		handleSaveShortcut(event);
		// Escape cancels the plan's gesture or selection, unless a dialog is open
		// (the dialog takes that Escape), a 3D pick is in progress (it cancels the
		// pick) or the key is typed into a field.
		if (event.key === 'Escape' && !event.defaultPrevented && $workspaceUi.mode === 'editor' && !$pickMode
			&& !isTypingTarget(event.target) && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
			plan.onEscapeKey();
		}
		const action = undoKeyOf(event);
		if (!action || event.defaultPrevented) return;
		if (interceptUndo(action)) {
			event.preventDefault();
			return;
		}
		if (inTextField(event)) return;
		event.preventDefault();
		if (action === 'undo') project.history.undo();
		else project.history.redo();
	}
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<svelte:head>
	{#if $openFileName}
		<title>{$openFileName} - Illuminate</title>
	{/if}
</svelte:head>

<div class="app-container">
	<!-- Hidden file input for load functionality -->
	<input
		id="load-file"
		type="file"
		accept=".guv"
		onchange={loadFromFile}
		style="display: none;"
	/>

	<!-- Menu Bar -->
	<MenuBar
		{isMobile}
		projectName={$project.name}
		onRenameProject={(name) => project.setName(name)}
		onNewProject={startFresh}
		onSave={() => saveProject()}
		onSaveAs={() => saveProject(true)}
		onLoad={() => openProject()}
		onAddLamp={addNewLamp}
		onAddZone={addNewZone}
		onAddObject={addNewObject}
		onShowReflectanceSettings={() => openOrRestore('Reflectance Settings', () => showReflectanceSettings = true)}
		onShowLampManager={() => { lampManagerInitialType = null; lampManagerTargetLampId = null; lampManagerEditDefId = null; if (!restoreById('lamp-manager')) showLampManager = true; }}
		onShowSettings={() => openOrRestore('Default Settings', () => showSettingsModal = true)}
		onShowAudit={() => openOrRestore('Design Audit', () => showAuditModal = true)}
		onShowExploreData={() => openOrRestore('Explore Pathogen Efficacy Data', () => showExploreDataModal = true)}
		onShowSpectrumViewer={() => openOrRestore('Spectrum Viewer', () => showSpectrumViewer = true)}
		onShowExport={() => openOrRestore('Export', () => showExportModal = true)}
		onShowHelp={() => openOrRestore('Help', () => showHelpModal = true)}
		onShowGettingStarted={() => showStartChooser = true}
		onShowCite={() => openOrRestore('How To Cite', () => showCiteModal = true)}
		onShowAbout={() => openOrRestore('About Illuminate', () => showAboutModal = true)}
		showDimensions={$room.showDimensions ?? true}
		onToggleShowDimensions={() => { const v = !($room.showDimensions ?? true); project.updateRoom({ showDimensions: v }); userSettings.update(s => ({ ...s, showDimensions: v })); }}
		showPhotometricWebs={$room.showPhotometricWebs ?? true}
		showGrid={$room.showGrid ?? true}
		showXYZMarker={$room.showXYZMarker ?? true}
		showLampLabels={$room.showLampLabels ?? false}
			showCalcPointLabels={$room.showCalcPointLabels ?? false}
		colormap={$room.colormap}
		precision={$room.precision}
		onToggleShowPhotometricWebs={() => { const v = !($room.showPhotometricWebs ?? true); project.updateRoom({ showPhotometricWebs: v }); userSettings.update(s => ({ ...s, showPhotometricWebs: v })); for (const lamp of $lamps) { project.updateLamp(lamp.id, { show_photometric_web: v }); } }}
		onToggleShowGrid={() => { const v = !($room.showGrid ?? true); project.updateRoom({ showGrid: v }); userSettings.update(s => ({ ...s, showGrid: v })); }}
		showFloorPlanImage={$room.showFloorPlanImage ?? true}
		hasFloorPlanImage={!!$room.floorplan && $floorplanImage?.id === $room.floorplan.imageId}
		onToggleShowFloorPlanImage={() => { const v = !($room.showFloorPlanImage ?? true); project.updateRoom({ showFloorPlanImage: v }); userSettings.update(s => ({ ...s, showFloorPlanImage: v })); }}
		onToggleShowXYZMarker={() => { const v = !($room.showXYZMarker ?? true); project.updateRoom({ showXYZMarker: v }); userSettings.update(s => ({ ...s, showXYZMarker: v })); }}
		onToggleShowLampLabels={() => { const v = !($room.showLampLabels ?? false); project.updateRoom({ showLampLabels: v }); userSettings.update(s => ({ ...s, showLampLabels: v })); for (const lamp of $lamps) { project.updateLamp(lamp.id, { show_label: v }); } }}
			onToggleShowCalcPointLabels={() => { const v = !($room.showCalcPointLabels ?? false); project.updateRoom({ showCalcPointLabels: v }); userSettings.update(s => ({ ...s, showCalcPointLabels: v })); for (const z of $zones.filter(z => z.type === 'point')) { project.updateZone(z.id, { show_label: v }); } }}
		onSetColormap={(cm) => { project.updateRoom({ colormap: cm }); userSettings.update(s => ({ ...s, colormap: cm })); }}
		onSetPrecision={(p) => { project.updateRoom({ precision: p }); userSettings.update(s => ({ ...s, precision: p })); }}
		globalHeatmapNormalization={$room.globalHeatmapNormalization ?? false}
		onToggleGlobalHeatmapNormalization={() => { const v = !($room.globalHeatmapNormalization ?? false); project.updateRoom({ globalHeatmapNormalization: v }); userSettings.update(s => ({ ...s, globalHeatmapNormalization: v })); }}
		currentZoneDisplayMode={commonZoneDisplayMode}
		onSetAllZonesDisplayMode={(mode: ZoneDisplayMode) => {
			for (const z of $zones) {
				project.updateZone(z.id, { display_mode: mode });
			}
		}}
		onOpenSettingsDisplay={() => { settingsInitialTab = 'display'; openOrRestore('Default Settings', () => { settingsInitialTab = 'display'; showSettingsModal = true; }); }}
		workspaceLayout={$userSettings.workspaceLayout}
		onSetWorkspaceLayout={setWorkspaceLayout}
		onSwapViews={swapViews}
	/>

	{#snippet editorColumn()}
		{#if $workspaceUi.mode === 'summary'}
			<div class="summary-host">
				<SummaryPanel scene={planScene} actions={planActions} onEdit={editFromSummary} onHover={plan.hoverItem} />
			</div>
		{:else}
			<div class="editor-host">
				<EditorPanel
					controller={plan}
					onDone={finishEditing}
					onShowReflectanceSettings={() => openOrRestore('Reflectance Settings', () => showReflectanceSettings = true)}
					onAddCustomLamp={() => openLampManagerFor('krcl_222', '')}
					lampPanel={planLampPanel}
					zonePanel={planZonePanel}
					objectPanel={planObjectPanel}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet view2d()}
		<div class="plan-host">
			<PlanPane controller={plan} readonly={$workspaceUi.mode === 'summary'} handleEscape={false} />
		</div>
	{/snippet}

	{#snippet view3d()}
		<div class="viewer-host">
			<RoomViewer room={$room} lamps={$lamps} zones={$zones} objects={$objects} zoneResults={$results?.zones} {selectedLampIds} {selectedZoneIds} {selectedObjectIds} {highlightedLampIds} {highlightedZoneIds} {highlightedObjectIds} {visibleLampIds} {visibleZoneIds} {visibleObjectIds} onLampClick={handleLampClick} onZoneClick={handleZoneClick} onObjectClick={handleObjectClick} globalValueRange={($room.globalHeatmapNormalization ?? false) ? globalValueRange : null} {isoScaleMap} onIsoGeometryReady={handleIsoGeometryReady} onCaptureApiReady={(api) => captureApi = api} />
		</div>
	{/snippet}

	{#snippet calculateSlot()}
		{#if !isMobile}<CalculateButton />{/if}
	{/snippet}

	{#snippet viewsPane()}
		<ViewsPane
			layout={$userSettings.workspaceLayout}
			swap={$userSettings.workspaceSwap}
			split={$userSettings.workspaceSplit}
			inset={$userSettings.workspaceInset}
			insetHidden={$userSettings.workspaceInsetHidden}
			onChange={onViewsChange}
			{view2d}
			{view3d}
			calculate={calculateSlot}
		/>
	{/snippet}

	{#snippet resultsContent()}
		<ZoneStatsPanel onShowAudit={() => openOrRestore('Design Audit', () => showAuditModal = true)} onOpenReport={() => openOrRestore('Generate report', () => showReportModal = true)} onLampHover={(id) => hoveredLampId = id} onOpenAdvancedSettings={(id) => { if (!restoreByTitle('Advanced Lamp Settings')) advancedSettingsLampId = id; }} onSelectSpecies={() => { settingsInitialTab = 'results'; openOrRestore('Settings', () => { settingsInitialTab = 'results'; showSettingsModal = true; }); }} {isoGeometryMap} />
	{/snippet}

	<!-- Main Layout -->
	{#if isMobile}
		<div class="app-layout mobile">
			<!-- Configure panel -->
			<div class="mobile-panel" class:active={activeMobileTab === 'configure'}>
				<div class="mobile-panel-scroll" class:editor={$workspaceUi.mode === 'editor'}>
					{@render editorColumn()}
				</div>
			</div>

			<!-- Views - always mounted -->
			<main class="main-content" class:mobile-hidden={activeMobileTab !== 'viewer'}>
				<div class="viewer-wrapper">
					{@render viewsPane()}
				</div>
			</main>

			<!-- Results panel -->
			<div class="mobile-panel" class:active={activeMobileTab === 'results'}>
				<div class="mobile-panel-scroll">
					{@render resultsContent()}
				</div>
			</div>

			<!-- Mobile calculate bar (hidden on results tab) -->
			{#if activeMobileTab !== 'results'}
				<div class="mobile-calculate-bar">
					<CalculateButton onCalculated={() => { activeMobileTab = 'results'; }} />
				</div>
			{/if}

			<!-- Mobile tab bar -->
			<nav class="mobile-tab-bar">
				<button class="mobile-tab" class:active={activeMobileTab === 'configure'} onclick={() => activeMobileTab = 'configure'}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="3"/>
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
					</svg>
					<span>Configure</span>
				</button>
				<button class="mobile-tab" class:active={activeMobileTab === 'viewer'} onclick={() => activeMobileTab = 'viewer'}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
						<polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
						<line x1="12" y1="22.08" x2="12" y2="12"/>
					</svg>
					<span>Viewer</span>
				</button>
				<button class="mobile-tab" class:active={activeMobileTab === 'results'} onclick={() => activeMobileTab = 'results'}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="18" y1="20" x2="18" y2="10"/>
						<line x1="12" y1="20" x2="12" y2="4"/>
						<line x1="6" y1="20" x2="6" y2="14"/>
					</svg>
					<span>Results</span>
				</button>
			</nav>
		</div>
	{:else}
		<div class="app-layout">
			<ResizablePanel side="left" defaultWidth={420} minWidth={320} maxWidth={550} bind:collapsed={leftPanelCollapsed}>
				{@render editorColumn()}
			</ResizablePanel>

			<main class="main-content">
				<div class="viewer-wrapper">
					{@render viewsPane()}
				</div>
			</main>

			<ResizablePanel side="right" defaultWidth={$results ? 420 : 300} minWidth={260} maxWidth={600} bind:collapsed={rightPanelCollapsed}>
				{@render resultsContent()}
			</ResizablePanel>
		</div>
	{/if}

	<!-- Modal Dock (above status bar) -->
	<ModalDock />

	<!-- Status Bar -->
	<StatusBar {appVersion} {guvCalcsVersion} />
</div>

{#if showHelpModal}
	<HelpModal onClose={() => showHelpModal = false} />
{/if}
{#if showStartChooser}
	<StartChooserModal busy={startChooserBusy} onChoose={handleStartChoice} onClose={() => { if (!startChooserBusy) showStartChooser = false; }} />
{/if}

{#if showAboutModal}
	<AboutModal onClose={() => showAboutModal = false} />
{/if}

{#if showCiteModal}
	<CiteModal onClose={() => showCiteModal = false} {guvCalcsVersion} />
{/if}

{#snippet planZonePanel(zone: CalcZone, close: () => void)}
	<!-- Standard zones open read-only, as in the old sidebar -->
	<ZoneEditor {zone} room={$room} onClose={close} isStandard={!!zone.isStandard} onCopy={(id) => { plan.selectZone(id); scrollRowIntoView(id); }} />
{/snippet}

{#snippet planObjectPanel(object: SceneObject, close: () => void)}
	<ObjectEditor {object} room={$room} onClose={close} onCopy={(id) => { plan.selectObstacle(id); scrollRowIntoView(id); }} />
{/snippet}

{#snippet planLampPanel(lamp: LampInstance, close: () => void)}
	<LampEditor {lamp} room={$room} onClose={close} onCopy={(id) => { plan.selectLamp(id); scrollRowIntoView(id); }} onOpenLampManager={openLampManagerFor} />
{/snippet}

{#if showReflectanceSettings}
	<ReflectanceSettingsModal onClose={() => showReflectanceSettings = false} />
{/if}

{#if showLampManager}
	<LampManagerModal
		initialLampType={lampManagerInitialType ?? undefined}
		initialEditDefId={lampManagerEditDefId ?? undefined}
		onClose={() => { showLampManager = false; lampManagerTargetLampId = null; lampManagerEditDefId = null; }}
		onCreated={(defId) => { if (lampManagerTargetLampId) project.applyCustomLamp(lampManagerTargetLampId, defId); }}
	/>
{/if}

{#if showSettingsModal}
	<SettingsModal initialTab={settingsInitialTab} defaultSpeciesWavelength={settingsInitialTab === 'results' ? singleLampWavelength : undefined} onClose={() => { showSettingsModal = false; settingsInitialTab = 'room'; }} />
{/if}

{#if showAuditModal}
	<AuditModal onClose={() => showAuditModal = false} onOpenAdvancedSettings={(id) => { if (!restoreByTitle('Advanced Lamp Settings')) advancedSettingsLampId = id; }} />
{/if}

{#if advancedSettingsLampId}
	<AdvancedLampSettingsModal
		initialLampId={advancedSettingsLampId}
		initialTab="scaling"
		room={$room}
		onClose={() => advancedSettingsLampId = null}
		onUpdate={(updatedSettings) => {
			if (updatedSettings && advancedSettingsLampId) {
				project.updateLampFromAdvanced(advancedSettingsLampId, {
					scaling_factor: updatedSettings.scaling_factor,
					source_width: updatedSettings.source_width ?? undefined,
					source_length: updatedSettings.source_length ?? undefined,
					source_density: updatedSettings.source_density,
					photometric_axis: updatedSettings.photometric_axis,
					photometric_depth: undefined,
					mount_face: updatedSettings.mount_face,
					housing_roll: updatedSettings.housing_roll,
					emitter_offset: updatedSettings.emitter_offset,
				});
			}
			fetchStateHashesDebounced();
		}}
	/>
{/if}

{#if showExploreDataModal}
	<ExploreDataModal
		fluence={exploreDefaultFluence}
		wavelength={singleLampWavelength}
		room={$room}
		airChanges={$room.air_changes || ROOM_DEFAULTS.air_changes}
		onclose={() => showExploreDataModal = false}
		zoneOptions={exploreZoneOptions}
	/>
{/if}

<SpectrumViewerModal show={showSpectrumViewer} onClose={() => showSpectrumViewer = false} />

{#if showExportModal}
	<ExportModal onClose={() => showExportModal = false} onOpenPdfReport={() => { showExportModal = false; openOrRestore('Generate report', () => showReportModal = true); }} />
{/if}
{#if showReportModal}
	<ReportModal onClose={() => showReportModal = false} {captureApi} />
{/if}

<SyncErrorToast />

{#if lampLibraryNotice}
	<div class="lamp-library-toast">{lampLibraryNotice}</div>
{/if}

{#if showNewProjectConfirm}
	<ConfirmDialog
		title="New Project"
		message="Start a new project? This will clear all current lamps, zones, and results."
		confirmLabel="New Project"
		variant="success"
		onConfirm={startNewProject}
		onCancel={() => showNewProjectConfirm = false}
	/>
{/if}

{#if isLoadingFile}
	<div class="loading-overlay">
		<div class="loading-content">
			<div class="loading-spinner"></div>
			<p>Loading project...</p>
		</div>
	</div>
{/if}

{#if alertDialog}
	<AlertDialog
		title={alertDialog.title}
		message={alertDialog.message}
		onDismiss={() => alertDialog = null}
	/>
{/if}

{#if filenamePrompt}
	<FilenameDialog
		suggested={filenamePrompt.suggested}
		onSave={(name) => answerFilename(name)}
		onCancel={() => answerFilename(null)}
	/>
{/if}


<style>
	.app-container {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		overflow: hidden;
	}

	.app-layout {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.viewer-wrapper {
		flex: 1;
		min-height: 0;
		border-radius: var(--radius-lg);
		overflow: hidden;
		position: relative;
		/* Touch gestures here orbit the 3D view, never scroll or zoom the page.
		   OrbitControls sets this on its own element, but drops it back to auto
		   when a projection switch remounts the controls, and the overlay buttons
		   sit outside that element anyway. */
		touch-action: none;
		overscroll-behavior: contain;
	}

	.app-layout.mobile .viewer-wrapper {
		border-radius: 0;
	}

	.mobile-calculate-bar {
		flex-shrink: 0;
		display: flex;
		justify-content: center;
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-secondary);
		border-top: 1px solid var(--color-border);
	}

	.mobile-calculate-bar :global(.calculate-wrapper) {
		width: 100%;
	}

	.mobile-calculate-bar :global(.calculate-row) {
		width: 100%;
	}

	.mobile-calculate-bar :global(.calculate-btn) {
		flex: 1;
		min-width: 0;
	}

	.main-content {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-height: 0;
	}

	/* The editor fills the left column edge to edge and scrolls inside itself */
	.editor-host {
		margin: calc(-1 * var(--spacing-md));
		height: calc(100% + 2 * var(--spacing-md));
	}

	/* The 2D view fills its slot */
	.plan-host {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	/* The 3D view fills its slot, however small the layout makes it */
	.viewer-host {
		position: absolute;
		inset: 0;
	}

	.viewer-host :global(.viewer-container) {
		min-height: 0;
	}

	/* --- Mobile layout --- */
	.app-layout.mobile {
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.mobile-panel {
		display: none;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		background: var(--color-bg);
		z-index: 10;
	}

	.mobile-panel.active {
		display: flex;
	}

	.mobile-panel-scroll {
		flex: 1;
		overflow-y: auto;
		padding: var(--spacing-md);
		-webkit-overflow-scrolling: touch;
	}

	.mobile-panel-scroll.editor {
		display: flex;
		flex-direction: column;
		padding: 0;
		overflow: hidden;
	}

	.mobile-panel-scroll.editor .editor-host {
		flex: 1;
		min-height: 0;
		margin: 0;
		height: auto;
	}

	.app-layout.mobile > .main-content {
		flex: 1;
		min-height: 0;
		z-index: 1;
	}

	.app-layout.mobile > .main-content.mobile-hidden {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
		visibility: hidden;
	}

	.mobile-tab-bar {
		flex-shrink: 0;
		height: calc(56px + env(safe-area-inset-bottom, 0px));
		padding-bottom: env(safe-area-inset-bottom, 0px);
		display: flex;
		align-items: stretch;
		background: var(--color-bg-secondary);
		border-top: 1px solid var(--color-border);
		z-index: 100;
	}

	.mobile-tab {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		background: none;
		border: none;
		border-radius: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		padding: var(--spacing-xs) 0;
		cursor: pointer;
		transition: color 0.15s;
	}

	.mobile-tab:hover {
		background: none;
		color: var(--color-text);
	}

	.mobile-tab.active {
		color: var(--color-accent);
		background: none;
	}

	.mobile-tab svg {
		display: block;
	}

	.loading-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(2px);
	}

	.loading-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 2rem 3rem;
		border-radius: 12px;
		background: var(--bg-primary, #1a1a2e);
		color: var(--text-primary, #e0e0e0);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		font-size: 1rem;
	}

	.loading-spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--accent-primary, #60a5fa);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	/* Passive toast for post-load custom-lamp re-linking, styled after
	   SyncErrorToast's container (same fixed positioning) with neutral/info
	   colors since this is informational, not an error. */
	.lamp-library-toast {
		position: fixed;
		/* Sit above SyncErrorToast (bottom: 20px) so the two stack instead of overlap. */
		bottom: 70px;
		right: 20px;
		z-index: 9999;
		max-width: 400px;
		padding: 12px 16px;
		border-radius: var(--radius-md);
		background: var(--color-info-bg, #1f2a2d);
		border: 1px solid var(--color-info, #17a2b8);
		color: var(--color-info-text, #d1ecf1);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		font-size: 0.875rem;
		animation: slideIn 0.2s ease-out;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@keyframes slideIn {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
</style>
