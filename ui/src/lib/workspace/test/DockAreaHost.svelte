<script lang="ts">
	import DockArea from '../DockArea.svelte';

	let props: any = $props();
</script>

<DockArea {...props}>
	{#snippet panel(id)}<div data-testid={'content-' + id}>{id}</div>{/snippet}
	{#snippet main()}<div data-testid="main-view">Main</div>{/snippet}
</DockArea>
