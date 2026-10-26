<script lang="ts">
	// Room › Structures: the structures (scene objects) in the room. "+ Add structure" drops a
	// default box and opens it; the open row carries the editor panel.
	import './parts.css';
	import ItemRow from './ItemRow.svelte';
	import type { Snippet } from 'svelte';
	import { scrollRowIntoView } from './scrollRowIntoView';
	import { defaultObject, type SceneObject } from '$lib/types/project';
	import type { PlanController } from '$lib/plan/planController.svelte';

	let { controller, objectPanel }: { controller: PlanController; objectPanel?: Snippet<[SceneObject]> } = $props();
	const ctl = $derived(controller);

	const scene = $derived(ctl.scene());
	const objects = $derived(scene.objects);

	async function addStructure() {
		const { room, units } = ctl.scene();
		try {
			const id = await ctl.actions.addObstacle(defaultObject(room, units));
			ctl.selectObstacle(id);
			await scrollRowIntoView(id);
		} catch (e) {
			console.error('Failed to add structure:', e);
		}
	}
</script>

<div class="ep-part structures-part">
	<button type="button" class="secondary" onclick={addStructure}>+ Add structure</button>
	<div class="ep-section">Structures</div>
	{#if objects.length === 0}
		<span class="ep-chip">None</span>
	{/if}
	<div class="ep-list">
		{#each objects as o (o.id)}
			{@const open = ctl.selectedId === o.id}
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
			>
				{#snippet lead()}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></svg>
				{/snippet}
				{#if objectPanel}{@render objectPanel(o)}{/if}
			</ItemRow>
		{/each}
	</div>
</div>
