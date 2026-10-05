<script lang="ts">
	import { project, room, objects } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { displayDimension } from '$lib/utils/formatting';
	import { unitAbbrev, unitsPerMeter, unitStep, LENGTH_UNITS, type LengthUnit } from '$lib/utils/unitConversion';
	import { roomVertices, roomFloorArea, isPolygonRoom } from '$lib/utils/roomGeometry';
	import { imageRect } from '$lib/utils/floorplanImage';
	import FloorPlanThumbnail from './FloorPlanThumbnail.svelte';
	import { floorplanImage } from '$lib/stores/floorplanImage';
	import { objectFootprint } from '$lib/utils/objectGeometry';

	interface Props {
		/** Open the Plan editor on its Outline step (the page hosts it). */
		onEditPlan: () => void;
	}

	let { onEditPlan }: Props = $props();

	const footprints = $derived($objects.filter((o) => o.enabled !== false).map(objectFootprint));

	const units = $derived($userSettings.units);
	const isPolygon = $derived(isPolygonRoom($room));
	const outline = $derived(roomVertices($room));
	const unit = $derived(unitAbbrev(units));
	const summary = $derived.by(() => {
		const area = roomFloorArea($room);
		const parts = [`${displayDimension(area, $room.precision)} ${unit}²`, `${displayDimension(area * $room.z, $room.precision)} ${unit}³`];
		if (isPolygon) parts.unshift(`${outline.length} walls`);
		return parts.join(' · ');
	});

	const thumbImage = $derived.by(() => {
		const p = $room.floorplan;
		const img = $floorplanImage;
		if (!p || !img || img.id !== p.imageId) return null;
		return { src: img.src, rect: imageRect(p, unitsPerMeter(units)), opacity: p.opacity };
	});

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
		project.changeUnits(target.value as LengthUnit);
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
						data-scroll-step={unitStep(units)}
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
						data-scroll-step={unitStep(units)}
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
						data-scroll-step={unitStep(units)}
						value={displayDimension($room.z, $room.precision)}
						onchange={(e) => handleDimensionChange('z', e)}
					/>
				</div>
			</div>
			<select class="units-select" value={units} onchange={handleUnitChange} aria-label="Units">
				{#each LENGTH_UNITS as u (u)}
					<option value={u}>{unitAbbrev(u)}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Floor plan minimap, then area · volume and the editor button on one line -->
	<div class="form-group plan-group">
		<FloorPlanThumbnail
			vertices={outline}
			onclick={onEditPlan}
			imageSrc={thumbImage?.src ?? null}
			imageRect={thumbImage?.rect ?? null}
			imageOpacity={thumbImage?.opacity ?? 0.6}
			{footprints}
		/>
		<div class="plan-footer">
			<span class="plan-summary">{summary}</span>
			<button type="button" class="mini secondary plan-edit-btn" aria-label="Edit floor plan" title="Edit floor plan" onclick={onEditPlan}>
				Edit
			</button>
		</div>
	</div>

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

	.plan-group {
		gap: var(--spacing-xs);
	}

	.plan-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		min-height: 24px;
	}

	.plan-summary {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.plan-edit-btn {
		padding: 2px 12px;
		font-size: var(--font-size-sm);
		line-height: 1.4;
		flex-shrink: 0;
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
