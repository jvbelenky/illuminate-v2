<script lang="ts">
	import { onMount } from 'svelte';

	import '../app.css';
	import { theme } from '$lib/stores/theme';
	import { scrollNumber } from '$lib/actions/scrollNumber';
	import { selectOnFocus } from '$lib/actions/selectOnFocus';
	import CalculationProgressBar from '$lib/components/CalculationProgressBar.svelte';

	let { children } = $props();

	onMount(() => {
		theme.init();
	});
</script>

<svelte:body use:scrollNumber use:selectOnFocus />

<svelte:head>
	<title>Illuminate - UV Disinfection Calculator</title>
</svelte:head>

{@render children()}

<CalculationProgressBar />
