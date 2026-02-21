<script lang="ts">
	interface Props {
		isOrtho: boolean;
		onclick: () => void;
	}

	let { isOrtho, onclick }: Props = $props();
</script>

<button
	class="proj-toggle"
	title={isOrtho ? 'Switch to perspective projection' : 'Switch to orthographic projection'}
	{onclick}
>
	<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
		{#if isOrtho}
			<!-- Ortho icon: cube with parallel edges -->
			<path d="M7 14 L7 28 L21 28 L21 14 Z" />
			<path d="M7 14 L17 8 L31 8 L21 14 Z" />
			<path d="M21 14 L31 8 L31 22 L21 28 Z" />
			<line x1="7" y1="14" x2="17" y2="8" stroke-dasharray="2 2" opacity="0.4" />
			<line x1="17" y1="8" x2="17" y2="22" stroke-dasharray="2 2" opacity="0.4" />
			<line x1="17" y1="22" x2="7" y2="28" stroke-dasharray="2 2" opacity="0.4" />
		{:else}
			<!-- Perspective icon: cube with converging edges -->
			<path d="M3 11 L3 29 L21 29 L21 11 Z" />
			<path d="M19 7 L19 17 L29 17 L29 7 Z" opacity="0.6" />
			<line x1="3" y1="11" x2="19" y2="7" />
			<line x1="21" y1="11" x2="29" y2="7" />
			<line x1="21" y1="29" x2="29" y2="17" />
			<line x1="3" y1="29" x2="19" y2="17" stroke-dasharray="2 2" opacity="0.4" />
		{/if}
	</svg>
</button>

<style>
	.proj-toggle {
		position: absolute;
		bottom: var(--spacing-sm);
		left: calc(var(--spacing-sm) + 74px);
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 72px;
		height: 72px;
		padding: 14px;
		background: color-mix(in srgb, var(--color-bg-secondary) 85%, transparent);
		backdrop-filter: blur(4px);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.proj-toggle:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-accent);
		color: var(--color-text);
	}

	.proj-toggle svg {
		width: 100%;
		height: 100%;
	}
</style>
