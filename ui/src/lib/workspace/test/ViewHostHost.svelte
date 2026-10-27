<script lang="ts">
	import ViewHost from '../ViewHost.svelte';

	let props: any = $props();
</script>

<ViewHost {...props}>
	{#snippet view2d(mini: boolean)}<div data-testid="v2d" data-mini={String(mini)}>2D</div>{/snippet}
	{#snippet view3d(mini: boolean)}<div data-testid="v3d" data-mini={String(mini)}>3D</div>{/snippet}
</ViewHost>
