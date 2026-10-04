<script lang="ts">
	import { project } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import type { SceneObject, RoomConfig } from '$lib/types/project';
	import { unitAbbrev, unitStep, fromMeters } from '$lib/utils/unitConversion';
	import { isFloorToCeiling, floorToCeilingUpdate, bottomUpdate, topUpdate, objectTop } from '$lib/utils/objectHeight';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';

	interface Props {
		object: SceneObject;
		room: RoomConfig;
		onClose: () => void;
		onCopy?: (newId: string) => void;
		/** Open the footprint editor for this object (reshape an extrusion, or convert a box). */
		onEditFootprint?: (object: SceneObject) => void;
	}

	let { object, room, onClose, onCopy, onEditFootprint }: Props = $props();

	// The editor reads the store prop directly and writes through
	// project.updateObject — no mirrored local $state, so a background store
	// emit (echo, units change, nudge) can never clobber an in-progress edit.

	let showAdvanced = $state(false);
	let showDeleteConfirm = $state(false);

	const units = $derived(unitAbbrev($userSettings.units));
	const isExtrusion = $derived(object.shape === 'extrusion');
	const sizeStep = $derived(unitStep($userSettings.units));

	// Height is shown as bottom / top, or "floor to ceiling" (derived, never stored).
	const fullHeight = $derived(isFloorToCeiling(object, room.z));
	const top = $derived(objectTop(object));

	function commit(partial: Partial<SceneObject>) {
		project.updateObject(object.id, partial);
	}

	function toggleFullHeight(on: boolean) {
		if (on) commit(floorToCeilingUpdate(room.z));
		// Turning it off keeps the current extent; the bottom/top fields appear for editing.
		else commit({ z: 0, height: Math.min(object.height, room.z) - Math.min(fromMeters(0.1, $userSettings.units), room.z / 4) });
	}

	// Reflectance and transmittance are validated as a pair by guv_calcs
	// (R + T <= 1), so both values travel in the same update. The input's own
	// max keeps the pair valid before the request is made.
	function commitReflectance(value: number) {
		commit({ reflectance: value, transmittance: object.transmittance });
	}

	function commitTransmittance(value: number) {
		commit({ reflectance: object.reflectance, transmittance: value });
	}

	async function copy() {
		try {
			const newId = await project.copyObject(object.id);
			onCopy?.(newId);
		} catch (e) {
			console.error('Failed to copy object:', e);
		}
	}

	function remove() {
		project.removeObject(object.id);
		onClose();
	}
</script>

<div class="object-editor" data-testid="object-editor">
	<button class="close-x" onclick={onClose} aria-label="Close editor" title="Close">×</button>

	<div class="form-group">
		<span class="shape-line">
			{#if isExtrusion}
				Polygon, {object.vertices?.length ?? 0} corners
			{:else}
				Box
			{/if}
			{#if onEditFootprint}
				<button type="button" class="secondary small footprint-btn" onclick={() => onEditFootprint(object)}>
					Edit on plan…
				</button>
			{/if}
		</span>
	</div>

	<div class="form-group">
		<label class="section-label">Footprint ({units})</label>
		<div class="vector-row">
			<span class="vector-label" title="X extent">W</span>
			<ValidatedNumberInput id="object-width" value={object.width} precision={room.precision} oncommit={(v) => commit({ width: v })} min={0.001} step={sizeStep} />
			<span class="vector-label" title="Y extent">L</span>
			<ValidatedNumberInput id="object-length" value={object.length} precision={room.precision} oncommit={(v) => commit({ length: v })} min={0.001} step={sizeStep} />
		</div>
		{#if isExtrusion}
			<span class="hint">Width and length scale the footprint about its centre.</span>
		{/if}
	</div>

	<div class="form-group">
		<label class="section-label">Height ({units})</label>
		<label class="toggle-row">
			<input type="checkbox" id="object-full-height" checked={fullHeight} onchange={(e) => toggleFullHeight(e.currentTarget.checked)} use:enterToggle />
			<span>Floor to ceiling</span>
		</label>
		{#if !fullHeight}
			<div class="vector-row">
				<span class="vector-label" title="Height of the bottom face">Bottom</span>
				<ValidatedNumberInput id="object-bottom" value={object.z} precision={room.precision} oncommit={(v) => commit(bottomUpdate(object, v))} min={0} max={room.z} step={sizeStep} />
				<span class="vector-label" title="Height of the top face">Top</span>
				<ValidatedNumberInput id="object-top" value={top} precision={room.precision} oncommit={(v) => commit(topUpdate(object, v))} min={0} max={room.z} step={sizeStep} />
			</div>
		{/if}
	</div>

	<div class="form-group">
		<label class="section-label">Position ({units})</label>
		<div class="vector-row">
			<span class="vector-label">X</span>
			<ValidatedNumberInput id="object-x" value={object.x} precision={room.precision} oncommit={(v) => commit({ x: v })} step={sizeStep} />
			<span class="vector-label">Y</span>
			<ValidatedNumberInput id="object-y" value={object.y} precision={room.precision} oncommit={(v) => commit({ y: v })} step={sizeStep} />
		</div>
		<span class="hint">Centre of the footprint.</span>
	</div>

	<div class="form-group">
		<label class="section-label" for="object-yaw">Rotation (degrees)</label>
		<div class="vector-row">
			<span class="vector-label" title="About the vertical axis">Yaw</span>
			<ValidatedNumberInput id="object-yaw" value={object.yaw} precision={1} oncommit={(v) => commit({ yaw: v })} step={5} />
		</div>
	</div>

	<div class="form-group">
		<label class="section-label">Surfaces</label>
		<div class="optical-row">
			<label class="input-label" for="object-reflectance">Reflectance</label>
			<ValidatedNumberInput id="object-reflectance" value={object.reflectance} precision={2} oncommit={commitReflectance} min={0} max={Math.max(0, 1 - object.transmittance)} step={0.05} />
			<label class="input-label" for="object-transmittance">Transmittance</label>
			<ValidatedNumberInput id="object-transmittance" value={object.transmittance} precision={2} oncommit={commitTransmittance} min={0} max={Math.max(0, 1 - object.reflectance)} step={0.05} />
		</div>
		<span class="hint">0–1, applied to every face; together they cannot exceed 1. Light that is neither reflected nor transmitted is absorbed.</span>
	</div>

	<div class="form-group">
		<button type="button" class="disclosure" onclick={() => showAdvanced = !showAdvanced} aria-expanded={showAdvanced}>
			<span class="collapse-icon">{showAdvanced ? '▼' : '▶'}</span> Advanced
		</button>
		{#if showAdvanced}
			<div class="vector-row advanced-row">
				<span class="vector-label" title="About the Y axis">Pitch</span>
				<ValidatedNumberInput id="object-pitch" value={object.pitch} precision={1} oncommit={(v) => commit({ pitch: v })} step={5} />
				<span class="vector-label" title="About the X axis">Roll</span>
				<ValidatedNumberInput id="object-roll" value={object.roll} precision={1} oncommit={(v) => commit({ roll: v })} step={5} />
			</div>
			<span class="hint">Tilts are applied after yaw, about the obstacle's base centre.</span>
		{/if}
	</div>

	<div class="editor-actions">
		<button class="delete-btn" onclick={() => showDeleteConfirm = true}>Delete</button>
		<button class="secondary" onclick={copy}>Copy</button>
		<button class="secondary" onclick={onClose}>Close</button>
	</div>
</div>

{#if showDeleteConfirm}
	<ConfirmDialog
		title="Delete Obstacle"
		message="Delete {object.name || object.id}?"
		confirmLabel="Delete"
		variant="danger"
		onConfirm={() => { showDeleteConfirm = false; remove(); }}
		onCancel={() => showDeleteConfirm = false}
	/>
{/if}

<style>
	.object-editor {
		position: relative;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.close-x {
		position: absolute;
		top: var(--spacing-xs);
		right: var(--spacing-xs);
		background: none;
		border: none;
		font-size: 1.25rem;
		line-height: 1;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.close-x:hover {
		color: var(--color-text);
		background: var(--color-bg-tertiary);
	}

	.shape-line {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		padding-right: 1.5rem;
	}
	.footprint-btn {
		margin-left: auto;
		padding: 2px 8px;
		font-size: var(--font-size-xs);
	}

	.section-label {
		font-weight: 600;
		color: var(--color-text);
	}

	.input-label {
		display: block;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-bottom: 2px;
	}

	.vector-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.vector-row :global(input) {
		flex: 1;
		min-width: 0;
	}

	.vector-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-weight: 500;
		min-width: 1rem;
		text-align: center;
	}

	.toggle-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin: 0 0 var(--spacing-xs) 0;
		font-size: var(--font-size-base);
		color: var(--color-text);
		cursor: pointer;
	}
	.toggle-row input[type="checkbox"] {
		width: auto;
		margin: 0;
	}

	.optical-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-xs) var(--spacing-sm);
		align-items: end;
	}

	.optical-row .input-label {
		grid-row: 1;
	}

	.optical-row :global(input) {
		grid-row: 2;
		min-width: 0;
	}

	.advanced-row {
		margin-top: var(--spacing-xs);
	}

	.hint {
		display: block;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-top: 2px;
	}

	.disclosure {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-text);
		font-weight: 600;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.collapse-icon {
		font-size: 0.7em;
		color: var(--color-text-muted);
	}

	.editor-actions {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin-top: var(--spacing-lg);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border);
		gap: var(--spacing-sm);
	}

	.editor-actions button {
		border-radius: var(--radius-lg, 8px);
	}

	.delete-btn {
		background: transparent;
		color: var(--color-error);
		border: 1px solid var(--color-error);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		cursor: pointer;
	}

	.delete-btn:hover {
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
	}
</style>
