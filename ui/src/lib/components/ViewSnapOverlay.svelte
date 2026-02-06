<script lang="ts">
	export type ViewPreset =
		| 'top'
		| 'front' | 'back' | 'left' | 'right'
		| 'iso-front-left' | 'iso-front-right' | 'iso-back-left' | 'iso-back-right';

	interface Props {
		onViewChange: (view: ViewPreset) => void;
		isOrtho: boolean;
		onProjectionChange: (isOrtho: boolean) => void;
	}

	let { onViewChange, isOrtho, onProjectionChange }: Props = $props();

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

<div class="view-overlay">
	<div class="view-controls">
		<div class="view-grid">
			{#each grid as row}
				<div class="view-row">
					{#each row as cell}
						<button
							class="view-btn"
							title={cell.title}
							onclick={() => onViewChange(cell.id)}
						>
							{cell.icon}
						</button>
					{/each}
				</div>
			{/each}
		</div>
		<div class="projection-toggle">
			<button
				class="projection-option"
				class:active={!isOrtho}
				title="Perspective projection"
				onclick={() => onProjectionChange(false)}
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 13L7 3" /><path d="M12 13L9 3" /><path d="M3 13h10" /><path d="M6.5 3h3" />
				</svg>
			</button>
			<button
				class="projection-option"
				class:active={isOrtho}
				title="Orthographic projection"
				onclick={() => onProjectionChange(true)}
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M5 13V3" /><path d="M11 13V3" /><path d="M3 13h10" /><path d="M3 3h10" />
				</svg>
			</button>
		</div>
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
		padding: 4px;
	}

	.view-controls {
		display: flex;
		align-items: flex-end;
		gap: 4px;
	}

	.view-grid {
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
		width: 24px;
		height: 24px;
		padding: 0;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s;
		font-size: 14px;
		line-height: 1;
		color: var(--color-text-muted);
	}

	.view-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-accent);
		color: var(--color-text);
	}

	.projection-toggle {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.projection-option {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s;
		color: var(--color-text-muted);
	}

	.projection-option:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-accent);
		color: var(--color-text);
	}

	.projection-option.active {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-bg);
	}
</style>
