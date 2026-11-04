<script lang="ts">
	// Lamps: "+ Add lamp" (a new lamp, opened, its editor asking for a fixture), and
	// the list of lamps. With exactly one lamp selected, its row opens onto the lamp editor.
	import './parts.css';
	import ItemRow from './ItemRow.svelte';
	import { promptForFixture } from './scrollRowIntoView';
	import type { Snippet } from 'svelte';
	import { lampColor, lampWavelength } from '$lib/utils/wavelengthColor';
	import { DISABLED_COLOR } from '$lib/utils/sceneColors';
	import { fixtureKeyOf } from '$lib/utils/lampFixture';
	import type { LampInstance } from '$lib/types/project';
	import type { PlanController } from '$lib/plan/planController.svelte';

	interface Props {
		controller: PlanController;
		/** The full editor for the selected lamp, with a callback that deselects it. */
		lampPanel?: Snippet<[LampInstance, () => void]>;
	}

	let { controller, lampPanel }: Props = $props();
	const ctl = $derived(controller);

	const scene = $derived(ctl.scene());
	const lamps = $derived(scene.lamps);
	const fixtures = $derived(scene.fixtures);
	const selected = $derived(ctl.selectedLampIds);

	async function addLamp() {
		const id = await ctl.addNewLamp();
		if (id) await promptForFixture(id);
	}

	function fixtureName(l: LampInstance): string {
		const key = fixtureKeyOf(l);
		return fixtures.find((f) => f.key === key)?.label ?? '';
	}

	/** Copy or delete this row's lamp: the strip's and the keys' actions, on it alone. */
	function copyLamp(id: string) {
		if (ctl.selectedLampId !== id) ctl.selectLamp(id);
		ctl.copySelectedLamps();
	}
	function deleteLamp(id: string) {
		if (ctl.selectedLampId !== id) ctl.selectLamp(id);
		ctl.deleteSelectedLamps();
	}

	function wavelengthTitle(l: LampInstance): string {
		const wl = lampWavelength(l);
		return wl == null ? 'Wavelength not set' : `${Math.round(wl)} nm`;
	}
</script>

<div class="ep-part lamps-part">
	<button type="button" class="secondary" disabled={ctl.addingLamp} aria-busy={ctl.addingLamp} onclick={addLamp}>+ Add lamp</button>

	{#if selected.length > 1}
		<div class="ep-section"><span class="ep-chip">{selected.length} selected</span></div>
	{/if}
	{#if lamps.length === 0}
		<span class="ep-chip">None</span>
	{/if}
	<div class="ep-list">
		{#each lamps as l (l.id)}
			{@const isSelected = selected.includes(l.id)}
			{@const open = isSelected && selected.length === 1}
			<ItemRow
				id={l.id}
				name={l.name || l.id}
				subtitle={fixtureName(l)}
				italicSubtitle
				{open}
				selected={isSelected}
				hidden={scene.hidden.lamps.has(l.id)}
				enabled={l.enabled !== false}
				onToggleOpen={(e) => (e.shiftKey ? ctl.toggleLamp(l.id) : ctl.selectLamp(open ? null : l.id))}
				onRename={(name) => ctl.actions.updateLamp(l.id, { name })}
				onToggleHidden={() => ctl.actions.setHidden('lamps', l.id, !scene.hidden.lamps.has(l.id))}
				onToggleEnabled={() => ctl.actions.updateLamp(l.id, { enabled: !(l.enabled !== false) })}
				onHover={(on) => ctl.hoverItem('lamps', l.id, on)}
				onCopy={() => copyLamp(l.id)}
				onDelete={() => deleteLamp(l.id)}
			>
				{#snippet lead()}
					<span class="dot" style:background={l.enabled === false ? DISABLED_COLOR : lampColor(l)} title={wavelengthTitle(l)} role="img" aria-label={wavelengthTitle(l)}></span>
				{/snippet}
				{#if lampPanel}{@render lampPanel(l, () => ctl.selectLamp(null))}{/if}
			</ItemRow>
		{/each}
	</div>
</div>

<style>
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
	}
</style>
