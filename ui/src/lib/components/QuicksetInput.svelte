<script lang="ts">
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';

	/**
	 * A 0..1 optics input that stands for several planes at once: shows the
	 * shared value, or an empty "mixed" field when they differ. Committing a
	 * valid value applies it to all of them; anything else is discarded.
	 */
	interface Props {
		/** Shared value, or null when the planes differ */
		value: number | null;
		oncommit: (value: number) => void;
		max?: number;
		id?: string;
		label?: string;
	}

	let { value, oncommit, max = 1, id, label }: Props = $props();

	function commitMixed(event: Event) {
		const target = event.target as HTMLInputElement;
		const parsed = parseFloat(target.value);
		if (!isFinite(parsed) || parsed < 0 || parsed > max) {
			target.value = '';
			return;
		}
		oncommit(parsed);
	}
</script>

{#if value === null}
	<input
		{id}
		class="quickset"
		type="text"
		inputmode="decimal"
		placeholder="mixed"
		aria-label={label}
		title="These surfaces differ; type a value to apply it to all of them"
		onchange={commitMixed}
	/>
{:else}
	<ValidatedNumberInput {id} class="quickset" {value} precision={3} {oncommit} min={0} {max} step={0.01} />
{/if}

<style>
	:global(input.quickset) {
		width: 4.25rem;
		padding: 2px 6px;
		font-variant-numeric: tabular-nums;
	}
</style>
