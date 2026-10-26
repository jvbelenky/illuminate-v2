<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { PlanController } from '$lib/plan/planController.svelte';
	import type { CalcZone, LampInstance, SceneObject } from '$lib/types/project';
	import { workspaceUi } from '$lib/stores/workspaceUi';
	import { STAGES, ROOM_PARTS, neighbours, planContext, type EditorStage, type RoomPart, type NavStop } from '$lib/workspace/editorNav';
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
		objectPanel?: Snippet<[SceneObject, () => void]>;
	}

	let { controller, onDone, onShowReflectanceSettings, onAddCustomLamp, lampPanel, zonePanel, objectPanel }: Props = $props();
	const ctl = $derived(controller);

	const stage = $derived($workspaceUi.stage);
	const part = $derived($workspaceUi.part);
	const nav = $derived(neighbours(stage, stage === 'room' ? part : null));

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
			><span class="n" aria-hidden="true">{s.n}</span>{s.label}</button>
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
	.editor-stages {
		display: flex;
		gap: 4px;
		padding: 10px 10px 0;
	}
	.editor-stage {
		flex: 1;
		padding: 7px 4px;
		border: 1px solid var(--color-border);
		border-bottom: 0;
		border-radius: 8px 8px 0 0;
		background: var(--color-bg);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		text-align: center;
	}
	.editor-stage .n {
		display: block;
		font-size: var(--font-size-xs);
		opacity: 0.8;
	}
	.editor-stage.on {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		font-weight: 600;
		border-color: var(--color-primary);
	}
	.editor-stagebody {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		margin: 0 10px;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-bottom: 0;
	}
	.editor-parts {
		display: flex;
		justify-content: space-between;
		padding: 8px 6px 0;
	}
	.editor-part {
		padding: 4px 6px;
		border: 0;
		border-radius: 14px;
		background: none;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		white-space: nowrap;
	}
	.editor-part:hover {
		color: var(--color-text);
	}
	.editor-part.on {
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: inset 0 0 0 1px var(--color-primary);
	}
	.editor-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 12px;
	}
	.editor-nav {
		display: flex;
		justify-content: space-between;
		margin: 0 10px 10px;
		padding: 10px;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: 0 0 8px 8px;
	}
	.editor-back,
	.editor-next:not(.editor-done) {
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: var(--font-size-sm);
	}
	.editor-back {
		background: transparent;
	}
	.editor-back:hover,
	.editor-next:not(.editor-done):hover {
		border-color: var(--color-primary);
	}
</style>
