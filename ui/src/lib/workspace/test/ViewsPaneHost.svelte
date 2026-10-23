<script lang="ts">
	import ViewsPane from '../ViewsPane.svelte';

	let props: any = $props();
</script>

<ViewsPane {...props}>
	{#snippet view2d()}<div data-testid="v2d">2D</div>{/snippet}
	{#snippet view3d()}<div data-testid="v3d">3D</div>{/snippet}
	{#snippet calculate()}<button>Calc</button>{/snippet}
</ViewsPane>
