<script lang="ts">
	// A fold-out of the zone panel: the ep-disc button, its current value at the
	// right, and its body while open.
	import type { Snippet } from 'svelte';

	let { label, value, open = $bindable(false), children }: { label: string; value?: string; open?: boolean; children: Snippet } = $props();
</script>

<button type="button" class="ep-disc" aria-expanded={open} onclick={() => (open = !open)}>
	<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
	{label}
	{#if value}<span class="disc-value">{value}</span>{/if}
</button>
{#if open}
	<div class="fold-body">{@render children()}</div>
{/if}
