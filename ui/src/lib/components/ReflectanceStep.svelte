<script lang="ts">
	import { project, room, objects } from '$lib/stores/project';
	import { enterToggle } from '$lib/actions/enterToggle';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import { ROOM_DEFAULTS, type SceneObject } from '$lib/types/project';

	interface Props {
		/** Open the per-wall reflectance settings modal. */
		onShowReflectanceSettings: () => void;
	}

	let { onShowReflectanceSettings }: Props = $props();

	// Walls summary: one value when every surface shares it, otherwise "mixed".
	const wallSummary = $derived.by(() => {
		const values = Object.values($room.reflectances ?? {});
		if (values.length === 0) return ROOM_DEFAULTS.reflectance.toFixed(2);
		const first = values[0];
		return values.every((v) => Math.abs(v - first) < 1e-9) ? first.toFixed(2) : 'mixed';
	});

	function toggle(event: Event) {
		project.updateRoom({ enable_reflectance: (event.target as HTMLInputElement).checked });
	}

	// R and T are validated as a pair by guv_calcs (R + T <= 1), so both travel together.
	function commitReflectance(obj: SceneObject, value: number) {
		project.updateObject(obj.id, { reflectance: value, transmittance: obj.transmittance });
	}
	function commitTransmittance(obj: SceneObject, value: number) {
		project.updateObject(obj.id, { reflectance: obj.reflectance, transmittance: value });
	}
</script>

<div class="reflectance-step">
	<label class="checkbox-label">
		<input type="checkbox" checked={$room.enable_reflectance} onchange={toggle} use:enterToggle />
		<span>Enable reflections</span>
	</label>
	<p class="hint">Reflections add the light that bounces off walls and objects. Off, only direct light counts.</p>

	<div class="surface-row walls">
		<span class="surface-name">Walls, floor and ceiling</span>
		<span class="surface-value">R {wallSummary}</span>
		<button type="button" class="secondary small reflectance-btn" onclick={onShowReflectanceSettings}>Walls…</button>
	</div>

	{#if $objects.length > 0}
		<ul class="surface-list">
			{#each $objects as obj (obj.id)}
				<li class="surface-row">
					<span class="surface-name">{obj.name || obj.id}</span>
					<label class="inline-field">
						<span>R</span>
						<ValidatedNumberInput id="refl-r-{obj.id}" value={obj.reflectance} precision={2} oncommit={(v) => commitReflectance(obj, v)} min={0} max={Math.max(0, 1 - obj.transmittance)} step={0.05} />
					</label>
					<label class="inline-field">
						<span>T</span>
						<ValidatedNumberInput id="refl-t-{obj.id}" value={obj.transmittance} precision={2} oncommit={(v) => commitTransmittance(obj, v)} min={0} max={Math.max(0, 1 - obj.reflectance)} step={0.05} />
					</label>
				</li>
			{/each}
		</ul>
		<p class="hint">R reflects, T lets light through; together at most 1. The rest is absorbed.</p>
	{/if}
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
	.hint {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: 1.4;
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
	.surface-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-base);
	}
	.surface-value {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.inline-field {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.inline-field :global(input) {
		width: 3.75rem;
		padding: 2px 6px;
	}
	.small {
		padding: 2px 10px;
		font-size: var(--font-size-sm);
	}
</style>
