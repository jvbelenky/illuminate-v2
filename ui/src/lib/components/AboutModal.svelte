<script lang="ts">
	import Modal from './Modal.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();
</script>

<Modal
	title="About Illuminate"
	{onClose}
	maxWidth="560px"
>
	{#snippet body()}
		<div class="modal-body">
			<section class="intro">
				<p class="tagline">
					A free and open source simulation tool for germicidal UV applications
				</p>
				<p>
					Illuminate is a software tool comparable to Acuity Visual or DIALux,
					but purpose-built for germicidal UV (GUV) applications. It supports both far-UV
					(222 nm krypton chloride) and upper-room UV (254 nm low-pressure mercury) installations,
					helping engineers and researchers plan UV disinfection systems by modeling rooms,
					lamp placement, photobiological safety, and dose distributions.
				</p>
			</section>

			<section class="contact-section">
				<a href="mailto:jvb@osluv.org" class="contact-link">jvb@osluv.org</a>
				<p>Found a bug? Want a feature? Questions, feedback, or interested in contributing? Get in touch.</p>
			</section>

			<section class="info-section">
				<h3>Open Source</h3>
				<p>
					Illuminate is free and open source software, distributed under the MIT License.
					It is developed by <a href="https://www.linkedin.com/in/j-vivian-belenky-503759165/" target="_blank" rel="noopener noreferrer">Vivian Belenky</a>
					and supported by the <a href="https://osluv.org" target="_blank" rel="noopener noreferrer">OSLUV Project</a>.
					Contributions are welcome and encouraged.
				</p>
			</section>

			<section class="info-section">
				<h3>Source Libraries</h3>
				<ul class="library-list">
					<li>
						<a href="https://www.github.com/jvbelenky/guv-calcs" target="_blank" rel="noopener noreferrer">guv-calcs</a>
						&mdash; core library for GUV fluence and irradiance calculations
					</li>
					<li>
						<a href="https://www.github.com/jvbelenky/photompy" target="_blank" rel="noopener noreferrer">PhotomPy</a>
						&mdash; photometric file parsing (IES/LDT)
					</li>
					<li>
						<a href="https://www.github.com/jvbelenky/illuminate-v2" target="_blank" rel="noopener noreferrer">Illuminate</a>
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
					far-UV fixtures. We are eager to work with UV companies, especially upper-room GUV companies, to expand the list of characterized
					fixtures available on Illuminate.
				</p>
			</section>

			<section class="info-section">
				<h3>Inactivation Constants</h3>
				<p>
					The UV inactivation rate constants (k-values) for bacteria, viruses, and fungi are compiled
					from peer-reviewed scientific literature. Each entry includes full citations and DOI links
					to the original research, covering UVC wavelengths between 200 and 300 nm (particularly 222 and 254nm) across air, surface, and liquid and
					media. Key sources include previously compiled sources by IUVA (2006), Kowalski (2009), Hessling (2020) and is maintained continuously as new research is published. The full dataset with references is available <a href="https://docs.google.com/spreadsheets/d/16eAuATxHYOdPo6B4yerZqxMh843lb1iCXrTGBMrtbEE/edit?gid=944341396#gid=944341396" target="_blank" rel="noopener noreferrer">here</a>, as well as in the
					<a href="https://www.github.com/jvbelenky/guv-calcs" target="_blank" rel="noopener noreferrer">guv-calcs</a>
					repository. See a missing reference? <a href="mailto:jvb@osluv.org">Get in touch!</a>
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
