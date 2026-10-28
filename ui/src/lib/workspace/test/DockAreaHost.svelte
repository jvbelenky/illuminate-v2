<script lang="ts">
	import DockArea from '../DockArea.svelte';
	import CalculateButton from '$lib/components/CalculateButton.svelte';

	let { withCalculate = false, ...props }: any = $props();
</script>

<DockArea {...props} calculate={withCalculate ? calc : undefined}>
	{#snippet panel(id)}<div data-testid={'content-' + id}>{id}</div>{/snippet}
	{#snippet main()}<div data-testid="main-view">Main</div>{/snippet}
</DockArea>

{#snippet calc()}
	<CalculateButton layout="panel" />
{/snippet}
