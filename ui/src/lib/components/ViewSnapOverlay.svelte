<script lang="ts">
	export type ViewPreset =
		| 'top'
		| 'front' | 'back' | 'left' | 'right'
		| 'iso-front-left' | 'iso-front-right' | 'iso-back-left' | 'iso-back-right';

	interface Props {
		onViewChange: (view: ViewPreset) => void;
		activeView?: ViewPreset | null;
	}

	import { rovingTabindex } from '$lib/actions/rovingTabindex';

	let { onViewChange, activeView = null }: Props = $props();

	// 3x3 grid layout: corners are isometric, edges are orthographic, center is top
	const grid: { id: ViewPreset; icon: string; title: string }[][] = [
		[
			{ id: 'iso-back-left', icon: '↘', title: 'Isometric (back-left)' },
			{ id: 'back', icon: '↓', title: 'Back wall' },
			{ id: 'iso-back-right', icon: '↙', title: 'Isometric (back-right)' }
		],
		[
			{ id: 'left', icon: '→', title: 'Left wall' },
			{ id: 'top', icon: '▢', title: 'Top (plan view)' },
			{ id: 'right', icon: '←', title: 'Right wall' }
		],
		[
			{ id: 'iso-front-left', icon: '↗', title: 'Isometric (front-left)' },
			{ id: 'front', icon: '↑', title: 'Front wall' },
			{ id: 'iso-front-right', icon: '↖', title: 'Isometric (front-right)' }
		]
	];
</script>

<div class="view-overlay" use:rovingTabindex={{ orientation: 'grid', columns: 3, selector: '.view-btn' }}>
	{#each grid as row}
		<div class="view-row">
			{#each row as cell}
				<button
					class="view-btn"
					class:active={activeView === cell.id}
					title={cell.title}
					onclick={() => onViewChange(cell.id)}
				>
					{cell.icon}
				</button>
			{/each}
		</div>
	{/each}
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
		padding: 4px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.view-row {
		display: flex;
		gap: 2px;
	}

	.view-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s;
		font-size: 12px;
		line-height: 1;
		color: var(--color-text-muted);
	}

	.view-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-accent);
		color: var(--color-text);
	}

	.view-btn.active {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-bg-primary);
	}

	@media (max-width: 767px) {
		.view-overlay {
			padding: 3px;
			gap: 3px;
		}

		.view-row {
			gap: 3px;
		}

		.view-btn {
			width: 24px;
			height: 24px;
			font-size: 12px;
		}
	}
</style>
