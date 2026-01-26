<script lang="ts">
	import { project, room, lamps, zones, results } from '$lib/stores/project';
	import { onMount } from 'svelte';
	import RoomViewer from '$lib/components/RoomViewer.svelte';
	import RoomEditor from '$lib/components/RoomEditor.svelte';
	import LampEditor from '$lib/components/LampEditor.svelte';
	import ZoneEditor from '$lib/components/ZoneEditor.svelte';
	import CalculateButton from '$lib/components/CalculateButton.svelte';
	import ZoneStatsPanel from '$lib/components/ZoneStatsPanel.svelte';
	import ResizablePanel from '$lib/components/ResizablePanel.svelte';
	import HelpModal from '$lib/components/HelpModal.svelte';
	import DisplaySettingsModal from '$lib/components/DisplaySettingsModal.svelte';
	import SyncErrorToast from '$lib/components/SyncErrorToast.svelte';
	import { getVersion, saveSession, loadSession } from '$lib/api/client';
	import type { LampInstance, CalcZone } from '$lib/types/project';
	import { defaultLamp, defaultZone } from '$lib/types/project';
	import { theme } from '$lib/stores/theme';

	// Display names for lamp presets
	const LAMP_DISPLAY_NAMES: Record<string, string> = {
		aerolamp: 'Aerolamp DevKit',
		beacon: 'Beacon',
		lumenizer_zone: 'Lumenizer Zone',
		nukit_lantern: 'NuKit Lantern',
		nukit_torch: 'NuKit Torch',
		sterilray: 'Sterilray',
		ushio_b1: 'Ushio B1',
		'ushio_b1.5': 'Ushio B1.5',
		uvpro222_b1: 'UVPro222 B1',
		uvpro222_b2: 'UVPro222 B2',
		visium: 'Visium',
	};

	function getLampDisplayId(lamp: LampInstance): string {
		if (lamp.preset_id && lamp.preset_id !== 'custom') {
			return LAMP_DISPLAY_NAMES[lamp.preset_id] || lamp.preset_id;
		}
		return lamp.ies_filename || 'Custom';
	}

	let showHelpModal = $state(false);
	let showDisplaySettings = $state(false);
	let guvCalcsVersion = $state<string | null>(null);
	let editingLamps = $state<Record<string, boolean>>({});
	let editingZones = $state<Record<string, boolean>>({});
	let leftPanelCollapsed = $state(false);
	let rightPanelCollapsed = $state(true); // Collapsed by default
	let hasEverCalculated = $state(false);
	let editingLampName: string | null = $state(null); // ID of lamp being renamed
	let editingZoneName: string | null = $state(null); // ID of zone being renamed

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

	function toggleLampEditor(lampId: string) {
		editingLamps = { ...editingLamps, [lampId]: !editingLamps[lampId] };
	}

	function closeLampEditor(lampId: string) {
		editingLamps = { ...editingLamps, [lampId]: false };
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
		editingZones = { ...editingZones, [zoneId]: !editingZones[zoneId] };
	}

	function closeZoneEditor(zoneId: string) {
		editingZones = { ...editingZones, [zoneId]: false };
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
			// Session will be retried on next interaction if needed
		}
	});

	function startFresh() {
		if (confirm('Start a new project? This will clear all current lamps, zones, and results.')) {
			project.reset();
		}
	}

	async function saveToFile() {
		try {
			// Use Room.save() via the API to get proper .guv format
			const guvContent = await saveSession();
			const blob = new Blob([guvContent], { type: 'application/json' });
			const url = URL.createObjectURL(blob);

			const a = document.createElement('a');
			a.href = url;
			a.download = `${$project.name.replace(/\s+/g, '_')}.guv`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			console.error('Save failed:', e);
			alert('Failed to save file. Make sure the session is initialized.');
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
			// Use Room.load() via the API to parse the .guv file
			const response = await loadSession(guvData);
			if (response.success) {
				// Update the frontend store with the loaded state
				project.loadFromApiResponse(response, projectName);
			} else {
				alert('Failed to load file: ' + response.message);
			}
		} catch (e) {
			console.error('Load failed:', e);
			alert('Failed to load file: invalid format or server error');
		}
		input.value = '';
	}

	function addNewLamp() {
		// Add a new lamp with default settings (user will configure in editor)
		// Pass existing lamps so position is calculated to maximize distance from them
		const newLamp = defaultLamp($room, $lamps);
		newLamp.name = `Lamp ${$lamps.length + 1}`;
		const id = project.addLamp(newLamp);
		// Open the editor for the new lamp
		editingLamps = { ...editingLamps, [id]: true };
	}

	function addNewZone() {
		// Add a new zone with default settings (user will configure in editor)
		const newZone = defaultZone($room, $zones.length);
		const id = project.addZone(newZone);
		// Open the editor for the new zone
		editingZones = { ...editingZones, [id]: true };
	}
</script>

<div class="app-container">
	<!-- Top Ribbon -->
	<header class="top-ribbon">
		<div class="ribbon-left">
			<h1>Illuminate v2</h1>
			<button class="round-btn theme-toggle" onclick={() => theme.toggle()} title={$theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
				{#if $theme === 'dark'}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="5"/>
						<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
					</svg>
				{:else}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
					</svg>
				{/if}
			</button>
			<button class="pill-btn" onclick={() => showDisplaySettings = true}>
				Display Settings
			</button>
			<button class="pill-btn" onclick={() => showHelpModal = true}>
				Help
			</button>
		</div>
		<div class="ribbon-center">
			<span class="ribbon-label">Project</span>
			<input
				id="project-name"
				type="text"
				class="ribbon-input"
				value={$project.name}
				onchange={(e) => project.setName((e.target as HTMLInputElement).value)}
			/>
			<div class="ribbon-actions">
				<button class="secondary" onclick={saveToFile}>Save</button>
				<button class="secondary" onclick={() => document.getElementById('load-file')?.click()}>
					Load
				</button>
				<input
					id="load-file"
					type="file"
					accept=".guv"
					onchange={loadFromFile}
					style="display: none;"
				/>
				<button class="secondary" onclick={startFresh}>New</button>
			</div>
		</div>
		<div class="ribbon-right">
			<CalculateButton />
		</div>
	</header>

	<!-- Main Layout -->
	<div class="app-layout">
		<ResizablePanel side="left" defaultWidth={420} minWidth={320} maxWidth={550} bind:collapsed={leftPanelCollapsed}>
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
					{#if $lamps.length === 0}
						<p class="text-muted" style="font-size: 0.875rem;">No lamps added yet</p>
					{:else}
						<ul class="item-list">
							{#each $lamps as lamp (lamp.id)}
								<li class="item-list-item">
									<div
										class="item-list-row clickable"
										class:expanded={editingLamps[lamp.id]}
										onclick={() => toggleLampEditor(lamp.id)}
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
					<button class="secondary" onclick={addNewLamp} style="margin-top: var(--spacing-sm); width: 100%;">
						Add Lamp
					</button>
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
					<!-- Standard Zones Toggle -->
					<div class="standard-zones-toggle">
						<label class="checkbox-label">
							<input
								type="checkbox"
								checked={$room.useStandardZones}
								onchange={(e) => project.updateRoom({ useStandardZones: (e.target as HTMLInputElement).checked })}
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
									<li class="item-list-item standard-zone">
										<div
											class="item-list-row clickable"
											class:expanded={editingZones[zone.id]}
											onclick={() => toggleZoneEditor(zone.id)}
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
									<li class="item-list-item">
										<div
											class="item-list-row clickable"
											class:expanded={editingZones[zone.id]}
											onclick={() => toggleZoneEditor(zone.id)}
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
						<p class="text-muted" style="font-size: 0.875rem;">No zones defined</p>
					{/if}

					<button class="secondary" onclick={addNewZone} style="margin-top: var(--spacing-sm); width: 100%;">
						Add Zone
					</button>
				</div>
			{/if}
		</div>
	</ResizablePanel>

	<main class="main-content">
		<div class="viewer-wrapper">
			<RoomViewer room={$room} lamps={$lamps} zones={$zones} zoneResults={$results?.zones} {selectedLampIds} {selectedZoneIds} />
		</div>
		<div class="status-bar">
			{#if $results}
				<span class="text-muted">
					Calculated: {new Date($results.calculatedAt).toLocaleString()}
				</span>
			{/if}
			{#if guvCalcsVersion}
				<span class="version-info">guv-calcs {guvCalcsVersion}</span>
			{/if}
		</div>
	</main>

		<ResizablePanel side="right" defaultWidth={420} minWidth={280} maxWidth={600} bind:collapsed={rightPanelCollapsed}>
			<ZoneStatsPanel />
		</ResizablePanel>
	</div>
</div>

{#if showHelpModal}
	<HelpModal onClose={() => showHelpModal = false} />
{/if}

{#if showDisplaySettings}
	<DisplaySettingsModal onClose={() => showDisplaySettings = false} />
{/if}

<SyncErrorToast />

<style>
	.app-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}

	.top-ribbon {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-sm) var(--spacing-lg);
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.ribbon-left {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex: 0 0 auto;
	}

	.ribbon-left h1 {
		margin: 0;
		font-size: 1.25rem;
		line-height: 1;
		display: flex;
		align-items: center;
	}

	.ribbon-left .text-muted {
		font-size: 0.8rem;
	}

	.pill-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 4px 12px;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.pill-btn:hover {
		background: var(--color-bg);
		color: var(--color-text);
		border-color: var(--color-text-muted);
	}

	.round-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		width: 26px;
		height: 26px;
		padding: 0;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
	}

	.round-btn:hover {
		background: var(--color-bg);
		color: var(--color-text);
		border-color: var(--color-text-muted);
	}

	.round-btn svg {
		display: block;
	}

	.ribbon-center {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
	}

	.ribbon-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex: 0 0 auto;
	}

	.ribbon-label {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.ribbon-input {
		width: 180px;
		padding: 6px var(--spacing-sm);
		font-size: 0.85rem;
	}

	.ribbon-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.ribbon-actions button {
		padding: 6px var(--spacing-md);
		font-size: 0.85rem;
	}

	.app-layout {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.version-info {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-text-muted);
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
	}

	.status-bar {
		display: flex;
		align-items: center;
		gap: var(--spacing-lg);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-md);
		margin-top: var(--spacing-md);
		font-family: var(--font-mono);
		font-size: 0.875rem;
		flex-shrink: 0;
	}

	.main-content {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-height: 0;
	}

	.needs-config {
		display: block;
		font-size: 0.7rem;
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
		font-size: 0.75rem;
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
		font-size: 0.875rem;
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
		margin: 0;
	}

	.section-label {
		display: block;
		font-size: 0.7rem;
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
		font-size: 0.6rem;
		padding: 1px 4px;
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.03em;
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
		font-size: 0.7rem;
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
