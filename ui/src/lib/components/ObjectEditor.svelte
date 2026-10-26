<script lang="ts">
	import { project } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import type { SceneObject, RoomConfig } from '$lib/types/project';
	import { unitStep, fromMeters } from '$lib/utils/unitConversion';
	import { isFloorToCeiling, floorToCeilingUpdate, bottomUpdate, topUpdate, objectTop } from '$lib/utils/objectHeight';
	import { footprintUpdate, objectFootprint, type Vertex } from '$lib/utils/objectGeometry';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import ShapeGeometryFields from '$lib/workspace/parts/ShapeGeometryFields.svelte';
	import type { ReferenceMode } from '$lib/workspace/parts/shapeGeometry';
	import { enterToggle } from '$lib/actions/enterToggle';
	import '$lib/workspace/parts/parts.css';

	interface Props {
		object: SceneObject;
		room: RoomConfig;
	}

	let { object, room }: Props = $props();

	// The editor reads the store prop directly and writes through
	// project.updateObject — no mirrored local $state, so a background store
	// emit (echo, units change, nudge) can never clobber an in-progress edit.

	let geometryOpen = $state(false);
	let displayOpen = $state(false);
	// Where X/Y point: UI state of this editor, not saved
	let reference = $state<ReferenceMode>('centre');

	const sizeStep = $derived(unitStep($userSettings.units));

	// Height is shown as bottom / top, or "floor to ceiling" (derived, never stored).
	const fullHeight = $derived(isFloorToCeiling(object, room.z));
	const top = $derived(objectTop(object));

	const footprint = $derived(objectFootprint(object));
	const labelled = $derived(($project.labels?.objects ?? []).includes(object.id));

	function commit(partial: Partial<SceneObject>) {
		project.updateObject(object.id, partial);
	}

	function toggleFullHeight(on: boolean) {
		if (on) commit(floorToCeilingUpdate(room.z));
		// Turning it off keeps the current extent; the bottom/top fields become editable.
		else commit({ z: 0, height: Math.min(object.height, room.z) - Math.min(fromMeters(0.1, $userSettings.units), room.z / 4) });
	}

	/** A new world footprint and yaw from the Geometry fields. */
	function setFootprint(world: Vertex[], yaw: number) {
		commit(footprintUpdate(object, world, yaw));
	}
</script>

<div class="object-editor" data-testid="object-editor">
	<div class="dims3">
		<label class="dim">
			<span>Bottom</span>
			<ValidatedNumberInput id="object-bottom" value={fullHeight ? 0 : object.z} precision={room.precision} oncommit={(v) => commit(bottomUpdate(object, v))} min={0} max={room.z} step={sizeStep} disabled={fullHeight} />
		</label>
		<label class="dim">
			<span>Top</span>
			<ValidatedNumberInput id="object-top" value={fullHeight ? room.z : top} precision={room.precision} oncommit={(v) => commit(topUpdate(object, v))} min={0} max={room.z} step={sizeStep} disabled={fullHeight} />
		</label>
		<label class="dim full-height">
			<span>Floor to ceiling</span>
			<input type="checkbox" id="object-full-height" checked={fullHeight} onchange={(e) => toggleFullHeight(e.currentTarget.checked)} use:enterToggle />
		</label>
	</div>

	<button type="button" class="ep-disc" aria-expanded={geometryOpen} onclick={() => (geometryOpen = !geometryOpen)}>
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
		Geometry
	</button>
	{#if geometryOpen}
		<div class="fold-body">
			<ShapeGeometryFields
				vertices={footprint}
				yaw={object.yaw}
				{reference}
				units={$userSettings.units}
				onChange={setFootprint}
				onReferenceChange={(mode) => (reference = mode)}
				pitch={object.pitch}
				roll={object.roll}
				onTilt={(partial) => commit(partial)}
			/>
		</div>
	{/if}

	<button type="button" class="ep-disc" aria-expanded={displayOpen} onclick={() => (displayOpen = !displayOpen)}>
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
		Display
	</button>
	{#if displayOpen}
		<div class="fold-body">
			<label class="ep-check">
				<input type="checkbox" checked={labelled} onchange={(e) => project.setLabel('objects', object.id, e.currentTarget.checked)} />
				<span>Show label</span>
			</label>
		</div>
	{/if}
</div>

<style>
	.object-editor {
		min-width: 0;
	}

	.dims3 {
		display: grid;
		/* the third column fits "Floor to ceiling" */
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
		gap: 6px;
	}

	.dim {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		margin: 0;
	}

	.dim > span {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.dim :global(input) {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	.full-height {
		cursor: pointer;
	}

	.full-height input[type='checkbox'] {
		width: auto;
		height: 28px;
		margin: 0;
		align-self: flex-start;
	}

	.fold-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 6px;
	}
</style>
