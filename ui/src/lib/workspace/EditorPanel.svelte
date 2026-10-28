<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { PlanController } from '$lib/plan/planController.svelte';
	import type { CalcZone, LampInstance, SceneObject } from '$lib/types/project';
	import { workspaceUi } from '$lib/stores/workspaceUi';
	import { STAGES, ROOM_PARTS, neighbours, planContext, stageDone, type EditorStage, type RoomPart, type NavStop } from '$lib/workspace/editorNav';
	import ReflectanceStep from '$lib/components/ReflectanceStep.svelte';
	import FloorplanPart from './parts/FloorplanPart.svelte';
	import StructuresPart from './parts/StructuresPart.svelte';
	import CeilingPart from './parts/CeilingPart.svelte';
	import LampsPart from './parts/LampsPart.svelte';
	import ZonesPart from './parts/ZonesPart.svelte';

	interface Props {
		controller: PlanController;
		onDone: () => void;
		onShowReflectanceSettings: () => void;
		onAddCustomLamp?: () => void;
		lampPanel?: Snippet<[LampInstance, () => void]>;
		zonePanel?: Snippet<[CalcZone, () => void]>;
		objectPanel?: Snippet<[SceneObject]>;
	}

	let { controller, onDone, onShowReflectanceSettings, onAddCustomLamp, lampPanel, zonePanel, objectPanel }: Props = $props();
	const ctl = $derived(controller);

	const stage = $derived($workspaceUi.stage);
	const part = $derived($workspaceUi.part);
	const nav = $derived(neighbours(stage, stage === 'room' ? part : null));
	const progress = $derived({ hasOutline: ctl.hasOutline, lamps: ctl.scene().lamps, userZoneCount: ctl.userZones.length });

	let bodyEl: HTMLElement | undefined = $state();

	/** Go to a stop, asking first if an invalid outline is on screen. */
	function go(nextStage: EditorStage, nextPart?: RoomPart) {
		if (nextStage === stage && (stage !== 'room' || (nextPart ?? part) === part)) return;
		ctl.requestLeave(() => {
			workspaceUi.goTo(nextStage, nextPart);
			ctl.setContext(planContext('editor', nextStage, nextPart ?? part));
			if (bodyEl) bodyEl.scrollTop = 0;
		});
	}

	function goStop(s: NavStop) {
		go(s.stage, s.part ?? undefined);
	}

	function done() {
		ctl.requestLeave(() => onDone());
	}
</script>

<div class="editor-panel">
	<div class="editor-head">
		<span>Edit</span>
		<button type="button" class="editor-done" onclick={done}>Done</button>
	</div>
	<div class="editor-stages" role="tablist" aria-label="Stages">
		{#each STAGES as s (s.id)}
			<button
				type="button"
				role="tab"
				class="editor-stage"
				class:on={stage === s.id}
				data-stage={s.id}
				aria-selected={stage === s.id}
				onclick={() => go(s.id)}
			>
				{#if stageDone(s.id, progress)}
					<span class="n done" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>
				{:else}
					<span class="n" aria-hidden="true">{s.n}</span>
				{/if}
				<span class="lbl">{s.label}</span>
			</button>
		{/each}
	</div>
	<div class="editor-stagebody">
		{#if stage === 'room'}
			<div class="editor-parts" role="tablist" aria-label="Room">
				{#each ROOM_PARTS as p (p.id)}
					<button
						type="button"
						role="tab"
						class="editor-part"
						class:on={part === p.id}
						data-part={p.id}
						aria-selected={part === p.id}
						onclick={() => go('room', p.id)}
					>{p.label}</button>
				{/each}
			</div>
		{/if}
		<div class="editor-body" bind:this={bodyEl}>
			{#if stage === 'room'}
				{#if part === 'floorplan'}
					<FloorplanPart controller={ctl} />
				{:else if part === 'structures'}
					<StructuresPart controller={ctl} {objectPanel} />
				{:else if part === 'ceiling'}
					<CeilingPart controller={ctl} />
				{:else}
					<ReflectanceStep {onShowReflectanceSettings} onHover={(s) => (ctl.hoveredSurface = s)} />
				{/if}
			{:else if stage === 'lamps'}
				<LampsPart controller={ctl} {lampPanel} {onAddCustomLamp} />
			{:else}
				<ZonesPart controller={ctl} {zonePanel} />
			{/if}
		</div>
	</div>
	<div class="editor-nav">
		{#if nav.prev}
			{@const prev = nav.prev}
			<button type="button" class="editor-back" onclick={() => goStop(prev)}>← {prev.label}</button>
		{:else}
			<span></span>
		{/if}
		{#if nav.next}
			{@const next = nav.next}
			<button type="button" class="editor-next" onclick={() => goStop(next)}>{next.label} →</button>
		{:else}
			<button type="button" class="editor-next editor-done" onclick={done}>Done</button>
		{/if}
	</div>
</div>

<style>
	.editor-panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		background: var(--color-bg-secondary);
		container-type: inline-size;
	}
	.editor-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 10px 0 14px;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}
	button {
		font: inherit;
		cursor: pointer;
	}
	.editor-done {
		text-transform: none;
		letter-spacing: 0;
		padding: 4px 12px;
		border-radius: 6px;
		border: 1px solid var(--color-primary);
		background: var(--color-primary);
		color: #fff;
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.editor-done:hover {
		background: var(--color-primary-hover);
	}
	/* The tabs run edge to edge on top of the card, whose sides are the panel's own border.
	   The row draws the line under the tabs; the open tab covers it and joins the body. */
	.editor-stages {
		display: flex;
		gap: 4px;
		padding: 10px 0 0;
		background: linear-gradient(var(--color-border), var(--color-border)) bottom / 100% 1px no-repeat;
	}
	/* Number and label on one line at every width */
	.editor-stage {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px 6px;
		border: 1px solid var(--color-border);
		border-radius: 8px 8px 0 0;
		background: var(--color-btn-fill);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		line-height: 1.2;
		white-space: nowrap;
	}
	/* The outer tabs keep their side border and rounded corner, laid over the card's own edge */
	.editor-stage:first-child {
		margin-left: -1px;
	}
	.editor-stage:last-child {
		margin-right: -1px;
	}
	.editor-stage:hover:not(.on) {
		background: var(--color-btn-fill-hover);
		color: var(--color-text);
	}
	.editor-stage .lbl {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* The step number in a circle; a complete step is a filled circle with a checkmark (as the old sidebar) */
	.editor-stage .n {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		box-sizing: border-box;
		font-size: var(--font-size-xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.editor-stage .n.done {
		background: color-mix(in srgb, var(--color-success) 18%, transparent);
		border-color: color-mix(in srgb, var(--color-success) 50%, transparent);
		color: var(--color-success);
	}
	.editor-stage.on {
		border-bottom: 0;
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		font-weight: 600;
	}
	@container (max-width: 359px) {
		.editor-stages {
			gap: 3px;
		}
		.editor-stage {
			gap: 4px;
			padding: 6px 3px;
		}
	}
	.editor-stagebody {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-bg-tertiary);
	}
	.editor-parts {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		padding: 10px 10px 2px;
		container-type: inline-size;
	}
	.editor-part {
		flex: 0 1 auto;
		min-width: 0;
		padding: 7px 11px;
		border: 0;
		border-radius: 14px;
		background: none;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		white-space: nowrap;
	}
	@container (max-width: 300px) {
		.editor-part {
			padding: 7px 4px;
			font-size: 0.72rem;
		}
	}
	.editor-part:hover {
		color: var(--color-text);
	}
	.editor-part.on {
		background: var(--color-btn-fill);
		color: var(--color-text);
		font-weight: 600;
	}
	.editor-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 12px;
	}
	@container (max-width: 359px) {
		.editor-body {
			padding: 12px 6px;
		}
	}
	.editor-nav {
		display: flex;
		justify-content: space-between;
		padding: 10px;
		background: var(--color-bg-tertiary);
		border-top: 1px solid var(--color-border);
	}
	.editor-back,
	.editor-next:not(.editor-done) {
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-btn-fill);
		color: var(--color-text);
		font-size: var(--font-size-sm);
	}
	.editor-back:hover,
	.editor-next:not(.editor-done):hover {
		background: var(--color-btn-fill-hover);
		border-color: var(--color-primary);
	}
</style>
