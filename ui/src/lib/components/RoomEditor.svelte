<script lang="ts">
	import { project, room, lamps } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { enterToggle } from '$lib/actions/enterToggle';
	import { displayDimension } from '$lib/utils/formatting';
	import { rectangleVertices, roomVertices, roomExtents, type Vertex } from '$lib/utils/roomGeometry';
	import FloorPlanEditor from './FloorPlanEditor.svelte';

	interface Props {
		onShowReflectanceSettings: () => void;
	}

	let { onShowReflectanceSettings }: Props = $props();

	const units = $derived($userSettings.units);
	const isPolygon = $derived($room.shape === 'polygon');
	const polygonVertices = $derived(roomVertices($room));

	function handleDimensionChange(dim: 'x' | 'y' | 'z', event: Event) {
		const target = event.target as HTMLInputElement;
		const parsed = parseFloat(target.value);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			target.value = displayDimension($room[dim], $room.precision);
			return;
		}
		project.updateRoom({ [dim]: parsed });
	}

	function handleUnitChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		project.changeUnits(target.value as 'meters' | 'feet');
	}

	function handleReflectanceToggle(event: Event) {
		const target = event.target as HTMLInputElement;
		project.updateRoom({ enable_reflectance: target.checked });
	}

	function setShape(shape: 'rectangle' | 'polygon') {
		if (shape === $room.shape) return;
		if (shape === 'polygon') {
			// Seed the outline with the current rectangle's corners
			project.updateRoom({ shape: 'polygon', vertices: rectangleVertices($room.x, $room.y) });
		} else {
			// Collapse to the bounding box
			const ext = roomExtents(polygonVertices);
			project.updateRoom({ shape: 'rectangle', x: ext.x, y: ext.y });
		}
	}

	function handlePolygonCommit(vertices: Vertex[]) {
		project.updateRoom({ shape: 'polygon', vertices });
	}
</script>

<div class="room-editor">
	<!-- Floor plan shape -->
	<div class="form-group">
		<label>Shape</label>
		<div class="shape-toggle" role="radiogroup" aria-label="Room shape">
			<button
				type="button"
				class="shape-option"
				class:active={!isPolygon}
				role="radio"
				aria-checked={!isPolygon}
				onclick={() => setShape('rectangle')}
			>Rectangle</button>
			<button
				type="button"
				class="shape-option"
				class:active={isPolygon}
				role="radio"
				aria-checked={isPolygon}
				onclick={() => setShape('polygon')}
			>Polygon</button>
		</div>
	</div>

	<!-- Dimensions with Units -->
	<div class="form-group">
		<label>{isPolygon ? 'Height' : 'Dimensions'}</label>
		<div class="dimensions-row">
			<div class="dim-inputs">
				{#if !isPolygon}
					<div class="input-with-label">
						<span class="input-label">X</span>
						<input
							type="text"
							inputmode="decimal"
							value={displayDimension($room.x, $room.precision)}
							onchange={(e) => handleDimensionChange('x', e)}
						/>
					</div>
					<div class="input-with-label">
						<span class="input-label">Y</span>
						<input
							type="text"
							inputmode="decimal"
							value={displayDimension($room.y, $room.precision)}
							onchange={(e) => handleDimensionChange('y', e)}
						/>
					</div>
				{/if}
				<div class="input-with-label">
					<span class="input-label">Z</span>
					<input
						type="text"
						inputmode="decimal"
						value={displayDimension($room.z, $room.precision)}
						onchange={(e) => handleDimensionChange('z', e)}
					/>
				</div>
			</div>
			<select class="units-select" value={units} onchange={handleUnitChange}>
				<option value="meters">m</option>
				<option value="feet">ft</option>
			</select>
		</div>
	</div>

	{#if isPolygon}
		<div class="form-group">
			<label>Floor plan</label>
			<FloorPlanEditor
				vertices={polygonVertices}
				{units}
				precision={$room.precision}
				lamps={$lamps}
				oncommit={handlePolygonCommit}
			/>
		</div>
	{/if}

	<!-- Reflectance Toggle -->
	<div class="form-group tight-after">
		<label class="checkbox-label">
			<input
				type="checkbox"
				checked={$room.enable_reflectance}
				onchange={handleReflectanceToggle}
				use:enterToggle
			/>
			<span>Enable reflections</span>
		</label>
	</div>

	<!-- Reflectance Settings Button -->
	<button type="button" class="secondary reflectance-btn"
		onclick={onShowReflectanceSettings}>
		Set Reflectance
	</button>
</div>

<style>
	.room-editor {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.form-group.tight-after {
		margin-bottom: calc(-1 * var(--spacing-xs));
	}

	/* Shape segmented control */
	.shape-toggle {
		display: flex;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		overflow: hidden;
	}

	.shape-option {
		flex: 1;
		margin: 0;
		border: none;
		border-radius: 0;
		background: transparent;
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
		padding: 4px 0;
		cursor: pointer;
	}

	.shape-option + .shape-option {
		border-left: 1px solid var(--color-border);
	}

	.shape-option.active {
		background: var(--color-primary);
		color: var(--color-bg, #fff);
	}

	/* Dimensions row with units dropdown */
	.dimensions-row {
		display: flex;
		gap: var(--spacing-sm);
		align-items: flex-end;
	}

	.dim-inputs {
		display: flex;
		gap: var(--spacing-xs);
		flex: 1;
	}

	.dim-inputs > * {
		flex: 1;
	}

	.units-select {
		width: 60px;
		flex-shrink: 0;
	}

	.input-with-label {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.input-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-weight: 500;
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

	.reflectance-btn {
		width: 100%;
	}

	label {
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
	}

	input, select {
		width: 100%;
	}
</style>
