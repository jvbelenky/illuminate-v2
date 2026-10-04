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
					<h3>1. Room</h3>
					<p>Check the dimensions and units. The defaults are a typical office; edit the floor plan for other shapes.</p>
				</section>

				<section class="card">
					<h3>2. Lamps</h3>
					<p>Add a lamp and choose a model. Position and aim appear once the lamp has photometry; Downlight and Corner place it for you.</p>
				</section>

				<section class="card">
					<h3>3. Calculate</h3>
					<p>Calculate sits at the top right of the 3D view. Results show average fluence, 8-hour skin and eye dose, and whether the design stays within exposure limits.</p>
				</section>

				<section class="card">
					<h3>Calc zones</h3>
					<p>Optional. Standard zones cover the whole room and the safety planes; add custom planes, volumes or points to measure elsewhere.</p>
				</section>
			</div>

			<section class="intro">
				<p>The status bar at the bottom names the next thing to do. Help → Getting Started reopens the start chooser.</p>
			</section>

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
