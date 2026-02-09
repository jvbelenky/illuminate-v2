<script lang="ts">
	import { project, room, lamps, zones, results, syncErrors } from '$lib/stores/project';
	import { onMount, tick } from 'svelte';
	import RoomViewer from '$lib/components/RoomViewer.svelte';
	import RoomEditor from '$lib/components/RoomEditor.svelte';
	import LampEditor from '$lib/components/LampEditor.svelte';
	import ZoneEditor from '$lib/components/ZoneEditor.svelte';
	import CalculateButton from '$lib/components/CalculateButton.svelte';
	import ZoneStatsPanel from '$lib/components/ZoneStatsPanel.svelte';
	import ResizablePanel from '$lib/components/ResizablePanel.svelte';
	import HelpModal from '$lib/components/HelpModal.svelte';
	import AboutModal from '$lib/components/AboutModal.svelte';
	import DisplaySettingsModal from '$lib/components/DisplaySettingsModal.svelte';
	import AuditModal from '$lib/components/AuditModal.svelte';
	import SyncErrorToast from '$lib/components/SyncErrorToast.svelte';
	import MenuBar from '$lib/components/MenuBar.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import { getVersion, saveSession, loadSession, getLampPresets } from '$lib/api/client';
	import type { LampInstance, CalcZone } from '$lib/types/project';
	import { defaultLamp, defaultZone } from '$lib/types/project';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';

	// Lamp display names - fetched from API on mount
	let lampDisplayNames = $state<Record<string, string>>({});

	function getLampDisplayId(lamp: LampInstance): string {
		if (lamp.preset_id && lamp.preset_id !== 'custom') {
			return lampDisplayNames[lamp.preset_id] || lamp.preset_id;
		}
		return lamp.ies_filename || 'Custom';
	}

	let showHelpModal = $state(false);
	let showAboutModal = $state(false);
	let showDisplaySettings = $state(false);
	let showAuditModal = $state(false);
	let guvCalcsVersion = $state<string | null>(null);
	let editingLamps = $state<Record<string, boolean>>({});
	let editingZones = $state<Record<string, boolean>>({});
	let leftPanelCollapsed = $state(false);
	let rightPanelCollapsed = $state(true); // Collapsed by default
	let hasEverCalculated = $state(false);
	let editingLampName: string | null = $state(null); // ID of lamp being renamed
	let editingZoneName: string | null = $state(null); // ID of zone being renamed

	// Dialog state
	let showNewProjectConfirm = $state(false);
	let alertDialog = $state<{ title: string; message: string } | null>(null);

	// Collapsible panel sections
	let roomPanelCollapsed = $state(false);
	let lampsPanelCollapsed = $state(false);
	let zonesPanelCollapsed = $state(false);

	// Separate standard zones from custom zones
	const standardZonesList = $derived($zones.filter(z => z.isStandard));
	const customZonesList = $derived($zones.filter(z => !z.isStandard));

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

	function toggleLampEditor(lampId: string) {
		const wasOpen = editingLamps[lampId];
		editingLamps = { ...editingLamps, [lampId]: !wasOpen };
		if (wasOpen && sceneSelection?.type === 'lamp' && sceneSelection.id === lampId) {
			sceneSelection = null;
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
			editingLamps = { ...editingLamps, [lampId]: true };
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
		editingZones = { ...editingZones, [zoneId]: !wasOpen };
		if (wasOpen && sceneSelection?.type === 'zone' && sceneSelection.id === zoneId) {
			sceneSelection = null;
		}
	}

	function closeZoneEditor(zoneId: string) {
		editingZones = { ...editingZones, [zoneId]: false };
		if (sceneSelection?.type === 'zone' && sceneSelection.id === zoneId) {
			sceneSelection = null;
		}
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

		// Close previous selection's editor
		if (prev && prevStillOpen) {
			if (prev.type === 'lamp') {
				editingLamps = { ...editingLamps, [prev.id]: false };
			} else {
				editingZones = { ...editingZones, [prev.id]: false };
			}
		}

		sceneSelection = next;

		if (next) {
			leftPanelCollapsed = false;
			if (next.type === 'lamp') {
				lampsPanelCollapsed = false;
				editingLamps = { ...editingLamps, [next.id]: true };
			} else {
				zonesPanelCollapsed = false;
				editingZones = { ...editingZones, [next.id]: true };
			}
			await tick();
			const sel = next.type === 'lamp'
				? `[data-lamp-id="${next.id}"]`
				: `[data-zone-id="${next.id}"]`;
			document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
	}

	function startZoneRename(zoneId: string) {
		editingZoneName = zoneId;
		// Ensure the zone editor is expanded (don't collapse if already expanded)
		if (!editingZones[zoneId]) {
			editingZones = { ...editingZones, [zoneId]: true };
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

	onMount(async () => {
		// If we have results from a previous session, keep the panel open
		const p = $project;
		if (p.results) {
			hasEverCalculated = true;
			rightPanelCollapsed = false;
		}

		// Fetch lamp presets for display names (non-blocking)
		getLampPresets().then((presets) => {
			const names: Record<string, string> = {};
			for (const preset of presets) {
				if (preset.id !== 'custom') {
					names[preset.id] = preset.name;
				}
			}
			lampDisplayNames = names;
		}).catch((e) => {
			console.warn('Failed to fetch lamp presets:', e);
		});

		// Fetch version info
		try {
			const versionInfo = await getVersion();
			guvCalcsVersion = versionInfo.guv_calcs_version;
		} catch (e) {
			console.warn('Failed to fetch version:', e);
		}

		// Initialize backend session with current project state
		try {
			await project.initSession();
		} catch (e) {
			console.warn('Failed to initialize session:', e);
			syncErrors.add('Session initialization', e, 'warning');
		}
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
		const id = project.addLamp(newLamp);
		// Ensure the panel and section are visible
		leftPanelCollapsed = false;
		lampsPanelCollapsed = false;
		// Open the editor for the new lamp
		editingLamps = { ...editingLamps, [id]: true };
		// Scroll to the new lamp after DOM updates
		await tick();
		document.querySelector(`[data-lamp-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	async function addNewZone() {
		// Add a new zone with default settings (user will configure in editor)
		const newZone = defaultZone($room, $zones.length);
		const id = project.addZone(newZone);
		// Ensure the panel and section are visible
		leftPanelCollapsed = false;
		zonesPanelCollapsed = false;
		// Open the editor for the new zone
		editingZones = { ...editingZones, [id]: true };
		// Scroll to the new zone after DOM updates
		await tick();
		document.querySelector(`[data-zone-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
		onShowDisplaySettings={() => showDisplaySettings = true}
		onShowAudit={() => showAuditModal = true}
		onShowHelp={() => showHelpModal = true}
		onShowAbout={() => showAboutModal = true}
		{leftPanelCollapsed}
		{rightPanelCollapsed}
		onToggleLeftPanel={() => leftPanelCollapsed = !leftPanelCollapsed}
		onToggleRightPanel={() => rightPanelCollapsed = !rightPanelCollapsed}
		showDimensions={$room.showDimensions ?? true}
		onToggleShowDimensions={() => project.updateRoom({ showDimensions: !($room.showDimensions ?? true) })}
	/>

	<!-- Main Layout -->
	<div class="app-layout">
		<ResizablePanel side="left" defaultWidth={420} minWidth={320} maxWidth={550} bind:collapsed={leftPanelCollapsed}>
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
					<RoomEditor />
				</div>
			{/if}
		</div>

		<!-- Lamps Summary -->
		<div class="panel" class:collapsed={lampsPanelCollapsed}>
			<button class="panel-header clickable" onclick={() => lampsPanelCollapsed = !lampsPanelCollapsed}>
				<span class="collapse-icon">{lampsPanelCollapsed ? '▶' : '▼'}</span>
				<h3 class="mb-0">Lamps</h3>
				<span class="status-badge">{$lamps.length}</span>
			</button>
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
								<li class="item-list-item" data-lamp-id={lamp.id}>
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
											{/if}
										</div>
										<span class="lamp-id">
											{getLampDisplayId(lamp)}
										</span>
									</div>
									{#if editingLamps[lamp.id]}
										<div class="inline-editor">
											<LampEditor lamp={lamp} room={$room} onClose={() => closeLampEditor(lamp.id)} />
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
			<button class="panel-header clickable" onclick={() => zonesPanelCollapsed = !zonesPanelCollapsed}>
				<span class="collapse-icon">{zonesPanelCollapsed ? '▶' : '▼'}</span>
				<h3 class="mb-0">Calc Zones</h3>
				<span class="status-badge">{$zones.length}</span>
			</button>
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
									<li class="item-list-item standard-zone" data-zone-id={zone.id}>
										<div
											class="item-list-row clickable"
											class:expanded={editingZones[zone.id]}
											onclick={() => toggleZoneEditor(zone.id)}
											onmouseenter={() => hoveredZoneId = zone.id}
											onmouseleave={() => { if (hoveredZoneId === zone.id) hoveredZoneId = null; }}
										>
											<div class="zone-name-row">
												<span>{zone.name || zone.id}</span>
												<span class="standard-badge">standard</span>
											</div>
											<span class="text-muted">{zone.type}</span>
										</div>
										{#if editingZones[zone.id]}
											<div class="inline-editor">
												<ZoneEditor zone={zone} room={$room} onClose={() => closeZoneEditor(zone.id)} isStandard={true} />
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
									<li class="item-list-item" data-zone-id={zone.id}>
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
											<span class="text-muted">{zone.type}</span>
										</div>
										{#if editingZones[zone.id]}
											<div class="inline-editor">
												<ZoneEditor zone={zone} room={$room} onClose={() => closeZoneEditor(zone.id)} />
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
	</ResizablePanel>

	<main class="main-content">
		<div class="viewer-wrapper">
			<RoomViewer room={$room} lamps={$lamps} zones={$zones} zoneResults={$results?.zones} {selectedLampIds} {selectedZoneIds} {highlightedLampIds} {highlightedZoneIds} onLampClick={handleLampClick} onZoneClick={handleZoneClick} />
			<div class="floating-calculate">
				<CalculateButton />
			</div>
		</div>
	</main>

		<ResizablePanel side="right" defaultWidth={420} minWidth={280} maxWidth={600} bind:collapsed={rightPanelCollapsed}>
			<ZoneStatsPanel onShowAudit={() => showAuditModal = true} />
		</ResizablePanel>
	</div>

	<!-- Status Bar -->
	<StatusBar {guvCalcsVersion} />
</div>

{#if showHelpModal}
	<HelpModal onClose={() => showHelpModal = false} />
{/if}

{#if showAboutModal}
	<AboutModal onClose={() => showAboutModal = false} />
{/if}

{#if showDisplaySettings}
	<DisplaySettingsModal onClose={() => showDisplaySettings = false} />
{/if}

{#if showAuditModal}
	<AuditModal onClose={() => showAuditModal = false} />
{/if}

<SyncErrorToast />

{#if showNewProjectConfirm}
	<ConfirmDialog
		title="New Project"
		message="Start a new project? This will clear all current lamps, zones, and results."
		confirmLabel="New Project"
		variant="warning"
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
		top: var(--spacing-md);
		right: var(--spacing-md);
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

	.lamp-id {
		flex-shrink: 0;
		max-width: 45%;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: right;
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

	.standard-zone {
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		margin-bottom: var(--spacing-xs);
	}

	.standard-zone .item-list-row {
		margin: 0;
	}

	.zone-name-row {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
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
</style>
