<script lang="ts">
	// Tools › Ceiling designer…: the ceiling's settings and items on the left, its
	// plan on the right. The window hosts the ceiling designer's own PlanController
	// (always in the 'ceiling' context), so the main view keeps its own context;
	// while the window is in front the plan's keys are its own (planShouldHandleKey
	// with inDialog). Edits apply at once and undo like the rest of the app; the
	// canvas's own view tools carry Pan | Zoom, − +, Fit and Undo | Redo.
	import Modal from '$lib/components/Modal.svelte';
	import PlanPane from '$lib/plan/PlanPane.svelte';
	import PlanEditStrip from '$lib/plan/PlanEditStrip.svelte';
	import CeilingPart from '$lib/workspace/parts/CeilingPart.svelte';
	import type { PlanController } from '$lib/plan/planController.svelte';

	interface Props {
		controller: PlanController;
		onClose: () => void;
	}

	let { controller, onClose }: Props = $props();
</script>

<Modal
	title="Ceiling designer"
	{onClose}
	dockId="ceiling-designer"
	width="90vw"
	maxWidth="none"
	maxHeight="85vh"
	contentClass="ceiling-designer"
	titleFontSize="1rem"
	onEscapeKey={() => controller.onEscapeKey()}
>
	{#snippet body()}
		<div class="cd-body" data-plan-dialog data-plan-scope>
			<div class="cd-list">
				<CeilingPart {controller} />
			</div>
			<div class="cd-plan">
				<div class="cd-tools">
					<PlanEditStrip {controller} />
				</div>
				<div class="cd-canvas">
					<PlanPane {controller} toolbar={false} handleEscape={false} />
				</div>
			</div>
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="cd-footer">
			<button type="button" class="secondary" onclick={onClose}>Close</button>
		</div>
	{/snippet}
</Modal>

<style>
	:global(.modal-content.ceiling-designer) {
		height: 85vh;
	}
	@media (min-width: 768px) {
		:global(.modal-content.ceiling-designer) {
			min-width: 720px;
			min-height: 480px;
		}
	}
	.cd-body {
		display: grid;
		grid-template-columns: 340px minmax(0, 1fr);
		height: 100%;
		min-height: 0;
	}
	.cd-list {
		min-height: 0;
		overflow: auto;
		padding: 12px;
		background: var(--color-bg-tertiary);
		border-right: 1px solid var(--color-border);
	}
	.cd-plan {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		padding: 8px;
	}
	.cd-tools {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 36px;
	}
	.cd-canvas {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.cd-footer {
		display: flex;
		justify-content: flex-end;
		padding: var(--spacing-sm) var(--spacing-md);
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
	}
	/* A phone: the plan on top, the list under it; the sheet scrolls */
	@media (max-width: 767px) {
		.cd-body {
			display: flex;
			flex-direction: column;
			height: auto;
		}
		.cd-plan {
			order: -1;
			height: 55vh;
			flex: none;
		}
		.cd-list {
			overflow: visible;
			border-right: 0;
			border-top: 1px solid var(--color-border);
		}
	}
</style>
