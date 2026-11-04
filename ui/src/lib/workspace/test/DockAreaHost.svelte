<script lang="ts">
	import DockArea from '../DockArea.svelte';
	import EditorDone from '../EditorDone.svelte';
	import type { PlanController } from '$lib/plan/planController.svelte';

	let { onEditorDone, ...props }: any = $props();
	// Leaving is always allowed here
	const controller = { requestLeave: (go: () => void) => go() } as unknown as PlanController;
</script>

<DockArea {...props} editorTools={onEditorDone ? editorDone : undefined}>
	{#snippet panel(id)}<div data-testid={'content-' + id}>{id}</div>{/snippet}
	{#snippet main()}<div data-testid="main-view">Main</div>{/snippet}
</DockArea>

{#snippet editorDone()}
	<EditorDone {controller} onDone={onEditorDone} />
{/snippet}
