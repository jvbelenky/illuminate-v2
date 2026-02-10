<script lang="ts">
	import { lamps, zones, results } from '$lib/stores/project';

	interface Props {
		guvCalcsVersion?: string | null;
	}

	let { guvCalcsVersion = null }: Props = $props();

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

	{#if guvCalcsVersion}
		<div class="status-right">
			<a href="https://www.github.com/jvbelenky/guv-calcs" target="_blank" rel="noopener noreferrer">guv-calcs {guvCalcsVersion}</a>
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
</style>
