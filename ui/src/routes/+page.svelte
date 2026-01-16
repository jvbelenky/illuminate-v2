<script lang="ts">
	import { project, room, lamps, zones, results } from '$lib/stores/project';
	import { onMount } from 'svelte';
	import RoomViewer from '$lib/components/RoomViewer.svelte';
	import LampEditor from '$lib/components/LampEditor.svelte';
	import ZoneEditor from '$lib/components/ZoneEditor.svelte';
	import CalculateButton from '$lib/components/CalculateButton.svelte';
	import ZoneStatsPanel from '$lib/components/ZoneStatsPanel.svelte';
	import ResizablePanel from '$lib/components/ResizablePanel.svelte';
	import type { LampInstance, CalcZone } from '$lib/types/project';
	import { defaultLamp, defaultZone } from '$lib/types/project';

	let hasRecoveredData = $state(false);
	let editingLamps = $state<Record<string, boolean>>({});
	let editingZones = $state<Record<string, boolean>>({});
	let leftPanelCollapsed = $state(false);
	let rightPanelCollapsed = $state(true); // Collapsed by default
	let hasEverCalculated = $state(false);

	// Separate standard zones from custom zones
	const standardZonesList = $derived($zones.filter(z => z.isStandard));
	const customZonesList = $derived($zones.filter(z => !z.isStandard));

	function toggleLampEditor(lampId: string) {
		editingLamps = { ...editingLamps, [lampId]: !editingLamps[lampId] };
	}

	function closeLampEditor(lampId: string) {
		editingLamps = { ...editingLamps, [lampId]: false };
	}

	function toggleZoneEditor(zoneId: string) {
		editingZones = { ...editingZones, [zoneId]: !editingZones[zoneId] };
	}

	function closeZoneEditor(zoneId: string) {
		editingZones = { ...editingZones, [zoneId]: false };
	}

	// Auto-expand right panel on first calculation
	$effect(() => {
		if ($results && !hasEverCalculated) {
			hasEverCalculated = true;
			rightPanelCollapsed = false;
		}
	});

	onMount(() => {
		// Check if we restored non-default data
		const p = $project;
		if (p.lamps.length > 0 || p.zones.length > 0) {
			hasRecoveredData = true;
		}
		// If we have results from a previous session, keep the panel open
		if (p.results) {
			hasEverCalculated = true;
			rightPanelCollapsed = false;
		}
	});

	function dismissRecovery() {
		hasRecoveredData = false;
	}

	function startFresh() {
		if (confirm('Start a new project? This will clear all current lamps, zones, and results.')) {
			project.reset();
			hasRecoveredData = false;
		}
	}

	function handleDimensionChange(dim: 'x' | 'y' | 'z', event: Event) {
		const target = event.target as HTMLInputElement;
		project.updateRoom({ [dim]: parseFloat(target.value) || 0 });
	}

	function handleUnitChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		project.updateRoom({ units: target.value as 'meters' | 'feet' });
	}

	function handleStandardChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		project.updateRoom({ standard: target.value as 'ACGIH' | 'ACGIH-UL8802' | 'ICNIRP' });
	}

	function saveToFile() {
		const data = JSON.stringify(project.export(), null, 2);
		const blob = new Blob([data], { type: 'application/json' });
		const url = URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.href = url;
		a.download = `${$project.name.replace(/\s+/g, '_')}.guv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function loadFromFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const text = await file.text();
		try {
			const data = JSON.parse(text);
			project.loadFromFile(data);
		} catch (e) {
			alert('Failed to load file: invalid format');
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
			<h1>Illuminate</h1>
			<span class="text-muted">UV Disinfection</span>
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
		<ResizablePanel side="left" defaultWidth={380} minWidth={280} maxWidth={500} bind:collapsed={leftPanelCollapsed}>
			<!-- Room Configuration -->
		<div class="panel">
			<div class="panel-header">
				<h3 class="mb-0">Room</h3>
			</div>

			<div class="form-group">
				<label>Dimensions ({$room.units})</label>
				<div class="form-row">
					<div>
						<input
							type="number"
							value={$room.x}
							onchange={(e) => handleDimensionChange('x', e)}
							min="0"
							step="0.1"
							placeholder="X"
						/>
					</div>
					<div>
						<input
							type="number"
							value={$room.y}
							onchange={(e) => handleDimensionChange('y', e)}
							min="0"
							step="0.1"
							placeholder="Y"
						/>
					</div>
					<div>
						<input
							type="number"
							value={$room.z}
							onchange={(e) => handleDimensionChange('z', e)}
							min="0"
							step="0.1"
							placeholder="Z"
						/>
					</div>
				</div>
			</div>

			<div class="form-group">
				<label for="units">Units</label>
				<select id="units" value={$room.units} onchange={handleUnitChange}>
					<option value="meters">Meters</option>
					<option value="feet">Feet</option>
				</select>
			</div>

			<div class="form-group">
				<label for="standard">Safety Standard</label>
				<select id="standard" value={$room.standard} onchange={handleStandardChange}>
					<option value="ACGIH">ACGIH</option>
					<option value="ACGIH-UL8802">ACGIH-UL8802</option>
					<option value="ICNIRP">ICNIRP</option>
				</select>
			</div>
		</div>

		<!-- Lamps Summary -->
		<div class="panel">
			<div class="panel-header">
				<h3 class="mb-0">Lamps</h3>
				<span class="status-badge">{$lamps.length}</span>
			</div>
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
								<div>
									<span>{lamp.name || lamp.preset_id || 'New Lamp'}</span>
									{#if !lamp.preset_id}
										<span class="needs-config">needs configuration</span>
									{/if}
								</div>
								<span class="text-muted" style="font-size: 0.75rem;">
									{lamp.lamp_type === 'krcl_222' ? '222nm' : '254nm'}
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
			<button onclick={addNewLamp} style="margin-top: var(--spacing-sm); width: 100%;">
				Add Lamp
			</button>
		</div>

		<!-- Zones Summary -->
		<div class="panel">
			<div class="panel-header">
				<h3 class="mb-0">Calc Zones</h3>
				<span class="status-badge">{$zones.length}</span>
			</div>

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
									<span>{zone.name || zone.id.slice(0, 8)}</span>
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

			<button onclick={addNewZone} style="margin-top: var(--spacing-sm); width: 100%;">
				Add Zone
			</button>
		</div>
	</ResizablePanel>

	<main class="main-content">
		<div class="viewer-wrapper">
			<RoomViewer room={$room} lamps={$lamps} zones={$zones} zoneResults={$results?.zones} />
		</div>
		<div class="status-bar">
			<span>Room: {$room.x} x {$room.y} x {$room.z} {$room.units}</span>
			<span>Lamps: {$lamps.length}</span>
			<span>Zones: {$zones.length}</span>
			{#if $results}
				<span class="text-muted">
					Calculated: {new Date($results.calculatedAt).toLocaleString()}
				</span>
			{/if}
			{#if hasRecoveredData}
				<span class="recovered-notice" onclick={dismissRecovery}>
					Session restored from local storage
				</span>
			{/if}
		</div>
	</main>

		<ResizablePanel side="right" defaultWidth={360} minWidth={280} maxWidth={500} bind:collapsed={rightPanelCollapsed}>
			<ZoneStatsPanel />
		</ResizablePanel>
	</div>
</div>

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
		align-items: baseline;
		gap: var(--spacing-sm);
		flex: 0 0 auto;
	}

	.ribbon-left h1 {
		margin: 0;
		font-size: 1.5rem;
	}

	.ribbon-left .text-muted {
		font-size: 0.8rem;
	}

	.ribbon-center {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
	}

	.ribbon-right {
		display: flex;
		align-items: center;
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
		overflow: hidden;
	}

	.recovered-notice {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-style: italic;
		cursor: pointer;
		opacity: 0.7;
		transition: opacity 0.15s;
	}

	.recovered-notice:hover {
		opacity: 1;
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
		min-height: 300px;
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.status-bar {
		display: flex;
		gap: var(--spacing-lg);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-md);
		margin-top: var(--spacing-md);
		font-family: var(--font-mono);
		font-size: 0.875rem;
	}

	.main-content {
		display: flex;
		flex-direction: column;
	}

	.needs-config {
		display: block;
		font-size: 0.7rem;
		color: #f59e0b;
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
		gap: var(--spacing-xs);
	}

	.standard-badge {
		font-size: 0.6rem;
		padding: 1px 4px;
		background: var(--color-primary);
		color: white;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
</style>
