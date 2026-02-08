<script lang="ts">
	import { onMount } from 'svelte';

	import '../app.css';
	import { theme } from '$lib/stores/theme';
	import CalculationProgressBar from '$lib/components/CalculationProgressBar.svelte';

	let { children } = $props();

	onMount(() => {
		theme.init();
	});
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<title>Illuminate - UV Disinfection Calculator</title>
</svelte:head>

{@render children()}

<CalculationProgressBar />
