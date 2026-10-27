<script lang="ts">
	// The 2D | 3D switch, top-left of the main view: which view fills it.
	import type { MainView } from './dockLayout';

	interface Props {
		main: MainView;
		onSelect: (v: MainView) => void;
	}

	let { main, onSelect }: Props = $props();

	const OPTIONS: { value: MainView; label: string }[] = [
		{ value: '2d', label: '2D' },
		{ value: '3d', label: '3D' }
	];
</script>

<div class="main-view-bar" role="group" aria-label="Main view">
	{#each OPTIONS as o (o.value)}
		<button type="button" aria-pressed={main === o.value} onclick={() => main !== o.value && onSelect(o.value)}>{o.label}</button>
	{/each}
</div>

<style>
	.main-view-bar {
		position: absolute;
		top: 12px;
		left: 12px;
		z-index: 5;
		display: inline-flex;
	}
	button {
		height: 1.9rem;
		min-width: 2.6rem;
		padding: 0 10px;
		font-size: var(--font-size-sm, var(--font-size-base));
		font-weight: 600;
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 0;
		cursor: pointer;
	}
	button:first-child {
		border-radius: var(--radius-sm, 4px) 0 0 var(--radius-sm, 4px);
	}
	button:last-child {
		border-radius: 0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0;
		border-left: 0;
	}
	button:hover {
		color: var(--color-text);
	}
	button[aria-pressed='true'] {
		background: var(--color-highlight);
		color: var(--color-bg, #fff);
		border-color: var(--color-highlight);
	}
</style>
