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
						<col class="col-eye" />
						<col class="col-calc" />
						<col class="col-name" />
					</colgroup>
					<thead>
						<tr>
							<th class="col-header">
								<!-- Eye icon -->
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
									<circle cx="12" cy="12" r="3"/>
								</svg>
							</th>
							<th class="col-header">
								<!-- Calculator icon -->
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<rect x="4" y="2" width="16" height="20" rx="2"/>
									<line x1="8" y1="6" x2="16" y2="6"/>
									<line x1="8" y1="10" x2="10" y2="10"/>
									<line x1="14" y1="10" x2="16" y2="10"/>
									<line x1="8" y1="14" x2="10" y2="14"/>
									<line x1="14" y1="14" x2="16" y2="14"/>
									<line x1="8" y1="18" x2="10" y2="18"/>
									<line x1="14" y1="18" x2="16" y2="18"/>
								</svg>
							</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#if lamps.length > 0}
							<!-- Lamps section header -->
							<tr class="section-header">
								<td class="cell-check">
									<input
										type="checkbox"
										bind:checked={lampsLayerVisible}
										use:enterToggle
									/>
								</td>
								<td colspan="2" class="cell-section-label">									<span class="section-label">Lamps</span>
								</td>
							</tr>
							{#each lamps as lamp (lamp.id)}
								<tr class="item-row">
									<td class="cell-check">
										<input
											type="checkbox"
											checked={lampsLayerVisible && lampVisibility[lamp.id] !== false}
											disabled={!lampsLayerVisible}
											onchange={() => toggleLamp(lamp.id)}
											use:enterToggle
										/>
									</td>
									<td class="cell-check">
										<input
											type="checkbox"
											checked={lamp.enabled}
											onchange={() => onCalcToggle('lamp', lamp.id, !lamp.enabled)}
											use:enterToggle
										/>
									</td>
									<td class="cell-name" class:disabled={!lampsLayerVisible}>
										{getLampName(lamp)}
									</td>
								</tr>
							{/each}
						{/if}

						{#if zones.length > 0}
							<!-- CalcZones section header -->
							<tr class="section-header">
								<td class="cell-check">
									<input
										type="checkbox"
										bind:checked={zonesLayerVisible}
										use:enterToggle
									/>
								</td>
								<td colspan="2" class="cell-section-label">
									<span class="section-label">CalcZones</span>
								</td>
							</tr>
							{#each zones as zone (zone.id)}
								<tr class="item-row">
									<td class="cell-check">
										<input
											type="checkbox"
											checked={zonesLayerVisible && zoneVisibility[zone.id] !== false}
											disabled={!zonesLayerVisible}
											onchange={() => toggleZone(zone.id)}
											use:enterToggle
										/>
									</td>
									<td class="cell-check">
										<input
											type="checkbox"
											checked={zone.enabled !== false}
											onchange={() => onCalcToggle('zone', zone.id, !(zone.enabled !== false))}
											use:enterToggle
										/>
									</td>
									<td class="cell-name" class:disabled={!zonesLayerVisible}>
										{getZoneName(zone)}
										{#if zone.isStandard}
											<span class="standard-badge">std</span>
										{/if}
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
		overflow: hidden;
	}

	.layers-panel.expanded {
		display: flex;
		flex-direction: column;
		max-width: 500px;
		max-height: 600px;
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
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
	}

	.layers-table col.col-eye,
	.layers-table col.col-calc {
		width: 28px;
	}

	.layers-table col.col-name {
		width: auto;
	}

	.col-header {
		text-align: center;
		padding: 0 0 4px;
		color: var(--color-text-muted);
		vertical-align: middle;
	}

	.col-header svg {
		display: block;
		margin: 0 auto;
	}

	/* --- Section headers --- */
	.section-header td {
		padding: 4px 0 2px;
	}

	.cell-section-label {
		padding-left: 4px;
		vertical-align: middle;
	}

	.section-label {
		font-weight: 500;
		color: var(--color-text);
	}

	/* --- Item rows --- */
	.item-row td {
		padding: 2px 0;
	}

	.cell-check {
		text-align: center;
		vertical-align: middle;
	}

	.cell-check input[type="checkbox"] {
		margin: 0 auto;
		display: block;
		cursor: pointer;
	}

	.cell-check input[type="checkbox"]:disabled {
		cursor: not-allowed;
	}

	.cell-name {
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding-left: 4px;
		vertical-align: middle;
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
