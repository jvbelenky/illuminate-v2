<script lang="ts">
	// Lamps: add a lamp (fixture, then a placement), and the list of lamps. With
	// exactly one lamp selected, its row opens onto the lamp editor.
	import './parts.css';
	import ItemRow from './ItemRow.svelte';
	import PlacementPictogram from './PlacementPictogram.svelte';
	import { scrollRowIntoView } from './scrollRowIntoView';
	import type { Snippet } from 'svelte';
	import { lampColor, lampWavelength } from '$lib/utils/wavelengthColor';
	import { DISABLED_COLOR } from '$lib/utils/sceneColors';
	import { fixtureKeyOf } from '$lib/utils/lampFixture';
	import type { LampInstance } from '$lib/types/project';
	import { PLACEMENT_MODES, type PlacementMode } from '$lib/utils/lampPlacement';
	import type { PlanController } from '$lib/plan/planController.svelte';

	interface Props {
		controller: PlanController;
		/** The full editor for the selected lamp, with a callback that deselects it. */
		lampPanel?: Snippet<[LampInstance, () => void]>;
		/** Open the custom lamp manager ("Add custom lamp…"). */
		onAddCustomLamp?: () => void;
	}

	let { controller, lampPanel, onAddCustomLamp = () => {} }: Props = $props();
	const ctl = $derived(controller);

	const scene = $derived(ctl.scene());
	const lamps = $derived(scene.lamps);
	const fixtures = $derived(scene.fixtures);
	const groups = $derived([...new Set(fixtures.map((f) => f.group))]);
	const selected = $derived(ctl.selectedLampIds);

	const PLACEMENT_TITLES: Record<PlacementMode, string> = {
		downlight: 'On the ceiling, aimed straight down, where it adds the most coverage',
		corner: 'High in a corner, aimed across the room (each click takes the next free corner)',
		edge: 'High on a wall, aimed into the room (each click takes the next free wall)',
		horizontal: 'High on a wall, aimed level across the room for upper-room use',
	};

	function chooseFixture(select: HTMLSelectElement) {
		if (select.value === '__add_custom__') {
			select.value = ctl.addFixture;
			onAddCustomLamp();
			return;
		}
		ctl.addFixture = select.value;
	}

	async function addPlaced(mode: PlacementMode) {
		await ctl.addPlaced(mode);
		const id = ctl.selectedLampId;
		if (id) await scrollRowIntoView(id);
	}

	function fixtureName(l: LampInstance): string {
		const key = fixtureKeyOf(l);
		return fixtures.find((f) => f.key === key)?.label ?? '';
	}

	function wavelengthTitle(l: LampInstance): string {
		const wl = lampWavelength(l);
		return wl == null ? 'Wavelength not set' : `${Math.round(wl)} nm`;
	}
</script>

<div class="ep-part lamps-part">
	<section class="ep-addcard" aria-label="Add lamp">
		<h3 class="ep-addcard-title">Add lamp</h3>
		<select value={ctl.addFixture} onchange={(e) => chooseFixture(e.currentTarget)} aria-label="Fixture">
			<option value="" disabled>Choose a fixture…</option>
			{#each groups as g (g)}
				<optgroup label={g}>
					{#each fixtures.filter((f) => f.group === g) as f (f.key)}
						<option value={f.key}>{f.label}</option>
					{/each}
				</optgroup>
			{/each}
			<option value="__add_custom__">Add custom lamp…</option>
		</select>
		{#if ctl.addFixture}
			<div class="ep-grid ep-addbtns add-placements" role="group" aria-label="Placement">
				{#each PLACEMENT_MODES as pl (pl.mode)}
					<button type="button" class="secondary" disabled={ctl.addingLamp !== null} aria-busy={ctl.addingLamp === pl.mode} onclick={() => addPlaced(pl.mode)} title={PLACEMENT_TITLES[pl.mode]}><PlacementPictogram mode={pl.mode} /><span>{pl.label}</span></button>
				{/each}
			</div>
		{/if}
	</section>

	<div class="ep-section">
		<span>Lamps</span>
		{#if selected.length > 1}<span class="ep-chip">{selected.length} selected</span>{/if}
	</div>
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
	.add-placements {
		gap: 6px;
		grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
	}
</style>
