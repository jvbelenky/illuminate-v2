<script lang="ts">
	import { project, room, lamps, objects } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { enterToggle } from '$lib/actions/enterToggle';
	import { displayDimension } from '$lib/utils/formatting';
	import { unitAbbrev, unitsPerMeter, unitStep, LENGTH_UNITS, type LengthUnit } from '$lib/utils/unitConversion';
	import { roomVertices, roomFloorArea, isPolygonRoom } from '$lib/utils/roomGeometry';
	import { imageRect } from '$lib/utils/floorplanImage';
	import FloorPlanThumbnail from './FloorPlanThumbnail.svelte';
	import FloorPlanModal from './FloorPlanModal.svelte';
	import type { FloorPlanApplyResult, PlanLayer } from './FloorPlanModal.svelte';
	import { diffObstacleDrafts } from '$lib/utils/obstacleDrafts';
	import { floorplanImage } from '$lib/stores/floorplanImage';
	import { objectFootprint } from '$lib/utils/objectGeometry';

	interface Props {
		/** Bindable so the page can open the Plan editor itself (start chooser, obstacles step). */
		floorPlanOpen?: boolean;
		/** Which layer the Plan editor opens on, and on the Obstacles layer which obstacle or whether Draw is armed. */
		planLayer?: PlanLayer;
		planObstacleId?: string | null;
		planArmDraw?: boolean;
	}

	let { floorPlanOpen = $bindable(false), planLayer = $bindable('outline'), planObstacleId = $bindable(null), planArmDraw = $bindable(false) }: Props = $props();

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


	function closeFloorPlan() {
		floorPlanOpen = false;
		planLayer = 'outline';
		planObstacleId = null;
		planArmDraw = false;
	}

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


	async function handleFloorPlanApply({ vertices, floorplan, image, obstacles }: FloorPlanApplyResult) {
		// The image store first, then ONE room write: the outline and the placement
		// are a single edit, so they must not reach the sync queue as two commands.
		// A placement without an image means the image could not be restored, so the
		// calibration is kept and the image store is left alone.
		// An untouched outline and placement (the usual case when only obstacles
		// were edited) must not reach the store: a room write re-nudges every
		// lamp, zone and obstacle into bounds and marks the calculation stale.
		const sameOutline = vertices.length === outline.length
			&& vertices.every(([x, y], i) => Math.abs(x - outline[i][0]) < 1e-9 && Math.abs(y - outline[i][1]) < 1e-9);
		const samePlacement = JSON.stringify(floorplan ?? null) === JSON.stringify($room.floorplan ?? null);
		if (!(sameOutline && samePlacement)) {
			if (image && floorplan) floorplanImage.set(image);
			else if (!floorplan && $room.floorplan) floorplanImage.clear();
			// The store collapses an origin-anchored rectangle back to rectangle mode,
			// and treats `floorplan: undefined` in the partial as a clear.
			project.updateRoom({ shape: 'polygon', vertices, floorplan: floorplan ?? undefined });
		}
		// Obstacles: only what changed. Removes first so an add can never collide
		// with a name the user reused; adds await the API like the sidebar does.
		const diff = diffObstacleDrafts(obstacles, $objects);
		for (const id of diff.removes) project.removeObject(id);
		for (const { id, partial } of diff.updates) project.updateObject(id, partial);
		closeFloorPlan();
		for (const add of diff.adds) {
			try {
				await project.addObject(add);
			} catch (e) {
				console.error('Failed to add obstacle:', e);
			}
		}
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
			onclick={() => (floorPlanOpen = true)}
			imageSrc={thumbImage?.src ?? null}
			imageRect={thumbImage?.rect ?? null}
			imageOpacity={thumbImage?.opacity ?? 0.6}
			{footprints}
		/>
		<div class="plan-footer">
			<span class="plan-summary">{summary}</span>
			<button type="button" class="mini secondary plan-edit-btn" aria-label="Edit floor plan" title="Edit floor plan" onclick={() => (floorPlanOpen = true)}>
				Edit
			</button>
		</div>
	</div>

</div>

{#if floorPlanOpen}
	<FloorPlanModal
		vertices={outline}
		{units}
		precision={$room.precision}
		lamps={$lamps}
		objects={$objects}
		floorplan={$room.floorplan ?? null}
		image={$room.floorplan && $floorplanImage?.id === $room.floorplan.imageId ? $floorplanImage : null}
		onApply={handleFloorPlanApply}
		onClose={closeFloorPlan}
		onUnitsChange={(u) => project.changeUnits(u)}
		roomZ={$room.z}
		initialLayer={planLayer}
		initialObstacleId={planObstacleId}
		armDraw={planArmDraw}
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
