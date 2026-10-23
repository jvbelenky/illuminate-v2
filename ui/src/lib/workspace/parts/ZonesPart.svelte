<script lang="ts">
	// Zones: the standard zones (a checkbox and, while on, their rows), the
	// "Add zone" card, and the zones of your own. The open zone carries its editor.
	import './parts.css';
	import ItemRow from './ItemRow.svelte';
	import CalcTypeIllustration from '$lib/components/CalcTypeIllustration.svelte';
	import type { Snippet } from 'svelte';
	import { defaultObject, type CalcZone } from '$lib/types/project';
	import { fromMeters, roundToUnit } from '$lib/utils/unitConversion';
	import type { PlanController } from '$lib/plan/planController.svelte';

	let { controller, zonePanel }: { controller: PlanController; zonePanel?: Snippet<[CalcZone, () => void]> } = $props();
	const ctl = $derived(controller);

	const scene = $derived(ctl.scene());
	const standardZones = $derived(scene.zones.filter((z) => z.isStandard));
	const userZones = $derived(ctl.userZones);

	type ZoneType = 'plane' | 'volume' | 'point';
	const TYPES: { type: ZoneType; label: string; icon: 'calc_plane' | 'calc_vol' | 'calc_point' }[] = [
		{ type: 'plane', label: 'Plane', icon: 'calc_plane' },
		{ type: 'volume', label: 'Volume', icon: 'calc_vol' },
		{ type: 'point', label: 'Point', icon: 'calc_point' },
	];

	function iconOf(z: CalcZone): 'calc_plane' | 'calc_vol' | 'calc_point' {
		return z.type === 'volume' ? 'calc_vol' : z.type === 'point' ? 'calc_point' : 'calc_plane';
	}

	function deselect() {
		ctl.selectZone(null);
	}

	/** Standard eye height (1.8 m) in the project's units, as the zone editor's head-height preset does. */
	function eyeHeight(): number {
		const units = ctl.scene().units;
		return roundToUnit(fromMeters(1.8, units), units);
	}

	async function addZone(type: ZoneType) {
		const { room, units, roomZ } = ctl.scene();
		const eye = eyeHeight();
		let geometry: Partial<CalcZone>;
		if (type === 'plane') {
			geometry = { fit_room: true, height: eye };
		} else if (type === 'volume') {
			geometry = { fit_room: true, z_min: 0, z_max: roomZ };
		} else {
			// Room centre at eye height, aimed level (one metre ahead, along +y)
			const { x, y } = defaultObject(room, units);
			const ahead = roundToUnit(fromMeters(1, units), units);
			geometry = { x, y, z: eye, aim_x: x, aim_y: y + ahead, aim_z: eye };
		}
		try {
			ctl.selectZone(await ctl.actions.addZone(type, geometry));
		} catch (e) {
			console.error('Failed to add zone:', e);
		}
	}

	function hiddenZone(z: CalcZone): boolean {
		return scene.hidden.zones.has(z.id);
	}
</script>

<div class="ep-part zones-part">
	<label class="ep-check">
		<input type="checkbox" checked={scene.room.useStandardZones} onchange={(e) => ctl.actions.updateRoom({ useStandardZones: (e.currentTarget as HTMLInputElement).checked })} />
		<span>Use standard zones</span>
	</label>

	{#if scene.room.useStandardZones && standardZones.length > 0}
		<div class="ep-section">Standard</div>
		<div class="ep-list">
			{#each standardZones as z (z.id)}
				<ItemRow
					id={z.id}
					name={z.name || z.id}
					open={false}
					hidden={hiddenZone(z)}
					enabled={z.enabled !== false}
					onToggleOpen={() => {}}
					onRename={() => {}}
					onToggleHidden={() => ctl.actions.setHidden('zones', z.id, !hiddenZone(z))}
					onToggleEnabled={() => ctl.actions.updateZone(z.id, { enabled: !(z.enabled !== false) })}
				>
					{#snippet lead()}<CalcTypeIllustration type={iconOf(z)} size={16} />{/snippet}
				</ItemRow>
			{/each}
		</div>
	{/if}

	<section class="ep-addcard" aria-label="Add zone">
		<h3 class="ep-addcard-title">Add zone</h3>
		<div class="ep-grid" style="--cols: 3">
			{#each TYPES as t (t.type)}
				<button type="button" class="secondary" onclick={() => addZone(t.type)}>
					<CalcTypeIllustration type={t.icon} size={20} />
					<span>{t.label}</span>
				</button>
			{/each}
		</div>
	</section>

	<div class="ep-section">Zones</div>
	{#if userZones.length === 0}
		<span class="ep-chip">None</span>
	{/if}
	<div class="ep-list">
		{#each userZones as z (z.id)}
			{@const open = ctl.selectedZoneId === z.id}
			<ItemRow
				id={z.id}
				name={z.name || z.id}
				subtitle={ctl.zoneSummary(z)}
				{open}
				hidden={hiddenZone(z)}
				enabled={z.enabled !== false}
				onToggleOpen={() => ctl.selectZone(open ? null : z.id)}
				onRename={(name) => ctl.actions.updateZone(z.id, { name })}
				onToggleHidden={() => ctl.actions.setHidden('zones', z.id, !hiddenZone(z))}
				onToggleEnabled={() => ctl.actions.updateZone(z.id, { enabled: !(z.enabled !== false) })}
			>
				{#snippet lead()}<CalcTypeIllustration type={iconOf(z)} size={16} />{/snippet}
				{#if zonePanel}{@render zonePanel(z, deselect)}{/if}
			</ItemRow>
		{/each}
	</div>
</div>
