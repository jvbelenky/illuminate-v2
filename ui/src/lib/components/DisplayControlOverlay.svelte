<script lang="ts">
	import { onMount } from 'svelte';
	import type { LampInstance, CalcZone } from '$lib/types/project';
	import { enterToggle } from '$lib/actions/enterToggle';

	interface Props {
		lamps: LampInstance[];
		zones: CalcZone[];
		onVisibilityChange: (visibleLampIds: string[], visibleZoneIds: string[]) => void;
		onCalcToggle: (type: 'lamp' | 'zone', id: string, enabled: boolean) => void;
	}

	let { lamps, zones, onVisibilityChange, onCalcToggle }: Props = $props();

	// Expand/collapse state
	let expanded = $state(false);

	// Panel dimensions for resize (only applied after user drags a handle)
	let panelWidth = $state(280);
	let panelHeight = $state(300);
	let userResized = $state(false);
	let isDragging = $state(false);
	let dragType = $state<'right' | 'bottom' | 'corner' | null>(null);

	// Dimension constraints
	const MIN_WIDTH = 200;
	const MAX_WIDTH = 500;
	const MIN_HEIGHT = 120;
	const MAX_HEIGHT = 600;

	// Layer visibility state
	let lampsLayerVisible = $state(true);
	let zonesLayerVisible = $state(true);

	// Individual item visibility
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

	function getLampName(lamp: LampInstance): string {
		return lamp.name || 'New Lamp';
	}

	function getZoneName(zone: CalcZone): string {
		return zone.name || zone.id.slice(0, 8);
	}

	function toggleLamp(lampId: string) {
		lampVisibility = {
			...lampVisibility,
			[lampId]: !lampVisibility[lampId]
		};
	}

	function toggleZone(zoneId: string) {
		zoneVisibility = {
			...zoneVisibility,
			[zoneId]: !zoneVisibility[zoneId]
		};
	}

	// --- Resize handlers ---
	function startDrag(type: 'right' | 'bottom' | 'corner') {
		return (e: MouseEvent) => {
			// On first drag, capture current auto-sized dimensions as starting point
			if (!userResized && panelElement) {
				const rect = panelElement.getBoundingClientRect();
				panelWidth = rect.width;
				panelHeight = rect.height;
				userResized = true;
			}
			isDragging = true;
			dragType = type;
			e.preventDefault();
			document.addEventListener('mousemove', onDrag);
			document.addEventListener('mouseup', stopDrag);
			if (type === 'right' || type === 'corner') {
				document.body.style.cursor = type === 'corner' ? 'nwse-resize' : 'ew-resize';
			} else {
				document.body.style.cursor = 'ns-resize';
			}
			document.body.style.userSelect = 'none';
		};
	}

	let panelElement: HTMLElement | undefined;

	function onDrag(e: MouseEvent) {
		if (!isDragging || !panelElement) return;
		const rect = panelElement.getBoundingClientRect();

		if (dragType === 'right' || dragType === 'corner') {
			const newWidth = e.clientX - rect.left;
			panelWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
		}
		if (dragType === 'bottom' || dragType === 'corner') {
			const newHeight = e.clientY - rect.top;
			panelHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));
		}
	}

	function stopDrag() {
		isDragging = false;
		dragType = null;
		document.removeEventListener('mousemove', onDrag);
		document.removeEventListener('mouseup', stopDrag);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}

	onMount(() => {
		return () => {
			document.removeEventListener('mousemove', onDrag);
			document.removeEventListener('mouseup', stopDrag);
		};
	});
</script>

<div
	class="layers-panel"
	class:expanded
	class:resized={userResized}
	class:dragging={isDragging}
	bind:this={panelElement}
	style={expanded && userResized ? `width: ${panelWidth}px; height: ${panelHeight}px;` : ''}
>
	<!-- Header bar -->
	<button
		class="layers-header"
		onclick={() => expanded = !expanded}
		aria-expanded={expanded}
		aria-label={expanded ? 'Collapse layers panel' : 'Expand layers panel'}
	>
		<svg class="triangle" width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
			{#if expanded}
				<polygon points="0,2 10,2 5,8" />
			{:else}
				<polygon points="2,0 8,5 2,10" />
			{/if}
		</svg>
		<span class="header-text">Layers</span>
		{#if expanded}
			<button
				class="minimize-btn"
				onclick={(e: MouseEvent) => { e.stopPropagation(); expanded = false; }}
				aria-label="Minimize layers panel"
				title="Minimize"
			>_</button>
		{/if}
	</button>

	<!-- Content (visible only when expanded) -->
	{#if expanded}
		<div class="layers-content">
			{#if lamps.length === 0 && zones.length === 0}
				<div class="empty-message">No items to display</div>
			{:else}
				<table class="layers-table">
					<colgroup>
						<col class="col-name" />
						<col class="col-icon" />
						<col class="col-icon" />
					</colgroup>
					<tbody>
						{#if lamps.length > 0}
							<!-- Lamps section header -->
							<tr class="section-header">
								<td class="cell-section-label">
									<span class="section-label">Lamps</span>
								</td>
								<td class="cell-icon">
									<button
										class="icon-toggle"
										class:pressed={lampsLayerVisible}
										onclick={() => lampsLayerVisible = !lampsLayerVisible}
										aria-label={lampsLayerVisible ? 'Hide all lamps' : 'Show all lamps'}
										title={lampsLayerVisible ? 'Hide all lamps' : 'Show all lamps'}
										use:enterToggle
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											{#if lampsLayerVisible}
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
								</td>
								<td></td>
							</tr>
							{#each lamps as lamp (lamp.id)}
								{@const eyeActive = lampsLayerVisible && lampVisibility[lamp.id] !== false}
								<tr class="item-row">
									<td class="cell-name" class:disabled={!lampsLayerVisible}>
										{getLampName(lamp)}
									</td>
									<td class="cell-icon">
										<button
											class="icon-toggle"
											class:pressed={eyeActive}
											disabled={!lampsLayerVisible}
											onclick={() => toggleLamp(lamp.id)}
											aria-label={eyeActive ? `Hide ${getLampName(lamp)}` : `Show ${getLampName(lamp)}`}
											title={eyeActive ? 'Hide' : 'Show'}
											use:enterToggle
										>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												{#if eyeActive}
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
									</td>
									<td class="cell-icon">
										<button
											class="icon-toggle"
											class:pressed={lamp.enabled}
											onclick={() => onCalcToggle('lamp', lamp.id, !lamp.enabled)}
											aria-label={lamp.enabled ? `Exclude ${getLampName(lamp)} from calculations` : `Include ${getLampName(lamp)} in calculations`}
											title={lamp.enabled ? 'Exclude from calc' : 'Include in calc'}
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
									</td>
								</tr>
							{/each}
						{/if}

						{#if zones.length > 0}
							<!-- CalcZones section header -->
							<tr class="section-header">
								<td class="cell-section-label">
									<span class="section-label">CalcZones</span>
								</td>
								<td class="cell-icon">
									<button
										class="icon-toggle"
										class:pressed={zonesLayerVisible}
										onclick={() => zonesLayerVisible = !zonesLayerVisible}
										aria-label={zonesLayerVisible ? 'Hide all zones' : 'Show all zones'}
										title={zonesLayerVisible ? 'Hide all zones' : 'Show all zones'}
										use:enterToggle
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											{#if zonesLayerVisible}
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
								</td>
								<td></td>
							</tr>
							{#each zones as zone (zone.id)}
								{@const eyeActive = zonesLayerVisible && zoneVisibility[zone.id] !== false}
								<tr class="item-row">
									<td class="cell-name" class:disabled={!zonesLayerVisible}>
										{getZoneName(zone)}
										{#if zone.isStandard}
											<span class="standard-badge">std</span>
										{/if}
									</td>
									<td class="cell-icon">
										<button
											class="icon-toggle"
											class:pressed={eyeActive}
											disabled={!zonesLayerVisible}
											onclick={() => toggleZone(zone.id)}
											aria-label={eyeActive ? `Hide ${getZoneName(zone)}` : `Show ${getZoneName(zone)}`}
											title={eyeActive ? 'Hide' : 'Show'}
											use:enterToggle
										>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												{#if eyeActive}
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
									</td>
									<td class="cell-icon">
										<button
											class="icon-toggle"
											class:pressed={zone.enabled !== false}
											onclick={() => onCalcToggle('zone', zone.id, !(zone.enabled !== false))}
											aria-label={zone.enabled !== false ? `Exclude ${getZoneName(zone)} from calculations` : `Include ${getZoneName(zone)} in calculations`}
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
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Resize handles -->
		<div
			class="resize-handle-right"
			onmousedown={startDrag('right')}
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize panel width"
			tabindex="-1"
		></div>
		<div
			class="resize-handle-bottom"
			onmousedown={startDrag('bottom')}
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize panel height"
			tabindex="-1"
		></div>
		<div
			class="resize-handle-corner"
			onmousedown={startDrag('corner')}
			role="separator"
			aria-label="Resize panel"
			tabindex="-1"
		></div>
	{/if}
</div>

<style>
	.layers-panel {
		position: absolute;
		top: var(--spacing-sm);
		left: var(--spacing-sm);
		z-index: 10;
		background: color-mix(in srgb, var(--color-bg-secondary) 85%, transparent);
		backdrop-filter: blur(4px);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.8rem;
	}

	.layers-panel.expanded {
		display: flex;
		flex-direction: column;
		max-width: 500px;
		max-height: 600px;
	}

	.layers-panel.resized {
		overflow: hidden;
	}

	.layers-panel.dragging {
		transition: none;
	}

	/* --- Header --- */
	.layers-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--spacing-xs) var(--spacing-sm);
		cursor: pointer;
		user-select: none;
		background: none;
		border: none;
		color: var(--color-text);
		font: inherit;
		font-weight: 500;
		width: 100%;
		text-align: left;
	}

	.layers-header:hover {
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
	}

	.triangle {
		flex-shrink: 0;
	}

	.header-text {
		flex: 1;
	}

	.minimize-btn {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
		line-height: 1;
		padding: 0;
		padding-bottom: 2px;
	}

	.minimize-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	/* --- Content area --- */
	.layers-content {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0 var(--spacing-sm) var(--spacing-sm);
	}

	/* --- Table --- */
	.layers-table {
		border-collapse: collapse;
	}

	.layers-panel.resized .layers-table {
		width: 100%;
		table-layout: fixed;
	}

	.layers-table col.col-icon {
		width: 28px;
	}

	/* --- Section headers --- */
	.section-header td {
		padding: 4px 0 2px;
	}

	.cell-section-label {
		vertical-align: middle;
	}

	.section-label {
		font-weight: 600;
		color: var(--color-text);
		text-transform: uppercase;
		font-size: 0.7rem;
		letter-spacing: 0.03em;
	}

	/* --- Item rows --- */
	.item-row td {
		padding: 2px 0;
	}

	/* --- Icon toggle buttons --- */
	.cell-icon {
		text-align: center;
		vertical-align: middle;
		width: 28px;
	}

	.icon-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
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

	.cell-name {
		color: var(--color-text);
		white-space: nowrap;
		padding-left: 10px;
		padding-right: 4px;
		vertical-align: middle;
	}

	.resized .cell-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cell-name.disabled {
		color: var(--color-text-muted);
	}

	.standard-badge {
		font-size: 0.6rem;
		background: var(--color-accent);
		color: white;
		padding: 1px 3px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		font-weight: 500;
		margin-left: 4px;
		vertical-align: middle;
	}

	.empty-message {
		color: var(--color-text-muted);
		font-style: italic;
		padding: var(--spacing-xs) 0;
	}

	/* --- Resize handles --- */
	.resize-handle-right {
		position: absolute;
		top: 0;
		right: 0;
		width: 5px;
		height: 100%;
		cursor: ew-resize;
		background: transparent;
		z-index: 11;
	}

	.resize-handle-right:hover {
		background: var(--color-accent);
		opacity: 0.4;
	}

	.resize-handle-bottom {
		position: absolute;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 5px;
		cursor: ns-resize;
		background: transparent;
		z-index: 11;
	}

	.resize-handle-bottom:hover {
		background: var(--color-accent);
		opacity: 0.4;
	}

	.resize-handle-corner {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 12px;
		height: 12px;
		cursor: nwse-resize;
		background: transparent;
		z-index: 12;
	}

	.resize-handle-corner:hover {
		background: var(--color-accent);
		opacity: 0.4;
		border-radius: 0 0 var(--radius-md) 0;
	}
</style>
