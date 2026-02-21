<script lang="ts">
	import { onMount } from 'svelte';

	import '../app.css';
	import { theme } from '$lib/stores/theme';
	import { scrollNumber } from '$lib/actions/scrollNumber';
	import CalculationProgressBar from '$lib/components/CalculationProgressBar.svelte';

	let { children } = $props();

	onMount(() => {
		theme.init();
	});
</script>

<svelte:body use:scrollNumber />

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<link rel="icon" type="image/x-icon" href="/favicon.ico" />
	<title>Illuminate - UV Disinfection Calculator</title>
</svelte:head>

{@render children()}

<CalculationProgressBar />
