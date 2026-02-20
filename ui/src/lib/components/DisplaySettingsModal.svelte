<script lang="ts">
	import { project, room } from '$lib/stores/project';
	import { theme } from '$lib/stores/theme';
	import { rovingTabindex } from '$lib/actions/rovingTabindex';
	import Modal from './Modal.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	const colormapOptions = [
		'plasma', 'viridis', 'magma', 'inferno', 'cividis',
		'plasma_r', 'viridis_r', 'magma_r', 'inferno_r', 'cividis_r'
	];

	function handlePrecisionChange(e: Event) {
		const target = e.target as HTMLInputElement;
		project.updateRoom({ precision: parseInt(target.value) || 1 });
	}

	function handleColormapChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		project.updateRoom({ colormap: target.value });
	}
</script>

<Modal
	title="Display Settings"
	{onClose}
	width="320px"
	maxWidth="90%"
	titleFontSize="1rem"
>
	{#snippet body()}
		<div class="modal-body">
			<div class="setting-row">
				<label for="theme">Theme</label>
				<div class="theme-toggle" use:rovingTabindex={{ orientation: 'horizontal', selector: 'button' }}>
					<button
						type="button"
						class="theme-btn"
						class:active={$theme === 'light'}
						onclick={() => theme.set('light')}
					>
						Light
					</button>
					<button
						type="button"
						class="theme-btn"
						class:active={$theme === 'dark'}
						onclick={() => theme.set('dark')}
					>
						Dark
					</button>
				</div>
			</div>

			<div class="setting-row">
				<label for="colormap">Colormap</label>
				<select id="colormap" value={$room.colormap} onchange={handleColormapChange}>
					{#each colormapOptions as cm}
						<option value={cm}>{cm}</option>
					{/each}
				</select>
			</div>

			<div class="setting-row">
				<label for="precision">Decimal Precision</label>
				<input
					id="precision"
					type="number"
					value={$room.precision}
					onchange={handlePrecisionChange}
					min="1"
					max="9"
					step="1"
				/>
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	.modal-body {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.setting-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
	}

	.setting-row label {
		font-size: 0.9rem;
		color: var(--color-text);
		margin: 0;
	}

	.setting-row select,
	.setting-row input {
		width: 140px;
		font-size: 0.85rem;
	}

	.theme-toggle {
		display: flex;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.theme-btn {
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-secondary);
		border: none;
		color: var(--color-text-muted);
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.theme-btn:first-child {
		border-right: 1px solid var(--color-border);
	}

	.theme-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.theme-btn.active {
		background: var(--color-accent);
		color: white;
	}

	.theme-btn:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-accent) 60%, transparent);
	}

	.theme-btn.active:focus-visible {
		box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.6);
	}
</style>
