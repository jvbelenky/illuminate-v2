<script lang="ts">
	import { project, room, objects } from '$lib/stores/project';
	import { enterToggle } from '$lib/actions/enterToggle';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import { commonReflectance } from '$lib/utils/objectFaces';

	interface Props {
		/** Open the per-plane reflectance modal. */
		onShowReflectanceSettings: () => void;
	}

	let { onShowReflectanceSettings }: Props = $props();

	// The one value shared by every room surface and object face, or null
	// when they differ (the input then shows a "mixed" placeholder).
	const common = $derived(commonReflectance($room, $objects));

	function toggle(event: Event) {
		project.updateRoom({ enable_reflectance: (event.target as HTMLInputElement).checked });
	}

	// Committing an empty "mixed" input must not apply anything, so the
	// text input is handled here rather than through ValidatedNumberInput.
	function commitMixed(event: Event) {
		const target = event.target as HTMLInputElement;
		const parsed = parseFloat(target.value);
		if (!isFinite(parsed) || parsed < 0 || parsed > 1) {
			target.value = '';
			return;
		}
		project.setAllReflectances(parsed);
	}
</script>

<div class="reflectance-step">
	<label class="checkbox-label">
		<input type="checkbox" checked={$room.enable_reflectance} onchange={toggle} use:enterToggle />
		<span>Enable reflections</span>
	</label>
	<p class="hint">Reflections add the light that bounces off walls and obstacles. Off, only direct light counts.</p>

	<div class="surface-row">
		<label class="surface-name" for="reflectance-all">Reflectance</label>
		{#if common === null}
			<input
				id="reflectance-all"
				class="refl-input"
				type="text"
				inputmode="decimal"
				placeholder="mixed"
				title="Surfaces differ; type a value to apply it to every surface"
				onchange={commitMixed}
			/>
		{:else}
			<ValidatedNumberInput
				id="reflectance-all"
				class="refl-input"
				value={common}
				precision={3}
				oncommit={(v) => project.setAllReflectances(v)}
				min={0}
				max={1}
				step={0.01}
			/>
		{/if}
		<button type="button" class="secondary small" onclick={onShowReflectanceSettings}>Edit surfaces…</button>
	</div>
	<p class="hint">Applies to every wall, floor, ceiling and obstacle face. Edit surfaces to set them one by one.</p>
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
		margin: 0;
		font-size: var(--font-size-base);
		color: var(--color-text);
	}
	.surface-row :global(.refl-input) {
		width: 4.5rem;
		padding: 2px 6px;
		font-variant-numeric: tabular-nums;
	}
	.small {
		padding: 2px 10px;
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}
</style>
