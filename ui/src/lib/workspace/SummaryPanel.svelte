<script lang="ts">
	// The read-only summary shown after Done: room facts and the item lists, each
	// under a full-width section button that reopens the editor at that step. Rows
	// are the editor's rows with nothing to open; only the eye and calculator work.
	import './parts/parts.css';
	import ItemRow from './parts/ItemRow.svelte';
	import CalcTypeIllustration from '$lib/components/CalcTypeIllustration.svelte';
	import { lampColor, lampWavelength } from '$lib/utils/wavelengthColor';
	import { DISABLED_COLOR } from '$lib/utils/sceneColors';
	import { fixtureKeyOf } from '$lib/utils/lampFixture';
	import { polygonArea } from '$lib/utils/roomGeometry';
	import { unitAbbrev } from '$lib/utils/unitConversion';
	import type { CalcZone, LampInstance } from '$lib/types/project';
	import type { PlanScene, PlanActions } from '$lib/plan/planActions';
	import type { EditorStage, RoomPart } from './editorNav';

	interface Props {
		scene: PlanScene;
		actions: PlanActions;
		onEdit: (stage: EditorStage, part?: RoomPart) => void;
		/** The pointer entered or left an item's row. */
		onHover?: (kind: 'lamps' | 'zones' | 'objects', id: string, hovered: boolean) => void;
	}

	let { scene, actions, onEdit, onHover = () => {} }: Props = $props();

	const SECTIONS: { edit: string; label: string }[] = [
		{ edit: 'room:floorplan', label: 'Room' },
		{ edit: 'room:structures', label: 'Structures' },
		{ edit: 'lamps', label: 'Lamps' },
		{ edit: 'zones', label: 'Calc zones' },
	];

	function open(edit: string) {
		const [stage, part] = edit.split(':');
		onEdit(stage as EditorStage, part as RoomPart | undefined);
	}

	const abbrev = $derived(unitAbbrev(scene.units));
	/** Lengths trimmed of trailing zeros at the project's precision. */
	const len = (v: number) => String(+v.toFixed(scene.precision));
	/** Reflectances are fractions, so they keep at least two decimals. */
	const refl = (v: number) => String(+v.toFixed(Math.max(2, scene.precision)));
	const whole = (v: number) => Math.round(v).toLocaleString();

	const area = $derived(polygonArea(scene.vertices));
	const dimensions = $derived(
		scene.room.shape === 'polygon'
			? `${scene.vertices.length}-corner outline · ${len(scene.roomZ)} ${abbrev} high`
			: `${len(scene.room.x)} × ${len(scene.room.y)} × ${len(scene.roomZ)} ${abbrev}`,
	);
	const reflections = $derived.by(() => {
		if (!scene.room.enable_reflectance) return 'Off';
		const rs = Object.values(scene.room.reflectances ?? {});
		if (rs.length === 0) return 'On';
		const lo = Math.min(...rs);
		const hi = Math.max(...rs);
		return `On · R ${refl(lo) === refl(hi) ? refl(lo) : `${refl(lo)}–${refl(hi)}`}`;
	});

	const zones = $derived(scene.zones.filter((z) => !z.isStandard || scene.room.useStandardZones));

	function fixtureName(l: LampInstance): string {
		const key = fixtureKeyOf(l);
		return scene.fixtures.find((f) => f.key === key)?.label ?? '';
	}

	function wavelengthTitle(l: LampInstance): string {
		const wl = lampWavelength(l);
		return wl == null ? 'Wavelength not set' : `${Math.round(wl)} nm`;
	}

	function iconOf(z: CalcZone): 'calc_plane' | 'calc_vol' | 'calc_point' {
		return z.type === 'volume' ? 'calc_vol' : z.type === 'point' ? 'calc_point' : 'calc_plane';
	}
</script>

<div class="summary-panel">
	<h3>Summary</h3>

	{#each SECTIONS as s (s.edit)}
		<section class="summary-block">
			<button type="button" class="summary-section" data-edit={s.edit} onclick={() => open(s.edit)}>{s.label}</button>

			{#if s.edit === 'room:floorplan'}
				<div class="ep-kv"><span>Dimensions</span><b>{dimensions}</b></div>
				<div class="ep-kv"><span>Floor area</span><b>{whole(area)} {abbrev}²</b></div>
				<div class="ep-kv"><span>Volume</span><b>{whole(area * scene.roomZ)} {abbrev}³</b></div>
				<div class="ep-kv"><span>Reflections</span><b>{reflections}</b></div>
			{:else if s.edit === 'room:structures'}
				{#if scene.objects.length === 0}<span class="ep-chip">None</span>{/if}
				<div class="ep-list">
					{#each scene.objects as o (o.id)}
						<ItemRow
							id={o.id}
							name={o.name || o.id}
							open={false}
							renamable={false}
							hidden={scene.hidden.objects.has(o.id)}
							enabled={o.enabled !== false}
							onToggleOpen={() => {}}
							onRename={() => {}}
							onToggleHidden={() => actions.setHidden('objects', o.id, !scene.hidden.objects.has(o.id))}
							onToggleEnabled={() => actions.updateObstacle(o.id, { enabled: !(o.enabled !== false) })}
							onHover={(on) => onHover('objects', o.id, on)}
						/>
					{/each}
				</div>
			{:else if s.edit === 'lamps'}
				{#if scene.lamps.length === 0}<span class="ep-chip">None</span>{/if}
				<div class="ep-list">
					{#each scene.lamps as l (l.id)}
						<ItemRow
							id={l.id}
							name={l.name || l.id}
							subtitle={fixtureName(l)}
							italicSubtitle
							open={false}
							renamable={false}
							hidden={scene.hidden.lamps.has(l.id)}
							enabled={l.enabled !== false}
							onToggleOpen={() => {}}
							onRename={() => {}}
							onToggleHidden={() => actions.setHidden('lamps', l.id, !scene.hidden.lamps.has(l.id))}
							onToggleEnabled={() => actions.updateLamp(l.id, { enabled: !(l.enabled !== false) })}
							onHover={(on) => onHover('lamps', l.id, on)}
						>
							{#snippet lead()}
								<span class="dot" style:background={l.enabled === false ? DISABLED_COLOR : lampColor(l)} title={wavelengthTitle(l)} role="img" aria-label={wavelengthTitle(l)}></span>
							{/snippet}
						</ItemRow>
					{/each}
				</div>
			{:else}
				{#if zones.length === 0}<span class="ep-chip">None</span>{/if}
				<div class="ep-list">
					{#each zones as z (z.id)}
						<ItemRow
							id={z.id}
							name={z.name || z.id}
							open={false}
							renamable={false}
							hidden={scene.hidden.zones.has(z.id)}
							enabled={z.enabled !== false}
							onToggleOpen={() => {}}
							onRename={() => {}}
							onToggleHidden={() => actions.setHidden('zones', z.id, !scene.hidden.zones.has(z.id))}
							onToggleEnabled={() => actions.updateZone(z.id, { enabled: !(z.enabled !== false) })}
							onHover={(on) => onHover('zones', z.id, on)}
						>
							{#snippet lead()}<CalcTypeIllustration type={iconOf(z)} size={16} />{/snippet}
						</ItemRow>
					{/each}
				</div>
			{/if}
		</section>
	{/each}
</div>

<style>
	.summary-panel {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		min-width: 0;
	}
	h3 {
		margin: 0;
	}
	.summary-block {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 0;
	}
	.summary-section {
		display: flex;
		width: 100%;
		margin: 0 0 6px;
		align-items: center;
		padding: 7px 10px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		font-size: var(--font-size-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		text-align: left;
		cursor: pointer;
		box-shadow: none;
		transition: border-color 0.12s, background 0.12s;
	}
	.summary-section:hover {
		border-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 10%, var(--color-bg-tertiary));
	}
	.summary-section:active {
		transform: translateY(1px);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
	}
</style>
