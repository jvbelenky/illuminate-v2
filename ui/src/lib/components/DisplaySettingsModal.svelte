<script lang="ts">
	import { project, room } from '$lib/stores/project';
	import { theme } from '$lib/stores/theme';
	import { autoFocus } from '$lib/actions/autoFocus';
	import { rovingTabindex } from '$lib/actions/rovingTabindex';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	const colormapOptions = [
		'plasma', 'viridis', 'magma', 'inferno', 'cividis',
		'plasma_r', 'viridis_r', 'magma_r', 'inferno_r', 'cividis_r'
	];

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	function handlePrecisionChange(e: Event) {
		const target = e.target as HTMLInputElement;
		project.updateRoom({ precision: parseInt(target.value) || 1 });
	}

	function handleColormapChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		project.updateRoom({ colormap: target.value });
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="display-title" use:autoFocus>
		<div class="modal-header">
			<h2 id="display-title">Display Settings</h2>
			<button type="button" class="close-btn" onclick={onClose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

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
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-md);
	}

	.modal-content {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		width: 320px;
		max-width: 90%;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-text);
	}

	.close-btn {
		background: transparent;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: all 0.15s;
	}

	.close-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

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
