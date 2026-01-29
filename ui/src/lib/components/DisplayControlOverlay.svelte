<script lang="ts">
	import type { LampInstance, CalcZone } from '$lib/types/project';

	interface Props {
		lamps: LampInstance[];
		zones: CalcZone[];
		onVisibilityChange: (visibleLampIds: string[], visibleZoneIds: string[]) => void;
	}

	let { lamps, zones, onVisibilityChange }: Props = $props();

	// Layer visibility state
	let lampsLayerVisible = $state(true);
	let zonesLayerVisible = $state(true);

	// Individual item visibility (true = visible, false/undefined = hidden)
	// Using Record for proper Svelte reactivity (Sets don't trigger updates properly)
	let lampVisibility = $state<Record<string, boolean>>({});
	let zoneVisibility = $state<Record<string, boolean>>({});

	// Initialize visibility for new items (default to visible)
	$effect(() => {
		const newLampVis = { ...lampVisibility };
		let changed = false;
		for (const lamp of lamps) {
			if (!(lamp.id in newLampVis)) {
				newLampVis[lamp.id] = true;
				changed = true;
			}
		}
		if (changed) {
			lampVisibility = newLampVis;
		}
	});

	$effect(() => {
		const newZoneVis = { ...zoneVisibility };
		let changed = false;
		for (const zone of zones) {
			if (!(zone.id in newZoneVis)) {
				newZoneVis[zone.id] = true;
				changed = true;
			}
		}
		if (changed) {
			zoneVisibility = newZoneVis;
		}
	});

	// Compute visible IDs based on layer and individual visibility
	const visibleLampIds = $derived(
		lampsLayerVisible
			? lamps.filter(l => lampVisibility[l.id] !== false).map(l => l.id)
			: []
	);

	const visibleZoneIds = $derived(
		zonesLayerVisible
			? zones.filter(z => zoneVisibility[z.id] !== false).map(z => z.id)
			: []
	);

	// Notify parent of visibility changes
	$effect(() => {
		onVisibilityChange(visibleLampIds, visibleZoneIds);
	});

	// Get display name for lamp
	function getLampName(lamp: LampInstance): string {
		return lamp.name || 'New Lamp';
	}

	// Get display name for zone
	function getZoneName(zone: CalcZone): string {
		return zone.name || zone.id.slice(0, 8);
	}

	// Toggle individual lamp visibility
	function toggleLamp(lampId: string) {
		lampVisibility = {
			...lampVisibility,
			[lampId]: !lampVisibility[lampId]
		};
	}

	// Toggle individual zone visibility
	function toggleZone(zoneId: string) {
		zoneVisibility = {
			...zoneVisibility,
			[zoneId]: !zoneVisibility[zoneId]
		};
	}
</script>

<details class="display-overlay">
	<summary class="overlay-summary">Display</summary>

	<div class="overlay-content">
		{#if lamps.length > 0}
			<div class="section">
				<label class="layer-toggle">
					<input
						type="checkbox"
						bind:checked={lampsLayerVisible}
					/>
					<span class="layer-label">Lamps</span>
				</label>
				<div class="items-list">
					{#each lamps as lamp (lamp.id)}
						<label class="item-toggle">
							<input
								type="checkbox"
								checked={lampsLayerVisible && lampVisibility[lamp.id] !== false}
								disabled={!lampsLayerVisible}
								onchange={() => toggleLamp(lamp.id)}
							/>
							<span class="item-label" class:disabled={!lampsLayerVisible}>
								{getLampName(lamp)}
							</span>
						</label>
					{/each}
				</div>
			</div>
		{/if}

		{#if zones.length > 0}
			<div class="section">
				<label class="layer-toggle">
					<input
						type="checkbox"
						bind:checked={zonesLayerVisible}
					/>
					<span class="layer-label">CalcZones</span>
				</label>
				<div class="items-list">
					{#each zones as zone (zone.id)}
						<label class="item-toggle">
							<input
								type="checkbox"
								checked={zonesLayerVisible && zoneVisibility[zone.id] !== false}
								disabled={!zonesLayerVisible}
								onchange={() => toggleZone(zone.id)}
							/>
							<span class="item-label" class:disabled={!zonesLayerVisible}>
								{getZoneName(zone)}
								{#if zone.isStandard}
									<span class="standard-badge">std</span>
								{/if}
							</span>
						</label>
					{/each}
				</div>
			</div>
		{/if}

		{#if lamps.length === 0 && zones.length === 0}
			<div class="empty-message">No items to display</div>
		{/if}
	</div>
</details>

<style>
	.display-overlay {
		position: absolute;
		top: var(--spacing-sm);
		left: var(--spacing-sm);
		z-index: 10;
		background: color-mix(in srgb, var(--color-bg-secondary) 85%, transparent);
		backdrop-filter: blur(4px);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.8rem;
		max-width: 200px;
		max-height: 300px;
		overflow-y: auto;
	}

	.overlay-summary {
		padding: var(--spacing-xs) var(--spacing-sm);
		cursor: pointer;
		font-weight: 500;
		color: var(--color-text);
		user-select: none;
		list-style: none;
	}

	.overlay-summary::-webkit-details-marker {
		display: none;
	}

	.overlay-summary::before {
		content: '>';
		display: inline-block;
		margin-right: var(--spacing-xs);
		transition: transform 0.15s;
	}

	details[open] .overlay-summary::before {
		transform: rotate(90deg);
	}

	.overlay-content {
		padding: 0 var(--spacing-sm) var(--spacing-sm);
	}

	.section {
		margin-top: var(--spacing-xs);
	}

	.section:first-child {
		margin-top: 0;
	}

	.layer-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		padding: var(--spacing-xs) 0;
	}

	.layer-label {
		font-weight: 500;
		color: var(--color-text);
	}

	.items-list {
		padding-left: 0;
	}

	.item-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		padding: 2px 0;
	}

	.item-label {
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.item-label.disabled {
		color: var(--color-text-muted);
	}

	.standard-badge {
		font-size: 0.65rem;
		background: var(--color-accent);
		color: white;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		font-weight: 500;
	}

	.empty-message {
		color: var(--color-text-muted);
		font-style: italic;
		padding: var(--spacing-xs) 0;
	}

	input[type="checkbox"] {
		margin: 0;
		cursor: pointer;
	}

	input[type="checkbox"]:disabled {
		cursor: not-allowed;
	}
</style>
