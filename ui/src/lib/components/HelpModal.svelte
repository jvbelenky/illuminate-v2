<script lang="ts">
	import { autoFocus } from '$lib/actions/autoFocus';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

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
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="help-title" use:autoFocus>
		<div class="modal-header">
			<h2 id="help-title">Help</h2>
			<button type="button" class="close-btn" onclick={onClose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<div class="modal-body">
			<section class="intro">
				<p>
					Illuminate helps you plan UV disinfection installations by modeling rooms,
					lamps, and calculating dose distributions.
				</p>
			</section>

			<div class="help-grid">
				<section class="card">
					<h3>Room</h3>
					<p>Set dimensions and units. The 3D view updates live.</p>
				</section>

				<section class="card">
					<h3>Lamps</h3>
					<p>Add lamps from presets or upload custom IES files. Set position and aim direction.</p>
				</section>

				<section class="card">
					<h3>Zones</h3>
					<p>Define where to calculate UV dose. Use standard safety zones or add custom planes/volumes.</p>
				</section>

				<section class="card">
					<h3>Calculate</h3>
					<p>Run the simulation. Results show fluence rate, 8-hour dose, and TLV percentages.</p>
				</section>
			</div>

			<section class="shortcuts">
				<h3>3D Controls</h3>
				<div class="shortcut-list">
					<div class="shortcut"><kbd>Drag</kbd> <span>Rotate view</span></div>
					<div class="shortcut"><kbd>Scroll</kbd> <span>Zoom</span></div>
					<div class="shortcut"><kbd>Right-drag</kbd> <span>Pan</span></div>
					<div class="shortcut"><kbd>Esc</kbd> <span>Close popups</span></div>
				</div>
			</section>

			<section class="footer-section">
				<p>
					Powered by <a href="https://github.com/jvbelenky/guv-calcs" target="_blank" rel="noopener noreferrer">guv_calcs</a>
				</p>
			</section>
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
		max-width: 500px;
		width: 90%;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.25rem;
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
		overflow-y: auto;
		flex: 1;
	}

	.intro {
		margin-bottom: var(--spacing-md);
	}

	.intro p {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.5;
		color: var(--color-text-muted);
		opacity: 0.85;
	}

	.help-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
	}

	.card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
	}

	.card h3 {
		margin: 0 0 var(--spacing-xs) 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.card p {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.4;
		color: var(--color-text-muted);
		opacity: 0.75;
	}

	.shortcuts {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
	}

	.shortcuts h3 {
		margin: 0 0 var(--spacing-sm) 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.shortcut-list {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-xs);
	}

	.shortcut {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 0.8rem;
	}

	kbd {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.shortcut span {
		color: var(--color-text-muted);
		opacity: 0.75;
	}

	.footer-section {
		text-align: center;
	}

	.footer-section p {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	a {
		color: var(--color-accent);
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}

	@media (max-width: 400px) {
		.help-grid {
			grid-template-columns: 1fr;
		}

		.shortcut-list {
			grid-template-columns: 1fr;
		}
	}
</style>
