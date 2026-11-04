<script lang="ts">
	// Room › Structures: the structures (scene objects) in the room. "+ Add structure" drops a
	// default box and opens it; the open row carries the shape line (Rectangle, or
	// Polygon with its vertices; Redraw footprint, Edit vertices), the editor panel.
	import './parts.css';
	import ItemRow from './ItemRow.svelte';
	import Glyph from '$lib/workspace/Glyph.svelte';
	import type { Snippet } from 'svelte';
	import { scrollRowIntoView } from './scrollRowIntoView';
	import { defaultObject, nextStructureName, type SceneObject } from '$lib/types/project';
	import { objectFootprint } from '$lib/utils/objectGeometry';
	import { shapeKind } from '$lib/plan/shapeTransform';
	import type { PlanController } from '$lib/plan/planController.svelte';

	let { controller, objectPanel }: { controller: PlanController; objectPanel?: Snippet<[SceneObject]> } = $props();
	const ctl = $derived(controller);

	const scene = $derived(ctl.scene());
	const objects = $derived(scene.objects);

	async function addStructure() {
		const { room, units } = ctl.scene();
		try {
			const id = await ctl.actions.addObstacle(defaultObject(room, units, { name: nextStructureName(ctl.scene().objects) }));
			ctl.selectObstacle(id);
			await scrollRowIntoView(id);
		} catch (e) {
			console.error('Failed to add structure:', e);
		}
	}

	/** "Rectangle", or "Polygon, N vertices", in the structure's own frame. */
	function shapeLabel(o: SceneObject): string {
		return shapeKind(objectFootprint(o), o.yaw);
	}

	/** Copy or delete this row's structure: the strip's and the keys' actions, on it. */
	function copy(id: string) {
		if (ctl.selectedId !== id) ctl.selectObstacle(id);
		ctl.duplicateSelected();
	}
	function remove(id: string) {
		if (ctl.selectedId !== id) ctl.selectObstacle(id);
		ctl.deleteSelected();
	}
</script>

<div class="ep-part structures-part">
	<button type="button" class="secondary" onclick={addStructure}>+ Add structure</button>
	{#if objects.length === 0}
		<span class="ep-chip">None</span>
	{/if}
	<div class="ep-list roomy">
		{#each objects as o (o.id)}
			{@const open = ctl.selectedId === o.id}
			{@const redrawing = ctl.drawing && ctl.redrawObstacleId === o.id}
			{@const cornering = open && ctl.shapeMode === 'corners'}
			<ItemRow
				id={o.id}
				name={o.name ?? ''}
				{open}
				hidden={scene.hidden.objects.has(o.id)}
				enabled={o.enabled !== false}
				onToggleOpen={() => ctl.selectObstacle(open ? null : o.id)}
				onRename={(name) => ctl.actions.updateObstacle(o.id, { name })}
				onToggleHidden={() => ctl.actions.setHidden('objects', o.id, !scene.hidden.objects.has(o.id))}
				onToggleEnabled={() => ctl.actions.updateObstacle(o.id, { enabled: !(o.enabled !== false) })}
				onHover={(on) => ctl.hoverItem('objects', o.id, on)}
				onCopy={() => copy(o.id)}
				onDelete={() => remove(o.id)}
				copyDisabled={ctl.drawing}
				deleteDisabled={ctl.drawing}
			>
				{#snippet lead()}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></svg>
				{/snippet}
				<div class="structure-shape">
					<span class="structure-shape-label">{shapeLabel(o)}</span>
					<div class="shape-tools">
						<button type="button" class="secondary plan-btn" class:active={redrawing} aria-pressed={redrawing} onclick={() => ctl.startObstacleRedraw(o.id)}><Glyph name="pen" size={16} /><span>Redraw footprint</span></button>
						<button type="button" class="secondary plan-btn" class:active={cornering} aria-pressed={cornering} disabled={ctl.drawing} onclick={() => ctl.editStructureCorners(o.id)}><Glyph name="corners" size={16} /><span>Edit vertices</span></button>
					</div>
				</div>
				{#if objectPanel}{@render objectPanel(o)}{/if}
			</ItemRow>
		{/each}
	</div>
</div>

<style>
	.structure-shape {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.structure-shape-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
</style>
