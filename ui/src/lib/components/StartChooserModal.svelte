<script lang="ts">
	import Modal from './Modal.svelte';
	import { userSettings } from '$lib/stores/settings';

	export type StartChoice = 'typical' | 'empty' | 'open';

	interface Props {
		onChoose: (choice: StartChoice) => void;
		onClose: () => void;
		/** True while the typical-room setup is running. */
		busy?: boolean;
	}

	let { onChoose, onClose, busy = false }: Props = $props();

	let dontShowAgain = $state(false);

	function choose(choice: StartChoice) {
		if (busy) return;
		if (dontShowAgain) {
			userSettings.update((s) => ({ ...s, showStartChooser: false }));
		}
		onChoose(choice);
	}
</script>

<Modal title="Start a design" {onClose} maxWidth="560px" minimizable={false} draggable={false} dockId="start-chooser">
	{#snippet body()}
		<div class="chooser">
			<p class="lead">Illuminate models how much germicidal UV a room receives and whether it stays within exposure limits.</p>
			<div class="options">
				<button class="option" onclick={() => choose('typical')} disabled={busy}>
					<span class="option-art" aria-hidden="true">
						<svg width="44" height="36" viewBox="0 0 44 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
							<path d="M4 12l18-8 18 8v18H4z"/>
							<path d="M4 12l18 8 18-8M22 20v10"/>
							<circle cx="22" cy="9" r="2.2" fill="currentColor" stroke="none"/>
							<path d="M22 11v2M17 21l5-8 5 8" stroke-dasharray="1.5 2"/>
						</svg>
					</span>
					<span class="option-text">
						<span class="option-title">{busy ? 'Setting up the room…' : 'Typical room with one lamp'}</span>
						<span class="option-detail">A 4 × 6 m room with a 222 nm lamp placed and calculated. The quickest way to see what the tool does.</span>
					</span>
				</button>
				<button class="option" onclick={() => choose('empty')} disabled={busy}>
					<span class="option-art" aria-hidden="true">
						<svg width="44" height="36" viewBox="0 0 44 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
							<path d="M4 12l18-8 18 8v18H4z"/>
							<path d="M4 12l18 8 18-8M22 20v10"/>
						</svg>
					</span>
					<span class="option-text">
						<span class="option-title">Empty room</span>
						<span class="option-detail">Set the room dimensions yourself, then add lamps one at a time.</span>
					</span>
				</button>
				<button class="option" onclick={() => choose('open')} disabled={busy}>
					<span class="option-art" aria-hidden="true">
						<svg width="44" height="36" viewBox="0 0 44 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
							<path d="M6 8h11l3 3h18v19H6z"/>
							<path d="M6 15h32"/>
						</svg>
					</span>
					<span class="option-text">
						<span class="option-title">Open a project file</span>
						<span class="option-detail">Continue from a .guv file saved earlier.</span>
					</span>
				</button>
			</div>
			<label class="dont-show">
				<input type="checkbox" bind:checked={dontShowAgain} />
				<span>Don't show this again (Help → Getting started brings it back)</span>
			</label>
		</div>
	{/snippet}
</Modal>

<style>
	.chooser {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}
	.lead {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
		line-height: 1.45;
		max-width: 46ch;
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}
	.option {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		width: 100%;
		text-align: left;
		padding: var(--spacing-md);
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: border-color 0.15s, background 0.15s;
	}
	.option:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-tertiary));
		border-color: var(--color-primary);
	}
	.option:first-child {
		border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border));
	}
	.option-art {
		flex-shrink: 0;
		color: var(--color-primary);
		display: inline-flex;
	}
	.option-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.option-title {
		font-weight: 600;
		font-size: 0.9375rem;
	}
	.option-detail {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: 1.4;
	}
	.dont-show {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		margin: 0;
	}
	.dont-show input {
		width: auto;
		margin: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		.option { transition: none; }
	}
</style>
