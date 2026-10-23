<script lang="ts">
	import Modal from './Modal.svelte';
	import LandingCards from '$lib/workspace/LandingCards.svelte';
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

<!-- The title still names the dialog (aria-label) but renders nothing: the headline is the only text. -->
<Modal title="Start a design" {onClose} maxWidth="560px" minimizable={false} draggable={false} dockId="start-chooser">
	{#snippet titleContent()}{/snippet}
	{#snippet body()}
		<div class="chooser">
			<LandingCards onChoose={choose} {busy} />
			<label class="dont-show">
				<input type="checkbox" bind:checked={dontShowAgain} />
				<span>Don't show this again</span>
			</label>
		</div>
	{/snippet}
</Modal>

<style>
	.chooser {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		padding: var(--spacing-md) var(--spacing-lg) var(--spacing-lg);
	}
	.dont-show {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-xs);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		margin: 0;
	}
	.dont-show input {
		width: auto;
		margin: 0;
		accent-color: var(--color-primary);
	}
</style>
