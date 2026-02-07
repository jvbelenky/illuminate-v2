<script lang="ts">
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
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="about-title">
		<div class="modal-header">
			<h2 id="about-title">About Illuminate</h2>
			<button type="button" class="close-btn" onclick={onClose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<div class="modal-body">
			<section class="intro">
				<p class="tagline">
					A free and open source simulation tool for germicidal UV applications
				</p>
				<p>
					Illuminate is a software tool comparable to
					<a href="https://www.acuitybrands.com/products/detail/795908/agi32/visual-lighting-software/visual-professional-edition" target="_blank" rel="noopener noreferrer">Visual</a> or
					<a href="https://www.dialux.com/" target="_blank" rel="noopener noreferrer">DIALux</a>,
					but purpose-built for germicidal UV (GUV) applications. It supports both far-UV
					(222 nm krypton chloride) and upper-room UV (254 nm low-pressure mercury) installations,
					helping engineers and researchers plan UV disinfection systems by modeling rooms,
					lamp placement, photobiological safety, and dose distributions.
				</p>
			</section>

			<section class="contact-section">
				<a href="mailto:contact@osluv.org" class="contact-link">contact@osluv.org</a>
				<p>Questions, feedback, or interested in contributing? Get in touch.</p>
			</section>

			<section class="info-section">
				<h3>Open Source</h3>
				<p>
					Illuminate is free and open source software, distributed under the
					<a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener noreferrer">MIT License</a>.
					It is developed by <strong>J. Vivian Belenky</strong> and supported by
					the <a href="https://osluv.org" target="_blank" rel="noopener noreferrer">OSLUV Project</a>.
					Contributions are welcome and encouraged.
				</p>
			</section>

			<section class="info-section">
				<h3>Source Libraries</h3>
				<ul class="library-list">
					<li>
						<a href="https://github.com/jvbelenky/guv-calcs" target="_blank" rel="noopener noreferrer">guv-calcs</a>
						&mdash; core library for GUV fluence and irradiance calculations
					</li>
					<li>
						<a href="https://github.com/jvbelenky/photompy" target="_blank" rel="noopener noreferrer">PhotomPy</a>
						&mdash; photometric file parsing (IES/LDT)
					</li>
					<li>
						<a href="https://github.com/jvbelenky/illuminate" target="_blank" rel="noopener noreferrer">Illuminate</a>
						&mdash; this application
					</li>
				</ul>
				<p>All repositories are MIT-licensed and written primarily in Python.</p>
			</section>

			<section class="info-section">
				<h3>Pre-Filled Lamp Data</h3>
				<p>
					The pre-filled lamp characterization data &mdash; including photometric (IES) files and
					spectral power distributions &mdash; comes from the
					<a href="https://reports.osluv.org/" target="_blank" rel="noopener noreferrer">OSLUV Project 222 nm UV characterization database</a>.
					This database provides independently measured performance data for commercially available
					far-UV fixtures. We are eager to work with UV companies to expand the list of characterized
					fixtures available on Illuminate.
				</p>
			</section>

			<section class="info-section">
				<h3>Inactivation Constants</h3>
				<p>
					The UV inactivation rate constants (k-values) for bacteria, viruses, and fungi are compiled
					from peer-reviewed scientific literature. Each entry includes full citations and DOI links
					to the original research, covering both 222 nm and 254 nm wavelengths across liquid and
					surface media. Key sources include work by Clauss et al. (2009), Narita et al. (2020),
					and many others. The full dataset with references is available in the
					<a href="https://github.com/jvbelenky/guv-calcs" target="_blank" rel="noopener noreferrer">guv-calcs</a>
					repository.
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
		max-width: 560px;
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

	.tagline {
		font-size: 1rem;
		font-weight: 600;
		font-style: italic;
		color: var(--color-text);
		margin: 0 0 var(--spacing-sm) 0;
	}

	.intro p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.6;
		color: var(--color-text-muted);
	}

	.contact-section {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		margin-bottom: var(--spacing-md);
		text-align: center;
	}

	.contact-link {
		display: inline-block;
		font-size: 1.2rem;
		font-weight: 600;
		color: var(--color-accent);
		text-decoration: none;
		margin-bottom: var(--spacing-xs);
	}

	.contact-link:hover {
		text-decoration: underline;
	}

	.contact-section p {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.info-section {
		margin-bottom: var(--spacing-md);
	}

	.info-section:last-child {
		margin-bottom: 0;
	}

	.info-section h3 {
		margin: 0 0 var(--spacing-xs) 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.info-section p {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.6;
		color: var(--color-text-muted);
	}

	.library-list {
		list-style: none;
		padding: 0;
		margin: 0 0 var(--spacing-xs) 0;
	}

	.library-list li {
		font-size: 0.85rem;
		line-height: 1.6;
		color: var(--color-text-muted);
		padding: 2px 0;
	}

	a {
		color: var(--color-accent);
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}
</style>
