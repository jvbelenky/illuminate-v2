<script lang="ts">
	import { project, room, lamps, zones, objects, results, syncErrors, fetchStateHashesDebounced, wasRestoredFromStorage, needsCalculation, lampHasPhotometry } from '$lib/stores/project';
	import { calculationStatus } from '$lib/stores/calculationStatus';
	import { refreshPositionWarnings } from '$lib/stores/audit';
	import SidebarStep from '$lib/components/SidebarStep.svelte';
	import ReflectanceStep from '$lib/components/ReflectanceStep.svelte';
	import StartChooserModal, { type StartChoice } from '$lib/components/StartChooserModal.svelte';
	import { unitAbbrev } from '$lib/utils/unitConversion';
	import { displayDimension } from '$lib/utils/formatting';
	import { isPolygonRoom, roomVertices } from '$lib/utils/roomGeometry';
	import { objectHeightText } from '$lib/utils/objectHeight';
	import { onMount, onDestroy, tick } from 'svelte';
	import RoomViewer from '$lib/components/RoomViewer.svelte';
	import RoomEditor from '$lib/components/RoomEditor.svelte';
	import LampEditor from '$lib/components/LampEditor.svelte';
	import ZoneEditor from '$lib/components/ZoneEditor.svelte';
	import ObjectEditor from '$lib/components/ObjectEditor.svelte';
	import FootprintModal, { type FootprintApplyResult } from '$lib/components/FootprintModal.svelte';
	import CalcTypeIllustration from '$lib/components/CalcTypeIllustration.svelte';
	import CalculateButton from '$lib/components/CalculateButton.svelte';
	import ZoneStatsPanel from '$lib/components/ZoneStatsPanel.svelte';
	import ResizablePanel from '$lib/components/ResizablePanel.svelte';
	import HelpModal from '$lib/components/HelpModal.svelte';
	import AboutModal from '$lib/components/AboutModal.svelte';
	import CiteModal from '$lib/components/CiteModal.svelte';
	import ReflectanceSettingsModal from '$lib/components/ReflectanceSettingsModal.svelte';
	import AuditModal from '$lib/components/AuditModal.svelte';
	import AdvancedLampSettingsModal from '$lib/components/AdvancedLampSettingsModal.svelte';
	import type { AdvancedLampSettingsResponse } from '$lib/api/client';
	import ExploreDataModal from '$lib/components/ExploreDataModal.svelte';
	import SpectrumViewerModal from '$lib/components/SpectrumViewerModal.svelte';
	import ExportModal from '$lib/components/ExportModal.svelte';
	import SyncErrorToast from '$lib/components/SyncErrorToast.svelte';
	import ModalDock from '$lib/components/ModalDock.svelte';
	import { restoreByTitle } from '$lib/stores/modalDock.svelte';
	import MenuBar from '$lib/components/MenuBar.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import { getVersion, saveSession, loadSession, getLampOptionsCached, placeSessionLamp } from '$lib/api/client';
	import { attachSidecar, extractSidecar, stripSidecar } from '$lib/utils/floorplanSidecar';
	import { floorplanImage } from '$lib/stores/floorplanImage';
	import type { LampInstance, CalcZone, ZoneDisplayMode, SceneObject } from '$lib/types/project';
	import { defaultLamp, defaultZone, defaultObject, ROOM_DEFAULTS } from '$lib/types/project';
	import { userSettings } from '$lib/stores/settings';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import type { IsoSettings, IsoSettingsInput } from '$lib/components/CalcVolPlotModal.svelte';
	import type { IsosurfaceData } from '$lib/utils/isosurface';
	import { isoColorHex } from '$lib/utils/colormaps';
	import { performCalculation } from '$lib/utils/calculate';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import LampManagerModal from '$lib/components/LampManagerModal.svelte';
	import { lampLibrary } from '$lib/stores/lampLibrary';
	import type { CustomLampType } from '$lib/types/lampLibrary';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';

	// Lamp display names - fetched from API on mount
	let lampDisplayNames = $state<Record<string, string>>({});

	function getLampDisplayId(lamp: LampInstance): string {
		if (lamp.preset_id && lamp.preset_id !== 'custom') {
			return lampDisplayNames[lamp.preset_id] || lamp.preset_id;
		}
		if (lamp.ies_filename) {
			return lamp.ies_filename.endsWith('.ies') ? lamp.ies_filename : `${lamp.ies_filename}.ies`;
		}
		return 'Custom';
	}

	let showHelpModal = $state(false);
	let showAboutModal = $state(false);
	let showCiteModal = $state(false);
	let showReflectanceSettings = $state(false);
	let showAuditModal = $state(false);
	let advancedSettingsLampId = $state<string | null>(null);
	let showExploreDataModal = $state(false);
	let showSpectrumViewer = $state(false);
	let showExportModal = $state(false);
	let showSettingsModal = $state(false);
	let showLampManager = $state(false);
	let showStartChooser = $state(false);
	let roomPlanOpen = $state(false);
	let startChooserBusy = $state(false);
	let lampManagerInitialType = $state<CustomLampType | null>(null);
	// The lamp that launched the manager via 'Add custom lamp...', if any. A
	// definition created in that session is auto-applied to this lamp.
	let lampManagerTargetLampId = $state<string | null>(null);
	let settingsInitialTab = $state<'room' | 'lamps' | 'zones' | 'results' | 'display'>('room');

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
	let editingLamps = $state<Record<string, boolean>>({});
	let editingZones = $state<Record<string, boolean>>({});
	let editingObjects = $state<Record<string, boolean>>({});
	let leftPanelCollapsed = $state(false);
	let rightPanelCollapsed = $state(false); // Open so the empty state tells the user where results will land
	let hasEverCalculated = $state(false);
	let editingLampName: string | null = $state(null); // ID of lamp being renamed
	let editingZoneName: string | null = $state(null); // ID of zone being renamed
	let editingObjectName: string | null = $state(null); // ID of object being renamed

	// Mobile responsive state
	let isMobile = $state(false);
	type MobileTab = 'configure' | 'viewer' | 'results';
	let activeMobileTab = $state<MobileTab>('viewer');

	function checkMobile() {
		isMobile = window.innerWidth < 768;
	}

	// Dialog state
	let showNewProjectConfirm = $state(false);
	let pendingDelete = $state<{ type: 'lamp' | 'zone' | 'object'; id: string; name: string } | null>(null);
	let alertDialog = $state<{ title: string; message: string } | null>(null);
	let isLoadingFile = $state(false);
	let lampLibraryNotice = $state<string | null>(null);

	// Sidebar layout: guided (next-step card, numbered steps, room and zones
	// collapsed) or expert (flat, everything open).
	const guidedLayout = $derived($userSettings.sidebarLayout !== 'expert');
	let roomOpen = $state(true);
	let objectsOpen = $state(false);
	let reflOpen = $state(false);
	let lampsOpen = $state(true);
	let zonesOpen = $state(false);

	// Step summaries and statuses for the collapsed rows.
	const roomSummary = $derived.by(() => {
		const r = $room;
		const u = unitAbbrev($userSettings.units);
		const shape = isPolygonRoom(r) ? `${roomVertices(r).length}-wall polygon` : 'rectangle';
		return `${displayDimension(r.x, r.precision)} × ${displayDimension(r.y, r.precision)} × ${displayDimension(r.z, r.precision)} ${u} ${shape}`;
	});
	const lampsNeedingModel = $derived($lamps.filter(l => l.enabled !== false && !lampHasPhotometry(l)).length);
	const lampsSummary = $derived.by(() => {
		const n = $lamps.length;
		if (n === 0) return undefined;
		const base = n === 1 ? (getLampDisplayId($lamps[0]) === 'Custom' && !$lamps[0].has_ies_file ? '1 lamp' : `1 lamp, ${getLampDisplayId($lamps[0])}`) : `${n} lamps`;
		return lampsNeedingModel > 0 ? `${base}, ${lampsNeedingModel} without a model` : base;
	});
	const lampsStatus = $derived<'done' | 'attention' | 'idle'>($lamps.length === 0 || lampsNeedingModel > 0 ? 'attention' : 'done');
	const objectsSummary = $derived.by(() => {
		const n = $objects.length;
		return n === 0 ? undefined : n === 1 ? '1 obstacle' : `${n} obstacles`;
	});
	const reflSummary = $derived($room.enable_reflectance ? 'Reflections on' : undefined);
	const zonesSummary = $derived.by(() => {
		const custom = $zones.filter(z => !z.isStandard).length;
		return custom === 0 ? undefined : custom === 1 ? '1 custom zone' : `${custom} custom zones`;
	});

	// Position warnings only surface in the next-step card once results exist,
	// so refresh them after each calculation rather than after every edit
	// (the audit modal refreshes on open as well).
	$effect(() => {
		if (!$results?.calculatedAt) return;
		refreshPositionWarnings();
	});


	// Separate standard zones from custom zones
	const standardZonesList = $derived($zones.filter(z => z.isStandard));
	const customZonesList = $derived($zones.filter(z => !z.isStandard));

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
	const exploreZoneOptions = $derived.by(() => {
		if (!$results?.zones) return [];
		return $zones
			.filter(z => {
				if (z.enabled === false) return false;
				if (z.dose) return false;
				const result = $results!.zones[z.id];
				return result?.statistics?.mean != null;
			})
			.map(z => ({
				id: z.id,
				name: z.name || z.id,
				meanFluence: $results!.zones[z.id].statistics.mean!,
				zoneType: z.type
			}));
	});
	const exploreDefaultFluence = $derived($results?.zones?.['WholeRoomFluence']?.statistics?.mean);

	// Selected IDs for 3D highlighting
	const selectedLampIds = $derived(
		Object.entries(editingLamps).filter(([_, v]) => v).map(([k]) => k)
	);
	const selectedZoneIds = $derived(
		Object.entries(editingZones).filter(([_, v]) => v).map(([k]) => k)
	);
	const selectedObjectIds = $derived(
		Object.entries(editingObjects).filter(([_, v]) => v).map(([k]) => k)
	);

	// Hover state for 3D highlight on mouseover in config panel
	let hoveredLampId = $state<string | null>(null);
	let hoveredZoneId = $state<string | null>(null);
	let hoveredObjectId = $state<string | null>(null);
	const highlightedLampIds = $derived(hoveredLampId ? [hoveredLampId] : []);
	const highlightedZoneIds = $derived(hoveredZoneId ? [hoveredZoneId] : []);
	const highlightedObjectIds = $derived(hoveredObjectId ? [hoveredObjectId] : []);

	// Iso settings per zone (shared between modal, scene, and editor)
	let isoSettingsMap = $state<Record<string, IsoSettings>>({});

	/** Build resolvedColors from customColors + colormap defaults. Single source of truth. */
	function resolveIsoColors(settings: IsoSettingsInput): string[] {
		const colormap = $room.colormap || 'plasma';
		const count = settings.surfaceCount;
		return Array.from({ length: count }, (_, i) =>
			settings.customColors?.[i] ?? isoColorHex(i, count, colormap)
		);
	}

	/** Update iso settings for a zone, always recomputing resolvedColors. */
	function updateIsoSettings(zoneId: string, settings: IsoSettingsInput) {
		isoSettingsMap = {
			...isoSettingsMap,
			[zoneId]: { ...settings, resolvedColors: resolveIsoColors(settings) }
		};
	}

	// Seed iso settings for volume zones when calculation results arrive
	$effect(() => {
		if (!$results?.zones) return;
		for (const zone of $zones) {
			if (zone.type !== 'volume' || zone.enabled === false) continue;
			const result = $results.zones[zone.id];
			if (!result?.values) continue;
			const existing = isoSettingsMap[zone.id];
			// Skip if all levels are already user-set (no nulls, non-null array)
			const hasAutoSlots = !existing?.customLevels || existing.customLevels.some((l: number | null) => l == null);
			if (existing && existing.customLevels !== null && !hasAutoSlots) continue;
			const surfaceCount = existing?.surfaceCount ?? 3;
			const defaultLevels = [0.01, 0.1, 1];
			// Merge: preserve user-set levels, fill auto (null) slots with defaults
			const mergedLevels = defaultLevels.map((defLevel: number, i: number) => {
				const userLevel = existing?.customLevels?.[i];
				return (userLevel != null) ? userLevel : defLevel;
			});
			updateIsoSettings(zone.id, {
				surfaceCount,
				customLevels: mergedLevels,
				customColors: existing?.customColors ?? []
			});
		}
	});

	// Recompute resolved colors when colormap changes
	$effect(() => {
		const colormap = $room.colormap; // subscribe to colormap changes
		for (const [zoneId, settings] of Object.entries(isoSettingsMap)) {
			const newColors = resolveIsoColors(settings);
			if (newColors.some((c, i) => c !== settings.resolvedColors[i])) {
				isoSettingsMap = {
					...isoSettingsMap,
					[zoneId]: { ...settings, resolvedColors: newColors }
				};
			}
		}
	});

	// Pre-built isosurface geometries per zone, reported by CalcVol3D.
	// The modal reuses these instead of re-running marching cubes.
	let isoGeometryMap = $state<Record<string, { isosurfaces: IsosurfaceData[]; valueRange: { min: number; max: number; range: number } }>>({});

	function handleIsoGeometryReady(zoneId: string, data: { isosurfaces: IsosurfaceData[]; valueRange: { min: number; max: number; range: number } }) {
		isoGeometryMap = { ...isoGeometryMap, [zoneId]: data };
	}

	// Layer visibility state (lifted from DisplayControlOverlay)
	let lampsLayerVisible = $state(true);
	let zonesLayerVisible = $state(true);
	let objectsLayerVisible = $state(true);
	let lampVisibility = $state<Record<string, boolean>>({});
	let zoneVisibility = $state<Record<string, boolean>>({});
	let objectVisibility = $state<Record<string, boolean>>({});

	// Initialize visibility for new items (default to visible)
	$effect(() => {
		const newLampVis = { ...lampVisibility };
		let changed = false;
		for (const lamp of $lamps) {
			if (!(lamp.id in newLampVis)) {
				newLampVis[lamp.id] = true;
				changed = true;
			}
		}
		if (changed) lampVisibility = newLampVis;
	});

	$effect(() => {
		const newZoneVis = { ...zoneVisibility };
		let changed = false;
		for (const zone of $zones) {
			if (!(zone.id in newZoneVis)) {
				newZoneVis[zone.id] = true;
				changed = true;
			}
		}
		if (changed) zoneVisibility = newZoneVis;
	});

	$effect(() => {
		const newObjectVis = { ...objectVisibility };
		let changed = false;
		for (const obj of $objects) {
			if (!(obj.id in newObjectVis)) {
				newObjectVis[obj.id] = true;
				changed = true;
			}
		}
		if (changed) objectVisibility = newObjectVis;
	});

	// Compute visible IDs based on layer and individual visibility
	const visibleLampIds = $derived(
		lampsLayerVisible
			? $lamps.filter(l => lampVisibility[l.id] !== false).map(l => l.id)
			: []
	);

	const visibleZoneIds = $derived(
		zonesLayerVisible
			? $zones.filter(z => zoneVisibility[z.id] !== false).map(z => z.id)
			: []
	);

	function toggleLampVisibility(lampId: string) {
		lampVisibility = { ...lampVisibility, [lampId]: !lampVisibility[lampId] };
	}

	function toggleZoneVisibility(zoneId: string) {
		zoneVisibility = { ...zoneVisibility, [zoneId]: !zoneVisibility[zoneId] };
	}

	const visibleObjectIds = $derived(
		objectsLayerVisible
			? $objects.filter(o => objectVisibility[o.id] !== false).map(o => o.id)
			: []
	);

	function toggleObjectVisibility(objectId: string) {
		objectVisibility = { ...objectVisibility, [objectId]: !objectVisibility[objectId] };
	}

	function closeAllEditors() {
		editingLamps = {};
		editingZones = {};
		editingObjects = {};
	}

	function toggleLampEditor(lampId: string) {
		const wasOpen = editingLamps[lampId];
		if (wasOpen) {
			editingLamps = { ...editingLamps, [lampId]: false };
			if (sceneSelection?.type === 'lamp' && sceneSelection.id === lampId) {
				sceneSelection = null;
			}
		} else {
			closeAllEditors();
			editingLamps = { [lampId]: true };
		}
	}

	function closeLampEditor(lampId: string) {
		editingLamps = { ...editingLamps, [lampId]: false };
		if (sceneSelection?.type === 'lamp' && sceneSelection.id === lampId) {
			sceneSelection = null;
		}
	}

	function startLampRename(lampId: string) {
		editingLampName = lampId;
		// Ensure the lamp editor is expanded (don't collapse if already expanded)
		if (!editingLamps[lampId]) {
			closeAllEditors();
			editingLamps = { [lampId]: true };
		}
	}

	function confirmLampRename(lampId: string, newName: string) {
		project.updateLamp(lampId, { name: newName || undefined });
		editingLampName = null;
	}

	function cancelLampRename() {
		editingLampName = null;
	}

	function handleNameKeydown(e: KeyboardEvent, lampId: string) {
		if (e.key === 'Enter') {
			confirmLampRename(lampId, (e.target as HTMLInputElement).value);
		} else if (e.key === 'Escape') {
			cancelLampRename();
		}
	}

	function autoFocus(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function toggleZoneEditor(zoneId: string) {
		const wasOpen = editingZones[zoneId];
		if (wasOpen) {
			editingZones = { ...editingZones, [zoneId]: false };
			if (sceneSelection?.type === 'zone' && sceneSelection.id === zoneId) {
				sceneSelection = null;
			}
		} else {
			closeAllEditors();
			editingZones = { [zoneId]: true };
		}
	}

	function closeZoneEditor(zoneId: string) {
		editingZones = { ...editingZones, [zoneId]: false };
		if (sceneSelection?.type === 'zone' && sceneSelection.id === zoneId) {
			sceneSelection = null;
		}
	}

	async function onLampCopied(newId: string) {
		closeAllEditors();
		editingLamps = { [newId]: true };
		await tick();
		document.querySelector(`[data-lamp-id="${newId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	async function onZoneCopied(newId: string) {
		closeAllEditors();
		editingZones = { [newId]: true };
		await tick();
		document.querySelector(`[data-zone-id="${newId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function toggleObjectEditor(objectId: string) {
		const wasOpen = editingObjects[objectId];
		if (wasOpen) {
			editingObjects = { ...editingObjects, [objectId]: false };
			if (sceneSelection?.type === 'object' && sceneSelection.id === objectId) {
				sceneSelection = null;
			}
		} else {
			closeAllEditors();
			editingObjects = { [objectId]: true };
		}
	}

	function closeObjectEditor(objectId: string) {
		editingObjects = { ...editingObjects, [objectId]: false };
		if (sceneSelection?.type === 'object' && sceneSelection.id === objectId) {
			sceneSelection = null;
		}
	}

	function startObjectRename(objectId: string) {
		editingObjectName = objectId;
		if (!editingObjects[objectId]) {
			closeAllEditors();
			editingObjects = { [objectId]: true };
		}
	}

	function confirmObjectRename(objectId: string, newName: string) {
		project.updateObject(objectId, { name: newName || undefined });
		editingObjectName = null;
	}

	function handleObjectNameKeydown(e: KeyboardEvent, objectId: string) {
		if (e.key === 'Enter') {
			confirmObjectRename(objectId, (e.target as HTMLInputElement).value);
		} else if (e.key === 'Escape') {
			editingObjectName = null;
		}
	}

	async function onObjectCopied(newId: string) {
		closeAllEditors();
		editingObjects = { [newId]: true };
		await tick();
		document.querySelector(`[data-object-id="${newId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

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

		// Only consider previous selection if its editor is still open
		const prevStillOpen = prev && (
			prev.type === 'lamp' ? editingLamps[prev.id]
			: prev.type === 'object' ? editingObjects[prev.id]
			: editingZones[prev.id]
		);

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

		// Close all editors before opening the new one
		closeAllEditors();

		if (next) {
			if (isMobile) {
				activeMobileTab = 'configure';
			} else {
				leftPanelCollapsed = false;
			}
			if (next.type === 'lamp') {
				lampsOpen = true;
				editingLamps = { [next.id]: true };
			} else if (next.type === 'object') {
				objectsOpen = true;
				editingObjects = { [next.id]: true };
			} else {
				zonesOpen = true;
				editingZones = { [next.id]: true };
			}
			await tick();
			const sel = next.type === 'lamp'
				? `[data-lamp-id="${next.id}"]`
				: next.type === 'object'
					? `[data-object-id="${next.id}"]`
					: `[data-zone-id="${next.id}"]`;
			document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	function startZoneRename(zoneId: string) {
		editingZoneName = zoneId;
		// Ensure the zone editor is expanded (don't collapse if already expanded)
		if (!editingZones[zoneId]) {
			closeAllEditors();
			editingZones = { [zoneId]: true };
		}
	}

	function confirmZoneRename(zoneId: string, newName: string) {
		project.updateZone(zoneId, { name: newName || undefined });
		editingZoneName = null;
	}

	function cancelZoneRename() {
		editingZoneName = null;
	}

	function handleZoneNameKeydown(e: KeyboardEvent, zoneId: string) {
		if (e.key === 'Enter') {
			confirmZoneRename(zoneId, (e.target as HTMLInputElement).value);
		} else if (e.key === 'Escape') {
			cancelZoneRename();
		}
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

		// Fetch lamp options for display names (non-blocking, cached)
		getLampOptionsCached().then((options) => {
			const names: Record<string, string> = {};
			for (const preset of options.presets_222nm) {
				if (preset.id !== 'custom') {
					names[preset.id] = preset.name;
				}
			}
			lampDisplayNames = names;
		}).catch((e) => {
			console.warn('Failed to fetch lamp options:', e);
		});

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
		const newLamp = defaultLamp($room, $lamps, placementMode);
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
			document.getElementById('load-file')?.click();
			return;
		}
		if (choice === 'empty') {
			// Straight into drawing the room: open step 1 and the floor-plan editor
			showStartChooser = false;
			roomOpen = true;
			if (isMobile) activeMobileTab = 'configure'; else leftPanelCollapsed = false;
			await tick();
			roomPlanOpen = true;
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

	async function saveToFile() {
		try {
			// Use Project.save() via the API to get proper .guv format
			const image = floorplanImage.get();
			const placement = $room.floorplan;
			const sidecar = image && placement && placement.imageId === image.id
				? { placement, image: { mime: image.mime, src: image.src } }
				: null;
			const guvContent = attachSidecar(await saveSession(), sidecar);
			const blob = new Blob([guvContent], { type: 'application/json' });
			const url = URL.createObjectURL(blob);

			const a = document.createElement('a');
			a.href = url;
			a.download = `${$project.name}.guv`;
			a.click();
			URL.revokeObjectURL(url);
			markProjectClean();
		} catch (e) {
			console.error('Save failed:', e);
			alertDialog = { title: 'Save Failed', message: 'Failed to save file. Make sure the session is initialized.' };
		}
	}

	async function loadFromFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// Extract project name from filename (remove .guv extension)
		const projectName = file.name.replace(/\.guv$/i, '');

		isLoadingFile = true;
		const text = await file.text();
		let loadStarted = false;
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
				const sidecar = extractSidecar(text);
				if (sidecar) {
					project.setFloorPlan(sidecar.placement, { id: sidecar.placement.imageId, mime: sidecar.image.mime, src: sidecar.image.src });
				}
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
			markProjectClean();
		}
		input.value = '';
	}

	async function addNewLamp() {
		// Add a new lamp with default settings from user preferences
		// Pass existing lamps so position is calculated to maximize distance from them
		const s = $userSettings;
		const newLamp = defaultLamp($room, $lamps, s.lampPlacement);
		newLamp.name = `Lamp ${$lamps.length + 1}`;
		newLamp.lamp_type = s.lampType;
		if (s.lampType === 'krcl_222' && s.lampPreset222) {
			newLamp.preset_id = s.lampPreset222;
		} else if (s.lampType === 'lp_254' || s.lampType === 'other') {
			newLamp.preset_id = 'custom';
		}
		try {
			const id = await project.addLamp(newLamp);
			// Ensure the panel and section are visible
			if (isMobile) {
				activeMobileTab = 'configure';
			} else {
				leftPanelCollapsed = false;
			}
			lampsOpen = true;
			// Open the editor for the new lamp (close others)
			closeAllEditors();
			editingLamps = { [id]: true };
			// Scroll to the new lamp after DOM updates
			await tick();
			document.querySelector(`[data-lamp-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		} catch (e) {
			console.error('Failed to add lamp:', e);
		}
	}

	async function addNewZone() {
		// Add a new zone with default settings from user preferences
		const s = $userSettings;
		const zoneType = s.zoneType;
		const typeCount = $zones.filter(z => !z.isStandard).length;
		const newZone = defaultZone($room, typeCount, {
			type: zoneType,
			display_mode: zoneType === 'volume' ? s.volumeDisplayMode : s.planeDisplayMode,
			offset: s.zoneOffset,
			calc_mode: s.zoneCalcMode,
			dose: s.zoneDose,
			hours: s.zoneHours,
			minutes: s.zoneMinutes,
			seconds: s.zoneSeconds,
		});
		try {
			const id = await project.addZone(newZone);
			// Ensure the panel and section are visible
			if (isMobile) {
				activeMobileTab = 'configure';
			} else {
				leftPanelCollapsed = false;
			}
			zonesOpen = true;
			// Open the editor for the new zone (close others)
			closeAllEditors();
			editingZones = { [id]: true };
			// Scroll to the new zone after DOM updates and layout settles
			await tick();
			await new Promise(r => requestAnimationFrame(r));
			document.querySelector(`[data-zone-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		} catch (e) {
			console.error('Failed to add zone:', e);
		}
	}

	// Footprint editor: draw a new extruded object, or reshape / convert an existing one
	let footprintTarget = $state<{ mode: 'create' } | { mode: 'edit'; object: SceneObject } | null>(null);

	function openFootprintEditor(object?: SceneObject) {
		footprintTarget = object ? { mode: 'edit', object } : { mode: 'create' };
	}

	async function applyFootprint(result: FootprintApplyResult) {
		const target = footprintTarget;
		footprintTarget = null;
		if (!target) return;
		const common = {
			shape: 'extrusion' as const,
			vertices: result.vertices,
			x: result.x,
			y: result.y,
			yaw: 0,
			width: result.width,
			length: result.length,
			height: result.height,
			reflectance: result.reflectance,
			transmittance: result.transmittance,
		};
		if (target.mode === 'edit') {
			project.updateObject(target.object.id, { ...common, name: result.name || target.object.name });
			return;
		}
		try {
			const id = await project.addObject({
				...common,
				name: result.name || `Obstacle ${$objects.length + 1}`,
				z: 0,
				pitch: 0,
				roll: 0,
				enabled: true,
			});
			objectsOpen = true;
			closeAllEditors();
			editingObjects = { [id]: true };
			await tick();
			document.querySelector(`[data-object-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		} catch (e) {
			console.error('Failed to add object:', e);
		}
	}

	async function addNewObject() {
		// A 1 m (3 ft) opaque box standing on the floor at the room centre
		const newObject = defaultObject($room, $userSettings.units, { name: `Obstacle ${$objects.length + 1}` });
		try {
			const id = await project.addObject(newObject);
			if (isMobile) {
				activeMobileTab = 'configure';
			} else {
				leftPanelCollapsed = false;
			}
			objectsOpen = true;
			closeAllEditors();
			editingObjects = { [id]: true };
			await tick();
			await new Promise(r => requestAnimationFrame(r));
			document.querySelector(`[data-object-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		} catch (e) {
			console.error('Failed to add object:', e);
		}
	}
</script>

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
		onSave={saveToFile}
		onLoad={() => document.getElementById('load-file')?.click()}
		onAddLamp={addNewLamp}
		onAddZone={addNewZone}
		onAddObject={addNewObject}
		onShowReflectanceSettings={() => openOrRestore('Reflectance Settings', () => showReflectanceSettings = true)}
		onShowLampManager={() => { lampManagerInitialType = null; lampManagerTargetLampId = null; openOrRestore('Manage Custom Lamps', () => showLampManager = true); }}
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
		sidebarLayout={$userSettings.sidebarLayout}
		onSetSidebarLayout={(layout) => userSettings.update(s => ({ ...s, sidebarLayout: layout }))}
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
	/>

	{#snippet objectsList()}
		{#if $objects.length === 0}
			<p class="text-muted" style="font-size: var(--font-size-base);">Desks, partitions and cabinets block and reflect light. Draw each one where it stands.</p>
		{:else}
			<ul class="item-list">
				{#each $objects as obj (obj.id)}
					{@const objectEyeActive = objectsLayerVisible && objectVisibility[obj.id] !== false}
					<li class="item-list-item" class:calc-disabled={obj.enabled === false} data-object-id={obj.id}>
						<div
							class="item-list-row clickable"
							class:expanded={editingObjects[obj.id]}
							onclick={() => toggleObjectEditor(obj.id)}
							onmouseenter={() => hoveredObjectId = obj.id}
							onmouseleave={() => { if (hoveredObjectId === obj.id) hoveredObjectId = null; }}
						>
							<div class="lamp-name-col">
								{#if editingObjectName === obj.id}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										type="text"
										class="inline-name-input"
										value={obj.name || ''}
										onblur={(e) => confirmObjectRename(obj.id, (e.target as HTMLInputElement).value)}
										onkeydown={(e) => handleObjectNameKeydown(e, obj.id)}
										onclick={(e) => e.stopPropagation()}
										use:autoFocus
									/>
								{:else}
									<span class="lamp-name-row">
										<span
											class="lamp-name"
											onclick={(e) => e.stopPropagation()}
											ondblclick={(e) => { e.stopPropagation(); startObjectRename(obj.id); }}
										>
											{obj.name || obj.id}
										</span>
										{#if editingObjects[obj.id]}
											<button
												class="edit-name-btn"
												onclick={(e) => { e.stopPropagation(); startObjectRename(obj.id); }}
												title="Rename obstacle"
											>
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
													<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
												</svg>
											</button>
										{/if}
									</span>
								{/if}
								<span class="lamp-subtitle"><span class="lamp-subtitle-id">{objectHeightText(obj, $room.z, $room.precision, unitAbbrev($userSettings.units))}, R {obj.reflectance.toFixed(2)}</span></span>
							</div>
							<button
								class="icon-toggle"
								class:pressed={objectEyeActive}
								disabled={!objectsLayerVisible}
								onclick={(e) => { e.stopPropagation(); toggleObjectVisibility(obj.id); }}
								aria-label={objectEyeActive ? `Hide ${obj.name || 'obstacle'}` : `Show ${obj.name || 'obstacle'}`}
								title={objectEyeActive ? 'Hide' : 'Show'}
								use:enterToggle
							>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									{#if objectEyeActive}
										<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
										<circle cx="12" cy="12" r="3"/>
									{:else}
										<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
										<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
										<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
										<line x1="1" y1="1" x2="23" y2="23"/>
									{/if}
								</svg>
							</button>
							<button
								class="icon-toggle"
								class:pressed={obj.enabled !== false}
								onclick={(e) => { e.stopPropagation(); project.updateObject(obj.id, { enabled: !(obj.enabled !== false) }); }}
								aria-label={obj.enabled !== false ? `Exclude ${obj.name || 'obstacle'} from calculations` : `Include ${obj.name || 'obstacle'} in calculations`}
								title={obj.enabled !== false ? 'Exclude from calc' : 'Include in calc'}
								use:enterToggle
							>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<rect x="4" y="2" width="16" height="20" rx="2"/>
									<line x1="8" y1="6" x2="16" y2="6"/>
									<line x1="8" y1="10" x2="10" y2="10"/>
									<line x1="14" y1="10" x2="16" y2="10"/>
									<line x1="8" y1="14" x2="10" y2="14"/>
									<line x1="14" y1="14" x2="16" y2="14"/>
									<line x1="8" y1="18" x2="10" y2="18"/>
									<line x1="14" y1="18" x2="16" y2="18"/>
									{#if obj.enabled === false}
										<line x1="1" y1="1" x2="23" y2="23"/>
									{/if}
								</svg>
							</button>
							<button
								class="icon-toggle"
								onclick={(e) => { e.stopPropagation(); pendingDelete = { type: 'object', id: obj.id, name: obj.name || obj.id }; }}
								aria-label={`Delete ${obj.name || 'obstacle'}`}
								title="Delete"
							>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<polyline points="3 6 5 6 21 6"/>
									<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
									<path d="M10 11v6"/>
									<path d="M14 11v6"/>
									<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
								</svg>
							</button>
						</div>
						{#if editingObjects[obj.id]}
							<div class="inline-editor">
								<ObjectEditor object={obj} room={$room} onClose={() => closeObjectEditor(obj.id)} onCopy={onObjectCopied} onEditFootprint={(o) => openFootprintEditor(o)} />
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<button class="secondary add-btn add-object-btn" onclick={() => openFootprintEditor()} title="Draw the footprint of an obstacle where it stands in the room">
			Add obstacle…
		</button>
	{/snippet}

	{#snippet configureContent()}
		<div class="steps" class:expert={!guidedLayout}>
		<!-- Step 1: Room -->
		<SidebarStep number={1} title="Floorplan" summary={roomSummary} status="done" bind:open={roomOpen} flat={!guidedLayout} id="room">
			<RoomEditor bind:floorPlanOpen={roomPlanOpen} />
		</SidebarStep>
		<!-- Step 2: Obstacles (optional) -->
		<SidebarStep number={2} title="Obstacles" summary={objectsSummary} status={$objects.length > 0 ? 'done' : 'idle'} bind:open={objectsOpen} flat={!guidedLayout} id="objects">
			{#snippet headerExtra()}
				<button
					class="section-eye-btn"
					onclick={(e) => { e.stopPropagation(); objectsLayerVisible = !objectsLayerVisible; }}
					aria-label={objectsLayerVisible ? 'Hide all obstacles' : 'Show all obstacles'}
					title={objectsLayerVisible ? 'Hide all obstacles' : 'Show all obstacles'}
					use:enterToggle
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
						<circle cx="12" cy="12" r="3"/>
						{#if !objectsLayerVisible}
							<line x1="1" y1="1" x2="23" y2="23"/>
						{/if}
					</svg>
				</button>
			{/snippet}
			{@render objectsList()}
		</SidebarStep>
		<!-- Step 3: Reflectance (optional) -->
		<SidebarStep number={3} title="Reflectance" summary={reflSummary} status={$room.enable_reflectance ? 'done' : 'idle'} bind:open={reflOpen} flat={!guidedLayout} id="reflectance">
			<ReflectanceStep onShowReflectanceSettings={() => openOrRestore('Reflectance Settings', () => showReflectanceSettings = true)} />
		</SidebarStep>
		<!-- Step 4: Lamps -->
		<SidebarStep number={4} title="Lamps" summary={lampsSummary} status={lampsStatus} bind:open={lampsOpen} flat={!guidedLayout} id="lamps">
			{#snippet headerExtra()}
				<button
					class="section-eye-btn"
					onclick={(e) => { e.stopPropagation(); lampsLayerVisible = !lampsLayerVisible; }}
					aria-label={lampsLayerVisible ? 'Hide all lamps' : 'Show all lamps'}
					title={lampsLayerVisible ? 'Hide all lamps' : 'Show all lamps'}
					use:enterToggle
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
						<circle cx="12" cy="12" r="3"/>
						{#if !lampsLayerVisible}
							<line x1="1" y1="1" x2="23" y2="23"/>
						{/if}
					</svg>
				</button>
			{/snippet}
			{#if $lamps.length === 0}
			{:else}
				<ul class="item-list">
					{#each $lamps as lamp (lamp.id)}
						{@const lampEyeActive = lampsLayerVisible && lampVisibility[lamp.id] !== false}
						<li class="item-list-item" class:calc-disabled={lamp.enabled === false} data-lamp-id={lamp.id}>
							<div
								class="item-list-row clickable"
								class:expanded={editingLamps[lamp.id]}
								onclick={() => toggleLampEditor(lamp.id)}
								onmouseenter={() => hoveredLampId = lamp.id}
								onmouseleave={() => { if (hoveredLampId === lamp.id) hoveredLampId = null; }}
							>
								<div class="lamp-name-col">
									{#if editingLampName === lamp.id}
										<!-- svelte-ignore a11y_autofocus -->
										<input
											type="text"
											class="inline-name-input"
											value={lamp.name || ''}
											onblur={(e) => confirmLampRename(lamp.id, (e.target as HTMLInputElement).value)}
											onkeydown={(e) => handleNameKeydown(e, lamp.id)}
											onclick={(e) => e.stopPropagation()}
											use:autoFocus
										/>
									{:else}
										<span class="lamp-name-row">
											<span
												class="lamp-name"
												onclick={(e) => e.stopPropagation()}
												ondblclick={(e) => { e.stopPropagation(); startLampRename(lamp.id); }}
											>
												{lamp.name || 'New Lamp'}
											</span>
											{#if editingLamps[lamp.id]}
												<button
													class="edit-name-btn"
													onclick={(e) => { e.stopPropagation(); startLampRename(lamp.id); }}
													title="Rename lamp"
												>
													<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
														<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
														<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
													</svg>
												</button>
											{/if}
										</span>
									{/if}
									{#if !lamp.preset_id && !lamp.has_ies_file}
										<span class="needs-config">no model chosen</span>
									{:else if lamp.preset_id === 'custom' && !lamp.has_ies_file}
										<span class="needs-config">custom, no photometry yet</span>
									{:else}
										<span class="lamp-subtitle"><span class="lamp-subtitle-id">{getLampDisplayId(lamp)}</span>{#if lamp.scaling_factor !== 1}<span class="lamp-subtitle-dim">&nbsp;- {(lamp.scaling_factor * 100).toFixed(0)}%</span>{/if}</span>
									{/if}
								</div>
								<button
									class="icon-toggle"
									class:pressed={lampEyeActive}
									disabled={!lampsLayerVisible}
									onclick={(e) => { e.stopPropagation(); toggleLampVisibility(lamp.id); }}
									aria-label={lampEyeActive ? `Hide ${lamp.name || 'lamp'}` : `Show ${lamp.name || 'lamp'}`}
									title={lampEyeActive ? 'Hide' : 'Show'}
									use:enterToggle
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										{#if lampEyeActive}
											<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
											<circle cx="12" cy="12" r="3"/>
										{:else}
											<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
											<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
											<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
											<line x1="1" y1="1" x2="23" y2="23"/>
										{/if}
									</svg>
								</button>
								<button
									class="icon-toggle"
									class:pressed={lamp.enabled !== false}
									onclick={(e) => { e.stopPropagation(); project.updateLamp(lamp.id, { enabled: !(lamp.enabled !== false) }); }}
									aria-label={lamp.enabled !== false ? `Exclude ${lamp.name || 'lamp'} from calculations` : `Include ${lamp.name || 'lamp'} in calculations`}
									title={lamp.enabled !== false ? 'Exclude from calc' : 'Include in calc'}
									use:enterToggle
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<rect x="4" y="2" width="16" height="20" rx="2"/>
										<line x1="8" y1="6" x2="16" y2="6"/>
										<line x1="8" y1="10" x2="10" y2="10"/>
										<line x1="14" y1="10" x2="16" y2="10"/>
										<line x1="8" y1="14" x2="10" y2="14"/>
										<line x1="14" y1="14" x2="16" y2="14"/>
										<line x1="8" y1="18" x2="10" y2="18"/>
										<line x1="14" y1="18" x2="16" y2="18"/>
										{#if lamp.enabled === false}
											<line x1="1" y1="1" x2="23" y2="23"/>
										{/if}
									</svg>
								</button>
								<button
									class="icon-toggle"
									onclick={(e) => { e.stopPropagation(); pendingDelete = { type: 'lamp', id: lamp.id, name: lamp.name || 'New Lamp' }; }}
									aria-label={`Delete ${lamp.name || 'lamp'}`}
									title="Delete"
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<polyline points="3 6 5 6 21 6"/>
										<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
										<path d="M10 11v6"/>
										<path d="M14 11v6"/>
										<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
									</svg>
								</button>
							</div>
							{#if editingLamps[lamp.id]}
								<div class="inline-editor">
									<LampEditor lamp={lamp} room={$room} onClose={() => closeLampEditor(lamp.id)} onCopy={onLampCopied} onOpenLampManager={(type, lampId) => { lampManagerInitialType = type; lampManagerTargetLampId = lampId; openOrRestore('Manage Custom Lamps', () => showLampManager = true); }} />
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			<button class="secondary add-btn" onclick={addNewLamp}>
				Add lamp
			</button>
		</SidebarStep>
		<!-- Step 5: Calc zones (optional) -->
		<SidebarStep number={5} title="Calc Zones" summary={zonesSummary} status={$zones.some(z => !z.isStandard) ? 'done' : 'idle'} bind:open={zonesOpen} flat={!guidedLayout} id="zones">
			{#snippet headerExtra()}
				<button
					class="section-eye-btn"
					onclick={(e) => { e.stopPropagation(); zonesLayerVisible = !zonesLayerVisible; }}
					aria-label={zonesLayerVisible ? 'Hide all zones' : 'Show all zones'}
					title={zonesLayerVisible ? 'Hide all zones' : 'Show all zones'}
					use:enterToggle
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
						<circle cx="12" cy="12" r="3"/>
						{#if !zonesLayerVisible}
							<line x1="1" y1="1" x2="23" y2="23"/>
						{/if}
					</svg>
				</button>
			{/snippet}
			<!-- Standard Zones Toggle -->
			<div class="standard-zones-toggle">
				<label class="checkbox-label">
					<input
						type="checkbox"
						checked={$room.useStandardZones}
						onchange={(e) => project.updateRoom({ useStandardZones: (e.target as HTMLInputElement).checked })}
						use:enterToggle
					/>
					<span>Use standard zones</span>
				</label>
			</div>

			<!-- Standard Zones List -->
			{#if standardZonesList.length > 0}
				<div class="standard-zones-section">
					<span class="section-label">Standard</span>
					<ul class="item-list">
						{#each standardZonesList as zone (zone.id)}
							{@const zoneEyeActive = zonesLayerVisible && zoneVisibility[zone.id] !== false}
							<li class="item-list-item standard-zone" class:calc-disabled={zone.enabled === false} data-zone-id={zone.id}>
								<div
									class="item-list-row clickable"
									class:expanded={editingZones[zone.id]}
									onclick={() => toggleZoneEditor(zone.id)}
									onmouseenter={() => hoveredZoneId = zone.id}
									onmouseleave={() => { if (hoveredZoneId === zone.id) hoveredZoneId = null; }}
								>
									<div class="zone-name-row">
										<CalcTypeIllustration type={zone.type === 'volume' ? 'calc_vol' : zone.type === 'point' ? 'calc_point' : 'calc_plane'} size={16} />
										<span>{zone.name || zone.id}</span>
										<span class="standard-badge">standard</span>
									</div>
									<button
										class="icon-toggle"
										class:pressed={zoneEyeActive}
										disabled={!zonesLayerVisible}
										onclick={(e) => { e.stopPropagation(); toggleZoneVisibility(zone.id); }}
										aria-label={zoneEyeActive ? `Hide ${zone.name || 'zone'}` : `Show ${zone.name || 'zone'}`}
										title={zoneEyeActive ? 'Hide' : 'Show'}
										use:enterToggle
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											{#if zoneEyeActive}
												<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
												<circle cx="12" cy="12" r="3"/>
											{:else}
												<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
												<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
												<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
												<line x1="1" y1="1" x2="23" y2="23"/>
											{/if}
										</svg>
									</button>
									{#if !guidedLayout}
									<button
										class="icon-toggle"
										class:pressed={zone.enabled !== false}
										onclick={(e) => { e.stopPropagation(); project.updateZone(zone.id, { enabled: !(zone.enabled !== false) }); }}
										aria-label={zone.enabled !== false ? `Exclude ${zone.name || 'zone'} from calculations` : `Include ${zone.name || 'zone'} in calculations`}
										title={zone.enabled !== false ? 'Exclude from calc' : 'Include in calc'}
										use:enterToggle
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<rect x="4" y="2" width="16" height="20" rx="2"/>
											<line x1="8" y1="6" x2="16" y2="6"/>
											<line x1="8" y1="10" x2="10" y2="10"/>
											<line x1="14" y1="10" x2="16" y2="10"/>
											<line x1="8" y1="14" x2="10" y2="14"/>
											<line x1="14" y1="14" x2="16" y2="14"/>
											<line x1="8" y1="18" x2="10" y2="18"/>
											<line x1="14" y1="18" x2="16" y2="18"/>
											{#if zone.enabled === false}
												<line x1="1" y1="1" x2="23" y2="23"/>
											{/if}
										</svg>
									</button>
									<button
										class="icon-toggle"
										onclick={(e) => { e.stopPropagation(); pendingDelete = { type: 'zone', id: zone.id, name: zone.name || 'New Zone' }; }}
										aria-label={`Delete ${zone.name || 'zone'}`}
										title="Delete"
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<polyline points="3 6 5 6 21 6"/>
											<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
											<path d="M10 11v6"/>
											<path d="M14 11v6"/>
											<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
										</svg>
									</button>
									{/if}
								</div>
								{#if editingZones[zone.id]}
									<div class="inline-editor">
										<ZoneEditor zone={zone} room={$room} onClose={() => closeZoneEditor(zone.id)} onCopy={onZoneCopied} isStandard={true} isoSettings={isoSettingsMap[zone.id]} onIsoSettingsChange={(s) => updateIsoSettings(zone.id, s)} />
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- Custom Zones List -->
			{#if customZonesList.length > 0}
				<div class="custom-zones-section">
					{#if standardZonesList.length > 0}
						<span class="section-label">Custom</span>
					{/if}
					<ul class="item-list">
						{#each customZonesList as zone (zone.id)}
							{@const zoneEyeActive = zonesLayerVisible && zoneVisibility[zone.id] !== false}
							<li class="item-list-item" class:calc-disabled={zone.enabled === false} data-zone-id={zone.id}>
								<div
									class="item-list-row clickable"
									class:expanded={editingZones[zone.id]}
									onclick={() => toggleZoneEditor(zone.id)}
									onmouseenter={() => hoveredZoneId = zone.id}
									onmouseleave={() => { if (hoveredZoneId === zone.id) hoveredZoneId = null; }}
								>
									<div class="zone-name-col">
										{#if editingZoneName === zone.id}
											<!-- svelte-ignore a11y_autofocus -->
											<input
												type="text"
												class="inline-name-input"
												value={zone.name || ''}
												onblur={(e) => confirmZoneRename(zone.id, (e.target as HTMLInputElement).value)}
												onkeydown={(e) => handleZoneNameKeydown(e, zone.id)}
												onclick={(e) => e.stopPropagation()}
												use:autoFocus
											/>
										{:else}
											<span class="zone-name-row">
												<CalcTypeIllustration type={zone.type === 'volume' ? 'calc_vol' : zone.type === 'point' ? 'calc_point' : 'calc_plane'} size={16} />
												<span
													class="zone-name"
													onclick={(e) => e.stopPropagation()}
													ondblclick={(e) => { e.stopPropagation(); startZoneRename(zone.id); }}
												>
													{zone.name || 'New Zone'}
												</span>
												{#if editingZones[zone.id]}
													<button
														class="edit-name-btn"
														onclick={(e) => { e.stopPropagation(); startZoneRename(zone.id); }}
														title="Rename zone"
													>
														<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
															<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
															<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
														</svg>
													</button>
												{/if}
											</span>
										{/if}
									</div>
									<button
										class="icon-toggle"
										class:pressed={zoneEyeActive}
										disabled={!zonesLayerVisible}
										onclick={(e) => { e.stopPropagation(); toggleZoneVisibility(zone.id); }}
										aria-label={zoneEyeActive ? `Hide ${zone.name || 'zone'}` : `Show ${zone.name || 'zone'}`}
										title={zoneEyeActive ? 'Hide' : 'Show'}
										use:enterToggle
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											{#if zoneEyeActive}
												<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
												<circle cx="12" cy="12" r="3"/>
											{:else}
												<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
												<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
												<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
												<line x1="1" y1="1" x2="23" y2="23"/>
											{/if}
										</svg>
									</button>
									<button
										class="icon-toggle"
										class:pressed={zone.enabled !== false}
										onclick={(e) => { e.stopPropagation(); project.updateZone(zone.id, { enabled: !(zone.enabled !== false) }); }}
										aria-label={zone.enabled !== false ? `Exclude ${zone.name || 'zone'} from calculations` : `Include ${zone.name || 'zone'} in calculations`}
										title={zone.enabled !== false ? 'Exclude from calc' : 'Include in calc'}
										use:enterToggle
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<rect x="4" y="2" width="16" height="20" rx="2"/>
											<line x1="8" y1="6" x2="16" y2="6"/>
											<line x1="8" y1="10" x2="10" y2="10"/>
											<line x1="14" y1="10" x2="16" y2="10"/>
											<line x1="8" y1="14" x2="10" y2="14"/>
											<line x1="14" y1="14" x2="16" y2="14"/>
											<line x1="8" y1="18" x2="10" y2="18"/>
											<line x1="14" y1="18" x2="16" y2="18"/>
											{#if zone.enabled === false}
												<line x1="1" y1="1" x2="23" y2="23"/>
											{/if}
										</svg>
									</button>
									<button
										class="icon-toggle"
										onclick={(e) => { e.stopPropagation(); pendingDelete = { type: 'zone', id: zone.id, name: zone.name || 'New Zone' }; }}
										aria-label={`Delete ${zone.name || 'zone'}`}
										title="Delete"
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<polyline points="3 6 5 6 21 6"/>
											<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
											<path d="M10 11v6"/>
											<path d="M14 11v6"/>
											<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
										</svg>
									</button>
								</div>
								{#if editingZones[zone.id]}
									<div class="inline-editor">
										<ZoneEditor zone={zone} room={$room} onClose={() => closeZoneEditor(zone.id)} onCopy={onZoneCopied} isoSettings={isoSettingsMap[zone.id]} onIsoSettingsChange={(s) => updateIsoSettings(zone.id, s)} />
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{:else if !$room.useStandardZones}
				<p class="text-muted" style="font-size: var(--font-size-base);">No zones defined</p>
			{/if}
			<button class="secondary add-btn" onclick={addNewZone}>
				Add Zone
			</button>
		</SidebarStep>
		</div>
	{/snippet}

	{#snippet resultsContent()}
		<ZoneStatsPanel onShowAudit={() => openOrRestore('Design Audit', () => showAuditModal = true)} onLampHover={(id) => hoveredLampId = id} onOpenAdvancedSettings={(id) => { if (!restoreByTitle('Advanced Lamp Settings')) advancedSettingsLampId = id; }} onSelectSpecies={() => { settingsInitialTab = 'results'; openOrRestore('Settings', () => { settingsInitialTab = 'results'; showSettingsModal = true; }); }} {isoSettingsMap} {isoGeometryMap} onIsoSettingsChange={(zoneId, s) => updateIsoSettings(zoneId, s)} />
	{/snippet}

	<!-- Main Layout -->
	{#if isMobile}
		<div class="app-layout mobile">
			<!-- Configure panel -->
			<div class="mobile-panel" class:active={activeMobileTab === 'configure'}>
				<div class="mobile-panel-scroll">
					{@render configureContent()}
				</div>
			</div>

			<!-- 3D Viewer - always mounted -->
			<main class="main-content" class:mobile-hidden={activeMobileTab !== 'viewer'}>
				<div class="viewer-wrapper">
					<RoomViewer room={$room} lamps={$lamps} zones={$zones} objects={$objects} zoneResults={$results?.zones} {selectedLampIds} {selectedZoneIds} {selectedObjectIds} {highlightedLampIds} {highlightedZoneIds} {highlightedObjectIds} {visibleLampIds} {visibleZoneIds} {visibleObjectIds} onLampClick={handleLampClick} onZoneClick={handleZoneClick} onObjectClick={handleObjectClick} globalValueRange={($room.globalHeatmapNormalization ?? false) ? globalValueRange : null} {isoSettingsMap} onIsoGeometryReady={handleIsoGeometryReady} />
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
				{@render configureContent()}
			</ResizablePanel>

			<main class="main-content">
				<div class="viewer-wrapper">
					<RoomViewer room={$room} lamps={$lamps} zones={$zones} objects={$objects} zoneResults={$results?.zones} {selectedLampIds} {selectedZoneIds} {selectedObjectIds} {highlightedLampIds} {highlightedZoneIds} {highlightedObjectIds} {visibleLampIds} {visibleZoneIds} {visibleObjectIds} onLampClick={handleLampClick} onZoneClick={handleZoneClick} onObjectClick={handleObjectClick} globalValueRange={($room.globalHeatmapNormalization ?? false) ? globalValueRange : null} {isoSettingsMap} onIsoGeometryReady={handleIsoGeometryReady} />
					<div class="floating-calculate">
						<CalculateButton />
					</div>
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

{#if showReflectanceSettings}
	<ReflectanceSettingsModal onClose={() => showReflectanceSettings = false} />
{/if}

{#if showLampManager}
	<LampManagerModal
		initialLampType={lampManagerInitialType ?? undefined}
		onClose={() => { showLampManager = false; lampManagerTargetLampId = null; }}
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
	<ExportModal onClose={() => showExportModal = false} />
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
		onConfirm={() => { showNewProjectConfirm = false; project.reset(); markProjectClean(); }}
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

{#if footprintTarget}
	<FootprintModal
		mode={footprintTarget.mode}
		object={footprintTarget.mode === 'edit' ? footprintTarget.object : undefined}
		room={$room}
		units={$userSettings.units}
		lamps={$lamps}
		objects={$objects}
		floorplan={$room.floorplan ?? null}
		image={$room.floorplan && $floorplanImage?.id === $room.floorplan.imageId ? $floorplanImage : null}
		onApply={applyFootprint}
		onClose={() => footprintTarget = null}
	/>
{/if}

{#if pendingDelete}
	<ConfirmDialog
		title="Delete {pendingDelete.type === 'lamp' ? 'Lamp' : pendingDelete.type === 'object' ? 'Obstacle' : 'Zone'}"
		message="Delete {pendingDelete.name}?"
		confirmLabel="Delete"
		variant="danger"
		onConfirm={() => {
			if (pendingDelete) {
				if (pendingDelete.type === 'lamp') {
					project.removeLamp(pendingDelete.id);
				} else if (pendingDelete.type === 'object') {
					project.removeObject(pendingDelete.id);
				} else {
					project.removeZone(pendingDelete.id);
				}
				pendingDelete = null;
			}
		}}
		onCancel={() => pendingDelete = null}
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

	.item-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.item-list-item {
		border-bottom: 1px solid var(--color-border);
	}

	.item-list-item:last-child {
		border-bottom: none;
	}

	.item-list-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) 0;
	}

	.item-list-row.clickable {
		cursor: pointer;
		transition: background 0.15s;
		margin: 0 calc(-1 * var(--spacing-sm));
		padding: var(--spacing-sm);
		border-radius: var(--radius-sm);
	}

	.item-list-row.clickable:hover {
		background: var(--color-bg-tertiary);
	}

	.item-list-row.expanded {
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
	}

	.inline-editor {
		margin: 0 calc(-1 * var(--spacing-sm));
		margin-top: 0;
		padding-bottom: var(--spacing-sm);
	}

	.viewer-wrapper {
		flex: 1;
		min-height: 0;
		border-radius: var(--radius-lg);
		overflow: hidden;
		position: relative;
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

	.floating-calculate {
		position: absolute;
		top: var(--spacing-sm);
		right: var(--spacing-sm);
		z-index: 100;
	}
	.main-content {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-height: 0;
	}

	.needs-config {
		display: block;
		font-size: var(--font-size-xs);
		color: var(--color-needs-config);
		font-style: italic;
	}

	.lamp-name-col {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.lamp-name-row {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		flex: 1 1 0;
	}

	.lamp-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: text; /* Hint that it's editable */
	}

	.inline-name-input {
		font-size: inherit;
		font-weight: inherit;
		padding: 2px 4px;
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		flex: 1 1 0;
		min-width: 0;
	}

	.edit-name-btn {
		background: transparent;
		border: none;
		padding: 2px;
		cursor: pointer;
		color: var(--color-text-muted);
		opacity: 0.6;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
	}

	.edit-name-btn:hover {
		opacity: 1;
		color: var(--color-text);
	}

	.lamp-subtitle {
		display: flex;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
		min-width: 0;
		flex: 1 1 0;
		overflow: hidden;
	}

	.lamp-subtitle-id {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.lamp-subtitle-dim {
		flex-shrink: 0;
		white-space: nowrap;
	}

	/* Standard zones styles */
	.standard-zones-toggle {
		margin-bottom: var(--spacing-md);
		padding-bottom: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		font-size: var(--font-size-base);
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
		margin: 0;
	}

	.section-label {
		display: block;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: var(--spacing-xs);
	}

	.standard-zones-section {
		margin-bottom: var(--spacing-md);
	}

	.custom-zones-section {
		margin-bottom: var(--spacing-sm);
	}

	.item-list-item.calc-disabled {
		opacity: 0.5;
	}

	.item-list > .item-list-item,
	.standard-zone,
	.custom-zones-section .item-list-item {
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		margin-bottom: var(--spacing-xs);
	}

	.item-list > .item-list-item > .item-list-row,
	.standard-zone .item-list-row,
	.custom-zones-section .item-list-item .item-list-row {
		margin: 0;
	}

	.zone-name-row {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}

	.zone-name-row :global(svg) {
		flex-shrink: 0;
	}

	.zone-name-col {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.zone-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: text;
	}

	.item-list-item {
		scroll-margin-top: 3rem;
	}

	.standard-badge {
		font-size: var(--font-size-xs);
		padding: 1px 4px;
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.steps {
		display: flex;
		flex-direction: column;
	}
	.add-btn {
		width: 100%;
		margin-top: var(--spacing-sm);
	}
	/* --- Icon toggle buttons (eye/calculator in sidebar rows) --- */
	.icon-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		flex-shrink: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.1s ease;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}

	.icon-toggle:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-text) 12%, transparent);
		color: var(--color-text);
	}

	.icon-toggle.pressed {
		background: color-mix(in srgb, var(--color-accent) 20%, var(--color-bg-secondary));
		border-color: var(--color-accent);
		color: var(--color-accent);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
	}

	.icon-toggle.pressed:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent) 30%, var(--color-bg-secondary));
	}

	.icon-toggle:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.icon-toggle svg {
		display: block;
		flex-shrink: 0;
	}
	/* Row toggles stay quiet until the row is hovered, focused or open */
	.item-list-row .icon-toggle:not(.pressed) {
		opacity: 0.55;
	}
	.item-list-row:hover .icon-toggle,
	.item-list-row:focus-within .icon-toggle,
	.item-list-row.expanded .icon-toggle {
		opacity: 1;
	}

	/* Section-level eye toggle in panel headers */
	.section-eye-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		padding: 2px;
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.section-eye-btn:hover {
		color: var(--color-text);
	}

	.section-eye-btn svg {
		display: block;
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
	.add-object-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-xs);
		margin-bottom: var(--spacing-sm);
	}
	.add-object-row button {
		width: 100%;
	}
</style>
