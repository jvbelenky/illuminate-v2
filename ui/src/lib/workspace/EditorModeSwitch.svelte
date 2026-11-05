<script lang="ts">
	// Summary | Editor: the left panel's title on a desktop (in place of the
	// panel's name), and the head of the Design tab on a phone. The active side
	// wears the category blue, as the 2D | 3D switch does.
	import type { PlanController } from '$lib/plan/planController.svelte';
	import type { WorkspaceMode } from './editorNav';

	interface Props {
		mode: WorkspaceMode;
		controller: PlanController;
		/** Back to the summary (once leaving is allowed). */
		onSummary: () => void;
		/** Into the editor, where the user last was. */
		onEditor: () => void;
		/** In the dock panel's title bar (desktop) or atop the Design tab (phone). */
		placement?: 'bar' | 'phone';
	}

	let { mode, controller, onSummary, onEditor, placement = 'bar' }: Props = $props();

	const OPTIONS: { value: WorkspaceMode; label: string; title: string }[] = [
		{ value: 'summary', label: 'Summary', title: 'Show the summary' },
		{ value: 'editor', label: 'Editor', title: 'Open the editor' }
	];

	function select(next: WorkspaceMode) {
		if (next === mode) return;
		// Leaving the editor asks first if an invalid outline is on screen
		if (next === 'summary') controller.requestLeave(() => onSummary());
		else onEditor();
	}
</script>

<div class="mv-seg mode-switch" class:phone={placement === 'phone'} role="group" aria-label="Summary or editor">
	{#each OPTIONS as o (o.value)}
		<button
			type="button"
			class="mv-btn"
			data-mode={o.value}
			title={o.title}
			aria-pressed={mode === o.value}
			onclick={() => select(o.value)}>{o.label}</button
		>
	{/each}
</div>

<style>
	/* In the 30 px title bar: 22 px tall, the bar's text size */
	.mode-switch {
		flex: none;
		height: 22px;
		cursor: default;
	}
	.mode-switch .mv-btn {
		height: 22px;
		min-width: 0;
		padding: 0 10px;
		font-size: var(--font-size-xs);
	}
	/* On a phone: a full-width row, the tabs' height */
	.mode-switch.phone {
		display: flex;
		height: 36px;
	}
	.mode-switch.phone .mv-btn {
		flex: 1 1 0;
		height: 36px;
		font-size: var(--font-size-sm);
	}
</style>
