<script lang="ts">
	import { results } from '$lib/stores/project';
	import { nextStep } from '$lib/stores/nextStep';

	interface Props {
		appVersion?: string | null;
		guvCalcsVersion?: string | null;
	}

	let { appVersion = null, guvCalcsVersion = null }: Props = $props();

	const formattedTime = $derived(
		$results?.calculatedAt
			? new Date($results.calculatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
			: null
	);
</script>

<!-- The next-step id rides along as a data attribute (no visible text) so
     tests and tooling can read the design's state from the footer. -->
<footer class="app-status-bar" data-next-step={$nextStep.id}>
	{#if formattedTime}
		<div class="status-section">
			<span>Last calculated: {formattedTime}</span>
		</div>
	{/if}

	{#if appVersion || guvCalcsVersion}
		<div class="status-right">
			{#if appVersion}
				<span>illuminate v{appVersion}</span>
			{/if}
			{#if appVersion && guvCalcsVersion}
				<span class="version-sep">|</span>
			{/if}
			{#if guvCalcsVersion}
				<a href="https://www.github.com/jvbelenky/guv-calcs" target="_blank" rel="noopener noreferrer">guv-calcs {guvCalcsVersion}</a>
			{/if}
		</div>
	{/if}
</footer>

<style>
	.status-right {
		margin-left: auto;
		font-family: var(--font-mono);
	}

	.status-right a {
		color: inherit;
		text-decoration: none;
	}

	.version-sep {
		margin: 0 0.4em;
		opacity: 0.4;
	}
</style>
