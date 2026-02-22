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
	<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
		{#if isOrtho}
			<!-- Ortho icon: isometric cube with parallel edges -->
			<polygon points="16,6 27,12 27,24 16,30 5,24 5,12" fill="currentColor" opacity="0.06" />
			<path d="M5 12 L16 18 L27 12" />
			<path d="M16 18 L16 30" />
			<path d="M5 12 L16 6 L27 12 L27 24 L16 30 L5 24 Z" />
		{:else}
			<!-- Perspective icon: frustum / converging trapezoid box -->
			<path d="M4 10 L4 28 L22 28 L22 10 Z" fill="currentColor" opacity="0.06" />
			<path d="M4 10 L4 28 L22 28 L22 10 Z" />
			<path d="M4 10 L13 7 L28 7 L22 10" />
			<path d="M22 10 L28 7 L28 19 L22 28" />
			<line x1="4" y1="28" x2="13" y2="19" stroke-dasharray="1.5 1.5" opacity="0.35" />
			<line x1="13" y1="7" x2="13" y2="19" stroke-dasharray="1.5 1.5" opacity="0.35" />
			<line x1="13" y1="19" x2="28" y2="19" stroke-dasharray="1.5 1.5" opacity="0.35" />
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
		width: 44px;
		height: 44px;
		padding: 4px;
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
		width: 32px;
		height: 32px;
	}

	@media (max-width: 767px) {
		.proj-toggle {
			left: calc(var(--spacing-sm) + 108px);
		}
	}
</style>
