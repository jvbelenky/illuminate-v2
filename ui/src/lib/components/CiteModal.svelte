<script lang="ts">
	import Modal from './Modal.svelte';

	interface Props {
		onClose: () => void;
		guvCalcsVersion?: string | null;
	}

	let { onClose, guvCalcsVersion = null }: Props = $props();

	let copied = $state(false);

	const conceptDoi = '10.5281/zenodo.18573615';
	const versionLabel = guvCalcsVersion ? `(v${guvCalcsVersion.replace(/^v/, '')})` : '';
	const citation = `Belenky, V., & Claus, H. (2026). guv-calcs: An open-source Python library for modeling germicidal UV in indoor environments ${versionLabel}. Zenodo. https://doi.org/${conceptDoi}`.replace(/  +/g, ' ');

	async function copyCitation() {
		try {
			await navigator.clipboard.writeText(citation);
			copied = true;
			setTimeout(() => copied = false, 2000);
		} catch {
			// Fallback for older browsers
			const textarea = document.createElement('textarea');
			textarea.value = citation;
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
			copied = true;
			setTimeout(() => copied = false, 2000);
		}
	}
</script>

<Modal
	title="How To Cite"
	{onClose}
	maxWidth="520px"
>
	{#snippet body()}
		<div class="modal-body">
			<p class="intro">
				If you use Illuminate or guv-calcs in your research or work, please cite the following:
			</p>

			<div class="citation-block">
				<p class="citation-text">{citation}</p>
				<button class="copy-btn" onclick={copyCitation}>
					{#if copied}
						Copied!
					{:else}
						Copy
					{/if}
				</button>
			</div>

			<p class="doi-link">
				DOI: <a href="https://doi.org/{conceptDoi}" target="_blank" rel="noopener noreferrer">{conceptDoi}</a>
			</p>
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
		margin: 0 0 var(--spacing-md) 0;
		font-size: 0.9rem;
		line-height: 1.6;
		color: var(--color-text-muted);
	}

	.citation-block {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		margin-bottom: var(--spacing-md);
		position: relative;
	}

	.citation-text {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.7;
		color: var(--color-text);
		padding-right: var(--spacing-lg);
	}

	.copy-btn {
		position: absolute;
		top: var(--spacing-sm);
		right: var(--spacing-sm);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 4px 10px;
		font-size: 0.75rem;
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.copy-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.doi-link {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.doi-link a {
		color: var(--color-accent);
		text-decoration: none;
	}

	.doi-link a:hover {
		text-decoration: underline;
	}
</style>
