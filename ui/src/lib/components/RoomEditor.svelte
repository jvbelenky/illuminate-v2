<script lang="ts">
	import { project, room, lamps } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { enterToggle } from '$lib/actions/enterToggle';
	import { displayDimension } from '$lib/utils/formatting';
	import { unitAbbrev } from '$lib/utils/unitConversion';
	import { roomVertices, roomFloorArea, isPolygonRoom, type Vertex } from '$lib/utils/roomGeometry';
	import FloorPlanThumbnail from './FloorPlanThumbnail.svelte';
	import FloorPlanModal from './FloorPlanModal.svelte';

	interface Props {
		onShowReflectanceSettings: () => void;
	}

	let { onShowReflectanceSettings }: Props = $props();

	const units = $derived($userSettings.units);
	const isPolygon = $derived(isPolygonRoom($room));
	const outline = $derived(roomVertices($room));
	const unit = $derived(unitAbbrev(units));
	const summary = $derived(
		`${isPolygon ? `Polygon · ${outline.length} walls` : 'Rectangle'} · ${displayDimension(roomFloorArea($room), $room.precision)} ${unit}²`
	);

	let showFloorPlan = $state(false);

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

	function handleFloorPlanApply(vertices: Vertex[]) {
		// The store collapses an origin-anchored rectangle back to rectangle mode
		project.updateRoom({ shape: 'polygon', vertices });
		showFloorPlan = false;
	}
</script>

<div class="room-editor">
	<!-- Dimensions with Units. For a polygon room X/Y are the overall extents;
	     changing one stretches the outline along that axis (handled by the store). -->
	<div class="form-group">
		<label>Dimensions</label>
		<div class="dimensions-row">
			<div class="dim-inputs">
				<div class="input-with-label">
					<span class="input-label">X</span>
					<input
						type="text"
						inputmode="decimal"
						value={displayDimension($room.x, $room.precision)}
						onchange={(e) => handleDimensionChange('x', e)}
						title={isPolygon ? 'Overall width; changing it stretches the floor plan' : undefined}
					/>
				</div>
				<div class="input-with-label">
					<span class="input-label">Y</span>
					<input
						type="text"
						inputmode="decimal"
						value={displayDimension($room.y, $room.precision)}
						onchange={(e) => handleDimensionChange('y', e)}
						title={isPolygon ? 'Overall depth; changing it stretches the floor plan' : undefined}
					/>
				</div>
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

	<!-- Floor plan summary + editor -->
	<div class="form-group">
		<div class="plan-header">
			<label>Floor plan</label>
			<button type="button" class="mini plan-edit-btn" aria-label="Edit floor plan" title="Edit floor plan" onclick={() => (showFloorPlan = true)}>
				Edit
			</button>
		</div>
		<FloorPlanThumbnail vertices={outline} onclick={() => (showFloorPlan = true)} />
		<div class="plan-summary">{summary}</div>
	</div>

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

{#if showFloorPlan}
	<FloorPlanModal
		vertices={outline}
		{units}
		precision={$room.precision}
		lamps={$lamps}
		onApply={handleFloorPlanApply}
		onClose={() => (showFloorPlan = false)}
	/>
{/if}

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

	.plan-summary {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.plan-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.plan-edit-btn {
		padding: 1px 8px;
		font-size: var(--font-size-xs);
		line-height: 1.4;
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
