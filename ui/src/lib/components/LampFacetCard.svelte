<script lang="ts">
	// One facet of a custom lamp (photometry, spectrum or fixture): every card
	// has the same anatomy so the three read as one system — title and status,
	// file, a picture, the key figures, the main control, and a way into details.
	import type { Snippet } from 'svelte';

	interface Props {
		facet: string;
		title: string;
		chip?: { text: string; tone?: 'ok' | 'warn' };
		file?: Snippet;
		preview: Snippet;
		figures?: Snippet;
		control?: Snippet;
		actions?: Snippet;
	}

	let { facet, title, chip, file, preview, figures, control, actions }: Props = $props();
</script>

<section class="facet-card" data-facet={facet} aria-label={title}>
	<header class="card-head">
		<h3>{title}</h3>
		{#if chip}
			<span class="chip" class:ok={chip.tone === 'ok'} class:warn={chip.tone === 'warn'}>{chip.text}</span>
		{/if}
	</header>
	<div class="file-row">{#if file}{@render file()}{/if}</div>
	<div class="preview">{@render preview()}</div>
	<div class="figures">{#if figures}{@render figures()}{/if}</div>
	<div class="control">{#if control}{@render control()}{/if}</div>
	<footer class="card-foot">{#if actions}{@render actions()}{/if}</footer>
</section>

<style>
	.facet-card {
		display: grid;
		grid-template-rows: auto minmax(30px, auto) 180px auto 1fr auto;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		min-width: 0;
	}

	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
	}

	h3 {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.chip {
		padding: 1px 8px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.chip.ok {
		color: var(--color-success);
		border-color: color-mix(in srgb, var(--color-success) 45%, transparent);
	}

	.chip.warn {
		color: var(--color-warning);
		border-color: color-mix(in srgb, var(--color-warning) 50%, transparent);
	}

	.file-row {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.preview {
		position: relative;
		display: grid;
		/* one definite cell, so a picture sized to 100% fits the frame */
		grid-template: minmax(0, 1fr) / minmax(0, 1fr);
		place-items: center;
		min-height: 0;
		overflow: hidden;
		border-radius: var(--radius-sm);
	}

	.figures {
		display: grid;
		gap: 2px;
		font-size: var(--font-size-sm);
	}

	.control {
		min-width: 0;
	}

	.card-foot {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-xs);
		flex-wrap: wrap;
	}
</style>
