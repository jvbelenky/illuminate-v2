<script lang="ts">
	export type ViewPreset = 'isometric' | 'top' | 'front' | 'back' | 'left' | 'right';

	interface Props {
		onViewChange: (view: ViewPreset) => void;
	}

	let { onViewChange }: Props = $props();

	const views: { id: ViewPreset; label: string; icon: string }[] = [
		{ id: 'isometric', label: 'Isometric', icon: '◇' },
		{ id: 'top', label: 'Top', icon: '⬓' },
		{ id: 'front', label: 'Front', icon: '▭' },
		{ id: 'back', label: 'Back', icon: '▭' },
		{ id: 'left', label: 'Left', icon: '▯' },
		{ id: 'right', label: 'Right', icon: '▯' }
	];
</script>

<div class="view-overlay">
	<span class="view-label">View</span>
	<div class="view-buttons">
		{#each views as view (view.id)}
			<button
				class="view-btn"
				title={view.label}
				onclick={() => onViewChange(view.id)}
			>
				<span class="view-icon">{view.icon}</span>
				<span class="view-name">{view.label}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.view-overlay {
		position: absolute;
		bottom: var(--spacing-sm);
		left: var(--spacing-sm);
		z-index: 10;
		background: color-mix(in srgb, var(--color-bg-secondary) 85%, transparent);
		backdrop-filter: blur(4px);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.8rem;
	}

	.view-label {
		font-weight: 500;
		color: var(--color-text);
		display: block;
		margin-bottom: var(--spacing-xs);
	}

	.view-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.view-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 4px 8px;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s;
		min-width: 48px;
	}

	.view-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-accent);
	}

	.view-icon {
		font-size: 1rem;
		line-height: 1;
	}

	.view-name {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}
</style>
