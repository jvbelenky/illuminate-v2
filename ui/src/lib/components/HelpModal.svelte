<script lang="ts">
	import Modal from './Modal.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();
</script>

<Modal
	title="Help"
	{onClose}
	maxWidth="500px"
>
	{#snippet body()}
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
					Powered by <a href="https://www.github.com/jvbelenky/guv-calcs" target="_blank" rel="noopener noreferrer">guv_calcs</a>
				</p>
			</section>
		</div>
	{/snippet}
</Modal>

<style>
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
