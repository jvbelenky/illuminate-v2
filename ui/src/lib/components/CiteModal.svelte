<script lang="ts">
	import { autoFocus } from '$lib/actions/autoFocus';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let copied = $state(false);

	const citation = `Belenky, V., & Claus, H. (2026). guv-calcs: An open-source Python library for modeling germicidal UV in indoor environments (v0.6.0). Zenodo. https://doi.org/10.5281/zenodo.18574516`;

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
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="cite-title" use:autoFocus>
		<div class="modal-header">
			<h2 id="cite-title">How To Cite</h2>
			<button type="button" class="close-btn" onclick={onClose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

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
				DOI: <a href="https://doi.org/10.5281/zenodo.18574516" target="_blank" rel="noopener noreferrer">10.5281/zenodo.18574516</a>
			</p>
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
		max-width: 520px;
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
