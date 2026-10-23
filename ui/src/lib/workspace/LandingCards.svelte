<script lang="ts">
	import type { StartChoice } from '$lib/components/StartChooserModal.svelte';

	interface Props {
		onChoose: (choice: StartChoice) => void;
		busy?: boolean;
	}

	let { onChoose, busy = false }: Props = $props();
</script>

<div class="landing">
	<p class="headline">Illuminate is a tool for modeling germicidal UV efficacy and safety.</p>
	<div class="cards">
		<button type="button" class="landing-card" data-choice="empty" onclick={() => onChoose('empty')} disabled={busy}>
			<svg class="art" viewBox="0 0 44 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
				<path d="M4 12l18-8 18 8v18H4z"/>
				<path d="M4 12l18 8 18-8M22 20v10"/>
				<path d="M30 26l7-7 2 2-7 7h-2z" stroke-width="1.3"/>
			</svg>
			<span class="label">Start designing</span>
		</button>
		<button type="button" class="landing-card" data-choice="open" onclick={() => onChoose('open')} disabled={busy}>
			<svg class="art" viewBox="0 0 44 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
				<path d="M6 8h11l3 3h18v19H6z"/>
				<path d="M6 15h32"/>
			</svg>
			<span class="label">Open a .guv file</span>
		</button>
		<button type="button" class="landing-card" data-choice="typical" onclick={() => onChoose('typical')} disabled={busy}>
			<svg class="art" viewBox="0 0 44 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
				<path d="M4 12l18-8 18 8v18H4z"/>
				<path d="M4 12l18 8 18-8M22 20v10"/>
				<circle cx="22" cy="9" r="2.2" fill="currentColor" stroke="none"/>
				<path d="M22 11v2M17 21l5-8 5 8" stroke-dasharray="1.5 2"/>
			</svg>
			<span class="label">{busy ? 'Setting up…' : 'See an example'}</span>
		</button>
	</div>
</div>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}
	.headline {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
		line-height: 1.45;
		text-align: center;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(3, 150px);
		gap: 14px;
		justify-content: center;
	}
	.landing-card {
		aspect-ratio: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: var(--spacing-sm);
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--color-text);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color 0.15s, transform 0.15s;
	}
	.art {
		width: 64px;
		height: 52px;
		flex: none;
		color: var(--color-text-muted);
		transition: color 0.15s;
	}
	.landing-card:hover:not(:disabled) {
		border-color: var(--color-primary);
		transform: translateY(-2px);
	}
	.landing-card:hover:not(:disabled) .art {
		color: var(--color-primary);
	}
	.landing-card:disabled {
		opacity: 0.6;
		cursor: default;
	}
	@media (max-width: 767px) {
		.cards {
			grid-template-columns: 1fr;
			gap: var(--spacing-sm);
		}
		.landing-card {
			aspect-ratio: auto;
			flex-direction: row;
			justify-content: flex-start;
			gap: 14px;
			padding: 12px 14px;
			text-align: left;
		}
		.art {
			width: 40px;
			height: 32px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.landing-card, .art { transition: none; }
		.landing-card:hover:not(:disabled) { transform: none; }
	}
</style>
