<script lang="ts">
	import { lamps, zones, results } from '$lib/stores/project';

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

<footer class="app-status-bar">
	<div class="status-section">
		<span class="status-indicator ready"></span>
		<span>Ready</span>
	</div>

	<div class="status-divider"></div>

	<div class="status-section">
		<span>Lamps: {$lamps.length}</span>
	</div>

	<div class="status-divider"></div>

	<div class="status-section">
		<span>Zones: {$zones.length}</span>
	</div>

	{#if formattedTime}
		<div class="status-divider"></div>
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
	.status-indicator {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-success);
	}

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
