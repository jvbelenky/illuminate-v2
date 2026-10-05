<script lang="ts">
	import { project, room, objects } from '$lib/stores/project';
	import { enterToggle } from '$lib/actions/enterToggle';
	import { uniformReflectances, ROOM_DEFAULTS, type SceneObject } from '$lib/types/project';
	import { commonReflectance, objectFaceIds, faceOptics } from '$lib/utils/objectFaces';
	import QuicksetInput from './QuicksetInput.svelte';

	interface Props {
		/** Open the per-plane reflectance modal. */
		onShowReflectanceSettings: () => void;
	}

	let { onShowReflectanceSettings }: Props = $props();

	// Each row stands for a set of planes: the shared value, or null ("mixed").
	const allCommon = $derived(commonReflectance($room, $objects));

	const wallsCommon = $derived.by(() => {
		const values = Object.values($room.reflectances ?? {});
		if (values.length === 0) return ROOM_DEFAULTS.reflectance;
		return values.every((v) => Math.abs(v - values[0]) < 1e-9) ? values[0] : null;
	});

	function objectCommon(obj: SceneObject): { R: number | null; T: number | null } {
		const all = objectFaceIds(obj).map((f) => faceOptics(obj, f));
		const sameR = all.every((o) => Math.abs(o.R - all[0].R) < 1e-9);
		const sameT = all.every((o) => Math.abs(o.T - all[0].T) < 1e-9);
		return { R: sameR ? all[0].R : null, T: sameT ? all[0].T : null };
	}

	function toggle(event: Event) {
		project.updateRoom({ enable_reflectance: (event.target as HTMLInputElement).checked });
	}

	function setWalls(value: number) {
		project.updateRoom({ reflectances: uniformReflectances(value, $room) });
	}

	// Object-level R/T travel together (guv_calcs validates the pair) and
	// reset every face, so a quickset also clears the face overrides.
	function setObjectR(obj: SceneObject, R: number) {
		project.updateObject(obj.id, { reflectance: R, transmittance: obj.transmittance, face_properties: {} });
	}
	function setObjectT(obj: SceneObject, T: number) {
		project.updateObject(obj.id, { reflectance: obj.reflectance, transmittance: T, face_properties: {} });
	}
</script>

<div class="reflectance-step">
	<label class="checkbox-label">
		<input type="checkbox" checked={$room.enable_reflectance} onchange={toggle} use:enterToggle />
		<span>Enable reflections</span>
	</label>

	<ul class="surface-list">
		<li class="surface-row">
			<label class="surface-name" for="reflectance-all">All surfaces</label>
			<span class="field"><span>R</span><QuicksetInput id="reflectance-all" label="All surfaces reflectance" value={allCommon} oncommit={(v) => project.setAllReflectances(v)} /></span>
		</li>
		<li class="surface-row">
			<label class="surface-name" for="reflectance-walls">Room walls</label>
			<span class="field"><span>R</span><QuicksetInput id="reflectance-walls" label="Room walls reflectance" value={wallsCommon} oncommit={setWalls} /></span>
		</li>
		{#each $objects as obj (obj.id)}
			{@const common = objectCommon(obj)}
			<li class="surface-row" class:disabled={obj.enabled === false}>
				<span class="surface-name" title={obj.name || obj.id}>{obj.name || obj.id}</span>
				<span class="field"><span>R</span><QuicksetInput id="refl-r-{obj.id}" label="{obj.name || obj.id} reflectance" value={common.R} max={Math.max(0, 1 - obj.transmittance)} oncommit={(v) => setObjectR(obj, v)} /></span>
				<span class="field"><span>T</span><QuicksetInput id="refl-t-{obj.id}" label="{obj.name || obj.id} transmittance" value={common.T} max={Math.max(0, 1 - obj.reflectance)} oncommit={(v) => setObjectT(obj, v)} /></span>
			</li>
		{/each}
	</ul>

	<button type="button" class="secondary small edit-btn" onclick={onShowReflectanceSettings}>Edit surfaces…</button>
</div>

<style>
	.reflectance-step {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}
	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		font-size: var(--font-size-base);
		margin: 0;
		color: var(--color-text);
	}
	.checkbox-label input[type="checkbox"] {
		width: auto;
		margin: 0;
	}
	.surface-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}
	.surface-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		min-height: 34px;
	}
	.surface-row.disabled {
		opacity: 0.6;
	}
	.surface-name {
		flex: 1;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-base);
		color: var(--color-text);
	}
	.field {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.edit-btn {
		align-self: flex-end;
		padding: 2px 10px;
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}
</style>
