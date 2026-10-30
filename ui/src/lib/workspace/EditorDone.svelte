<script lang="ts">
	import type { PlanController } from '$lib/plan/planController.svelte';

	interface Props {
		controller: PlanController;
		onDone: () => void;
		/** In the editor panel's title bar (desktop) or at the end of the stage tabs (phone). */
		placement?: 'bar' | 'tabs';
	}

	let { controller, onDone, placement = 'bar' }: Props = $props();

	/** Leave for the summary, asking first if an invalid outline is on screen. */
	function done() {
		controller.requestLeave(() => onDone());
	}
</script>

<button type="button" class="editor-done" class:tabs={placement === 'tabs'} onclick={done}>Done</button>

<style>
	.editor-done {
		flex: none;
		height: 20px;
		padding: 0 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-primary);
		background: var(--color-primary);
		color: #fff;
		font: inherit;
		font-size: var(--font-size-sm);
		font-weight: 600;
		line-height: 1;
		cursor: pointer;
	}
	.editor-done:hover {
		background: var(--color-primary-hover);
	}
	.editor-done.tabs {
		height: 28px;
		padding: 0 12px;
		border-radius: 6px;
	}
</style>
