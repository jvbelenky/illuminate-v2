<script lang="ts">
	import { project, room, lamps, zones, results, syncErrors } from '$lib/stores/project';
	import { onMount, onDestroy, tick } from 'svelte';
	import RoomViewer from '$lib/components/RoomViewer.svelte';
	import RoomEditor from '$lib/components/RoomEditor.svelte';
	import LampEditor from '$lib/components/LampEditor.svelte';
	import ZoneEditor from '$lib/components/ZoneEditor.svelte';
	import CalcTypeIllustration from '$lib/components/CalcTypeIllustration.svelte';
	import CalculateButton from '$lib/components/CalculateButton.svelte';
	import ZoneStatsPanel from '$lib/components/ZoneStatsPanel.svelte';
	import ResizablePanel from '$lib/components/ResizablePanel.svelte';
	import HelpModal from '$lib/components/HelpModal.svelte';
	import AboutModal from '$lib/components/AboutModal.svelte';
	import CiteModal from '$lib/components/CiteModal.svelte';
	import ReflectanceSettingsModal from '$lib/components/ReflectanceSettingsModal.svelte';
	import AuditModal from '$lib/components/AuditModal.svelte';
	import ExploreDataModal from '$lib/components/ExploreDataModal.svelte';
	import SyncErrorToast from '$lib/components/SyncErrorToast.svelte';
	import MenuBar from '$lib/components/MenuBar.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import { getVersion, saveSession, loadSession, getLampOptionsCached } from '$lib/api/client';
	import type { LampInstance, CalcZone, ZoneDisplayMode } from '$lib/types/project';
	import { defaultLamp, defaultZone, ROOM_DEFAULTS } from '$lib/types/project';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
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
	let showExploreDataModal = $state(false);
	let guvCalcsVersion = $state<string | null>(null);
	let editingLamps = $state<Record<string, boolean>>({});
	let editingZones = $state<Record<string, boolean>>({});
	let leftPanelCollapsed = $state(false);
	let rightPanelCollapsed = $state(true); // Collapsed by default
	let hasEverCalculated = $state(false);
	let editingLampName: string | null = $state(null); // ID of lamp being renamed
	let editingZoneName: string | null = $state(null); // ID of zone being renamed

	// Mobile responsive state
	let isMobile = $state(false);
	type MobileTab = 'configure' | 'viewer' | 'results';
	let activeMobileTab = $state<MobileTab>('viewer');

	function checkMobile() {
		isMobile = window.innerWidth < 768;
	}

	// Dialog state
	let showNewProjectConfirm = $state(false);
	let pendingDelete = $state<{ type: 'lamp' | 'zone'; id: string; name: string } | null>(null);
	let alertDialog = $state<{ title: string; message: string } | null>(null);

	// Collapsible panel sections
	let roomPanelCollapsed = $state(false);
	let lampsPanelCollapsed = $state(false);
	let zonesPanelCollapsed = $state(false);

	// Separate standard zones from custom zones
	const standardZonesList = $derived($zones.filter(z => z.isStandard));
	const customZonesList = $derived($zones.filter(z => !z.isStandard));

	// Common display mode across all zones (null if mixed or no zones)
	const commonZoneDisplayMode = $derived<ZoneDisplayMode | null>(() => {
		if ($zones.length === 0) return null;
		const first = $zones[0].display_mode ?? 'heatmap';
		return $zones.every(z => (z.display_mode ?? 'heatmap') === first) ? first : null;
	});

	// Global value range across all zones (for global heatmap normalization)
	const globalValueRange = $derived.by(() => {
		if (!$results?.zones) return null;
		let min = Infinity, max = -Infinity;
		for (const zone of $zones) {
			if (zone.enabled === false) continue;
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
				meanFluence: $results!.zones[z.id].statistics.mean!
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

	// Hover state for 3D highlight on mouseover in config panel
	let hoveredLampId = $state<string | null>(null);
	let hoveredZoneId = $state<string | null>(null);
	const highlightedLampIds = $derived(hoveredLampId ? [hoveredLampId] : []);
	const highlightedZoneIds = $derived(hoveredZoneId ? [hoveredZoneId] : []);

	// Layer visibility state (lifted from DisplayControlOverlay)
	let lampsLayerVisible = $state(true);
	let zonesLayerVisible = $state(true);
	let lampVisibility = $state<Record<string, boolean>>({});
	let zoneVisibility = $state<Record<string, boolean>>({});

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

	function closeAllEditors() {
		editingLamps = {};
		editingZones = {};
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

	// 3D scene click selection - tracks which object was last selected via 3D click
	// Used for toggle (click again to deselect) and cycling (overlapping objects)
	type SceneSelection = { type: 'lamp' | 'zone'; id: string };
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

	async function processClickBatch() {
		const targets = [...pendingClickTargets];
		pendingClickTargets = [];
		clickBatchTimer = null;

		if (targets.length === 0) return;

		const prev = sceneSelection;

		// Only consider previous selection if its editor is still open
		const prevStillOpen = prev && (
			prev.type === 'lamp' ? editingLamps[prev.id] : editingZones[prev.id]
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
				lampsPanelCollapsed = false;
				editingLamps = { [next.id]: true };
			} else {
				zonesPanelCollapsed = false;
				editingZones = { [next.id]: true };
			}
			await tick();
			const sel = next.type === 'lamp'
				? `[data-lamp-id="${next.id}"]`
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
			guvCalcsVersion = versionResult.value.guv_calcs_version;
		} else {
			console.warn('Failed to fetch version:', versionResult.reason);
		}

		if (sessionResult.status === 'rejected') {
			console.warn('Failed to initialize session:', sessionResult.reason);
			syncErrors.add('Session initialization', sessionResult.reason, 'warning');
		}
	});

	onDestroy(() => {
		window.removeEventListener('pageshow', handlePageShow);
		window.removeEventListener('resize', checkMobile);
	});

	function startFresh() {
		showNewProjectConfirm = true;
	}

	async function saveToFile() {
		try {
			// Use Project.save() via the API to get proper .guv format
			const guvContent = await saveSession();
			const blob = new Blob([guvContent], { type: 'application/json' });
			const url = URL.createObjectURL(blob);

			const a = document.createElement('a');
			a.href = url;
			a.download = `${$project.name}.guv`;
			a.click();
			URL.revokeObjectURL(url);
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

		const text = await file.text();
		try {
			const guvData = JSON.parse(text);
			// Use Project.load() via the API to parse the .guv file
			const response = await loadSession(guvData);
			if (response.success) {
				// Update the frontend store with the loaded state
				project.loadFromApiResponse(response, projectName);
			} else {
				alertDialog = { title: 'Load Failed', message: 'Failed to load file: ' + response.message };
			}
		} catch (e) {
			console.error('Load failed:', e);
			alertDialog = { title: 'Load Failed', message: 'Failed to load file: invalid format or server error' };
		}
		input.value = '';
	}

	async function addNewLamp() {
		// Add a new lamp with default settings (user will configure in editor)
		// Pass existing lamps so position is calculated to maximize distance from them
		const newLamp = defaultLamp($room, $lamps);
		newLamp.name = `Lamp ${$lamps.length + 1}`;
		try {
			const id = await project.addLamp(newLamp);
			// Ensure the panel and section are visible
			if (isMobile) {
				activeMobileTab = 'configure';
			} else {
				leftPanelCollapsed = false;
			}
			lampsPanelCollapsed = false;
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
		// Add a new zone with default settings (user will configure in editor)
		const newZone = defaultZone($room, $zones.length);
		try {
			const id = await project.addZone(newZone);
			// Ensure the panel and section are visible
			if (isMobile) {
				activeMobileTab = 'configure';
			} else {
				leftPanelCollapsed = false;
			}
			zonesPanelCollapsed = false;
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
		projectName={$project.name}
		onRenameProject={(name) => project.setName(name)}
		onNewProject={startFresh}
		onSave={saveToFile}
		onLoad={() => document.getElementById('load-file')?.click()}
		onAddLamp={addNewLamp}
		onAddZone={addNewZone}
		onShowReflectanceSettings={() => showReflectanceSettings = true}
		onShowAudit={() => showAuditModal = true}
		onShowExploreData={() => showExploreDataModal = true}
		onShowHelp={() => showHelpModal = true}
		onShowCite={() => showCiteModal = true}
		onShowAbout={() => showAboutModal = true}
		{leftPanelCollapsed}
		{rightPanelCollapsed}
		onToggleLeftPanel={() => leftPanelCollapsed = !leftPanelCollapsed}
		onToggleRightPanel={() => rightPanelCollapsed = !rightPanelCollapsed}
		showDimensions={$room.showDimensions ?? true}
		onToggleShowDimensions={() => project.updateRoom({ showDimensions: !($room.showDimensions ?? true) })}
		showPhotometricWebs={$room.showPhotometricWebs ?? true}
		showGrid={$room.showGrid ?? true}
		showXYZMarker={$room.showXYZMarker ?? true}
		colormap={$room.colormap}
		precision={$room.precision}
		onToggleShowPhotometricWebs={() => project.updateRoom({ showPhotometricWebs: !($room.showPhotometricWebs ?? true) })}
		onToggleShowGrid={() => project.updateRoom({ showGrid: !($room.showGrid ?? true) })}
		onToggleShowXYZMarker={() => project.updateRoom({ showXYZMarker: !($room.showXYZMarker ?? true) })}
		onSetColormap={(cm) => project.updateRoom({ colormap: cm })}
		onSetPrecision={(p) => project.updateRoom({ precision: p })}
		globalHeatmapNormalization={$room.globalHeatmapNormalization ?? false}
		onToggleGlobalHeatmapNormalization={() => project.updateRoom({ globalHeatmapNormalization: !($room.globalHeatmapNormalization ?? false) })}
		currentZoneDisplayMode={commonZoneDisplayMode}
		onSetAllZonesDisplayMode={(mode: ZoneDisplayMode) => {
			for (const z of $zones) {
				project.updateZone(z.id, { display_mode: mode });
			}
		}}
	/>

	{#snippet configureContent()}
		<div class="configure-header">
			<h3>Configure</h3>
		</div>
		<!-- Room Configuration -->
		<div class="panel" class:collapsed={roomPanelCollapsed}>
			<button class="panel-header clickable" onclick={() => roomPanelCollapsed = !roomPanelCollapsed}>
				<span class="collapse-icon">{roomPanelCollapsed ? '▶' : '▼'}</span>
				<h3 class="mb-0">Room</h3>
			</button>
			{#if !roomPanelCollapsed}
				<div class="panel-content">
					<RoomEditor onShowReflectanceSettings={() => showReflectanceSettings = true} />
				</div>
			{/if}
		</div>

		<!-- Lamps Summary -->
		<div class="panel" class:collapsed={lampsPanelCollapsed}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="panel-header clickable" role="button" tabindex="0" onclick={() => lampsPanelCollapsed = !lampsPanelCollapsed} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lampsPanelCollapsed = !lampsPanelCollapsed; } }}>
				<span class="collapse-icon">{lampsPanelCollapsed ? '▶' : '▼'}</span>
				<h3 class="mb-0">Lamps</h3>
				<span class="status-badge">{$lamps.length}</span>
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
			</div>
			{#if !lampsPanelCollapsed}
				<div class="panel-content">
					<button class="secondary" onclick={addNewLamp} style="margin-bottom: var(--spacing-sm); width: 100%;">
						Add Lamp
					</button>
					{#if $lamps.length === 0}
						<p class="text-muted" style="font-size: var(--font-size-base);">No lamps added yet</p>
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
												<span class="needs-config">needs configuration</span>
											{:else if lamp.preset_id === 'custom' && !lamp.has_ies_file}
												<span class="needs-config">Custom - needs configuration</span>
											{:else}
												<span class="lamp-subtitle">{getLampDisplayId(lamp)}</span>
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
											<LampEditor lamp={lamp} room={$room} onClose={() => closeLampEditor(lamp.id)} onCopy={onLampCopied} />
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Zones Summary -->
		<div class="panel" class:collapsed={zonesPanelCollapsed}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="panel-header clickable" role="button" tabindex="0" onclick={() => zonesPanelCollapsed = !zonesPanelCollapsed} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zonesPanelCollapsed = !zonesPanelCollapsed; } }}>
				<span class="collapse-icon">{zonesPanelCollapsed ? '▶' : '▼'}</span>
				<h3 class="mb-0">Calc Zones</h3>
				<span class="status-badge">{$zones.length}</span>
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
			</div>
			{#if !zonesPanelCollapsed}
				<div class="panel-content">
					<button class="secondary" onclick={addNewZone} style="margin-bottom: var(--spacing-sm); width: 100%;">
						Add Zone
					</button>
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
												<CalcTypeIllustration type={zone.type === 'volume' ? 'calc_vol' : 'calc_plane'} size={16} />
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
												<ZoneEditor zone={zone} room={$room} onClose={() => closeZoneEditor(zone.id)} onCopy={onZoneCopied} isStandard={true} />
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
														<CalcTypeIllustration type={zone.type === 'volume' ? 'calc_vol' : 'calc_plane'} size={16} />
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
												<ZoneEditor zone={zone} room={$room} onClose={() => closeZoneEditor(zone.id)} onCopy={onZoneCopied} />
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{:else if !$room.useStandardZones}
						<p class="text-muted" style="font-size: var(--font-size-base);">No zones defined</p>
					{/if}

				</div>
			{/if}
		</div>

	{/snippet}

	{#snippet resultsContent()}
		<ZoneStatsPanel onShowAudit={() => showAuditModal = true} onLampHover={(id) => hoveredLampId = id} />
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
					<RoomViewer room={$room} lamps={$lamps} zones={$zones} zoneResults={$results?.zones} {selectedLampIds} {selectedZoneIds} {highlightedLampIds} {highlightedZoneIds} {visibleLampIds} {visibleZoneIds} onLampClick={handleLampClick} onZoneClick={handleZoneClick} globalValueRange={($room.globalHeatmapNormalization ?? false) ? globalValueRange : null} />
				</div>
			</main>

			<!-- Results panel -->
			<div class="mobile-panel" class:active={activeMobileTab === 'results'}>
				<div class="mobile-panel-scroll">
					{@render resultsContent()}
				</div>
			</div>

			<!-- Fixed calculate button above tab bar (hidden on results tab) -->
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
					<RoomViewer room={$room} lamps={$lamps} zones={$zones} zoneResults={$results?.zones} {selectedLampIds} {selectedZoneIds} {highlightedLampIds} {highlightedZoneIds} {visibleLampIds} {visibleZoneIds} onLampClick={handleLampClick} onZoneClick={handleZoneClick} globalValueRange={($room.globalHeatmapNormalization ?? false) ? globalValueRange : null} />
					<div class="floating-calculate">
						<CalculateButton />
					</div>
				</div>
			</main>

			<ResizablePanel side="right" defaultWidth={420} minWidth={280} maxWidth={600} bind:collapsed={rightPanelCollapsed}>
				{@render resultsContent()}
			</ResizablePanel>
		</div>
	{/if}

	<!-- Status Bar -->
	<StatusBar {guvCalcsVersion} />
</div>

{#if showHelpModal}
	<HelpModal onClose={() => showHelpModal = false} />
{/if}

{#if showAboutModal}
	<AboutModal onClose={() => showAboutModal = false} />
{/if}

{#if showCiteModal}
	<CiteModal onClose={() => showCiteModal = false} />
{/if}

{#if showReflectanceSettings}
	<ReflectanceSettingsModal onClose={() => showReflectanceSettings = false} />
{/if}

{#if showAuditModal}
	<AuditModal onClose={() => showAuditModal = false} />
{/if}

{#if showExploreDataModal}
	<ExploreDataModal
		fluence={exploreDefaultFluence}
		roomX={$room.x}
		roomY={$room.y}
		roomZ={$room.z}
		roomUnits={$room.units}
		airChanges={$room.air_changes || ROOM_DEFAULTS.air_changes}
		onclose={() => showExploreDataModal = false}
		zoneOptions={exploreZoneOptions}
	/>
{/if}

<SyncErrorToast />

{#if showNewProjectConfirm}
	<ConfirmDialog
		title="New Project"
		message="Start a new project? This will clear all current lamps, zones, and results."
		confirmLabel="New Project"
		variant="success"
		onConfirm={() => { showNewProjectConfirm = false; project.reset(); }}
		onCancel={() => showNewProjectConfirm = false}
	/>
{/if}

{#if alertDialog}
	<AlertDialog
		title={alertDialog.title}
		message={alertDialog.message}
		onDismiss={() => alertDialog = null}
	/>
{/if}

{#if pendingDelete}
	<ConfirmDialog
		title="Delete {pendingDelete.type === 'lamp' ? 'Lamp' : 'Zone'}"
		message="Delete {pendingDelete.name}? This cannot be undone."
		confirmLabel="Delete"
		variant="danger"
		onConfirm={() => {
			if (pendingDelete) {
				if (pendingDelete.type === 'lamp') {
					project.removeLamp(pendingDelete.id);
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
		height: 100vh;
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
	}

	.lamp-name-row {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
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
		width: 100%;
		max-width: 150px;
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
		display: block;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
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

	.standard-zone,
	.custom-zones-section .item-list-item {
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		margin-bottom: var(--spacing-xs);
	}

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

	.configure-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-md);
		padding-top: var(--spacing-md);
		padding-bottom: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
		position: sticky;
		top: calc(-1 * var(--spacing-md));
		background: var(--color-bg);
		z-index: 1;
	}

	.configure-header h3 {
		margin: 0;
		font-size: 1rem;
	}

	/* Collapsible panel styles */
	.panel-header.clickable {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		width: 100%;
		background: none;
		border: none;
		padding: 0;
		margin: 0 0 var(--spacing-sm) 0;
		cursor: pointer;
		text-align: left;
		color: inherit;
		font: inherit;
	}

	.panel-header.clickable:hover {
		opacity: 0.8;
	}

	.panel-header.clickable h3 {
		flex: 1;
	}

	.collapse-icon {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		width: 1em;
		text-align: center;
	}

	.panel.collapsed {
		padding-top: var(--spacing-sm);
		padding-bottom: var(--spacing-sm);
	}

	.panel.collapsed .panel-header.clickable {
		margin-bottom: 0;
	}

	.panel-content {
		/* Smooth transition could be added here if desired */
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
		flex-direction: column;
		position: relative;
	}

	.app-container:has(.app-layout.mobile) {
		padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));
	}

	.app-container:has(.mobile-calculate-bar) {
		padding-bottom: calc(56px + 52px + env(safe-area-inset-bottom, 0px));
	}

	.mobile-panel {
		position: absolute;
		inset: 0;
		display: none;
		flex-direction: column;
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

	.main-content.mobile-hidden {
		visibility: hidden;
		position: absolute;
		inset: 0;
		z-index: 1;
	}

	.mobile-calculate-bar {
		position: fixed;
		bottom: calc(56px + env(safe-area-inset-bottom, 0px));
		left: 0;
		right: 0;
		display: flex;
		justify-content: center;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		border-top: 1px solid var(--color-border);
		z-index: 100;
	}

	.mobile-tab-bar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
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
</style>
