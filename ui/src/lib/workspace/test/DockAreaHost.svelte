<script lang="ts">
	import DockArea from '../DockArea.svelte';
	import EditorModeSwitch from '../EditorModeSwitch.svelte';
	import type { PlanController } from '$lib/plan/planController.svelte';

	// Given `mode`, the Editor panel's title is the Summary | Editor switch
	let { mode, onSummary = () => {}, onEditor = () => {}, ...props }: any = $props();
	// Leaving is always allowed here
	const controller = { requestLeave: (go: () => void) => go() } as unknown as PlanController;
</script>

<DockArea {...props} editorHeading={mode ? editorHeading : undefined}>
	{#snippet panel(id)}<div data-testid={'content-' + id}>{id}</div>{/snippet}
	{#snippet main()}<div data-testid="main-view">Main</div>{/snippet}
</DockArea>

{#snippet editorHeading()}
	<EditorModeSwitch {mode} {controller} {onSummary} {onEditor} />
{/snippet}
