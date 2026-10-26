<script lang="ts">
	// Room › Ceiling: the room height, the tile grid (size and where it starts),
	// Add to ceiling (detectors, vents, sensors, keep-out areas) and the items.
	// The open item's fields show directly in its row.
	import './parts.css';
	import ItemRow from './ItemRow.svelte';
	import ShapeGeometryFields from './ShapeGeometryFields.svelte';
	import { scrollRowIntoView } from './scrollRowIntoView';
	import type { ReferenceMode } from './shapeGeometry';
	import CeilingIcon from '$lib/ceiling/CeilingIcon.svelte';
	import { keepOutEditAllowed, pointMoveAllowed, type CeilingItem, type CeilingKind, type CeilingPointItem, type TileAlign, type TileSize } from '$lib/ceiling/ceilingLayout';
	import type { Vertex } from '$lib/utils/roomGeometry';
	import { roundToUnit, unitAbbrev } from '$lib/utils/unitConversion';
	import type { PlanController } from '$lib/plan/planController.svelte';

	let { controller }: { controller: PlanController } = $props();
	const ctl = $derived(controller);

	const scene = $derived(ctl.scene());
	const height = $derived(roundToUnit(scene.room.z, scene.units));
	const layout = $derived(scene.ceiling);
	const grid = $derived(layout.tileSize !== 'none');

	const TILES: { value: TileSize; label: string; title?: string }[] = [
		{ value: 'none', label: 'None' },
		{ value: '2x2', label: '2×2' },
		{ value: '4x2', label: '4×2', title: 'Long side along X' },
		{ value: '2x4', label: '2×4', title: 'Long side along Y' },
	];
	const ALIGNS: { value: TileAlign; title: string; dot: [number, number] }[] = [
		{ value: 'tl', title: 'From the top-left corner', dot: [4, 4] },
		{ value: 'tr', title: 'From the top-right corner', dot: [14, 4] },
		{ value: 'bl', title: 'From the bottom-left corner', dot: [4, 10] },
		{ value: 'br', title: 'From the bottom-right corner', dot: [14, 10] },
		{ value: 'c', title: 'Centred on the room', dot: [9, 7] },
	];
	const ADD: { kind: CeilingKind; label: string; title: string }[] = [
		{ kind: 'smoke', label: 'Detector', title: 'Smoke detector' },
		{ kind: 'vent', label: 'Vent', title: 'Vent' },
		{ kind: 'sensor', label: 'Sensor', title: 'Sensor' },
		{ kind: 'keep', label: 'Keep-out', title: 'Keep-out area' },
	];

	function commitHeight(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		if (!Number.isFinite(v) || v <= 0) {
			input.value = String(height);
			return;
		}
		if (v === height) return;
		ctl.actions.updateRoom({ z: v });
	}

	async function add(kind: CeilingKind) {
		const id = ctl.addCeilingItem(kind);
		if (id) await scrollRowIntoView(id);
	}

	function commitPoint(it: CeilingPointItem, key: 'x' | 'y', event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		const shown = roundToUnit(it[key], scene.units);
		if (input.value.trim() === '' || !Number.isFinite(v)) {
			input.value = String(shown);
			return;
		}
		if (v === shown) return;
		// Items stay in the room (one left outside by a room change may come closer)
		const [x, y] = key === 'x' ? [v, it.y] : [it.x, v];
		if (!pointMoveAllowed([it.x, it.y], [x, y], scene.vertices)) {
			input.value = String(shown);
			return;
		}
		ctl.actions.updateCeilingItem(it.id, { [key]: v });
	}

	// X/Y of a keep-out area point at its corner or its middle (one choice for all)
	let reference = $state<ReferenceMode>('centre');

	/** A keep-out area's new shape, if it stays in the room (or was already outside it). */
	function reshape(id: string, vertices: Vertex[], yaw: number): boolean {
		const old = layout.items.find((i) => i.id === id);
		const before = old?.kind === 'keep' ? old.vertices : vertices;
		if (!keepOutEditAllowed(before, vertices, scene.vertices)) return false;
		ctl.actions.updateCeilingItem(id, { vertices, yaw });
		return true;
	}

	function toggleOpen(it: CeilingItem, open: boolean) {
		ctl.selectCeilingItem(open ? null : it.id);
	}
</script>

{#snippet eye(shown: boolean, what: string, toggle: () => void)}
	<button type="button" class="cp-eye" class:pressed={shown} onclick={toggle} aria-label="{shown ? 'Hide' : 'Show'} {what}" title={shown ? 'Hide' : 'Show'}>
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
			{#if shown}
				<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
				<circle cx="12" cy="12" r="3" />
			{:else}
				<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
				<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
				<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
				<line x1="1" y1="1" x2="23" y2="23" />
			{/if}
		</svg>
	</button>
{/snippet}

<div class="ep-part ceiling-part">
	<div class="ep-section">
		<span>Ceiling</span>
		{@render eye(layout.ceilingShown, 'ceiling', () => ctl.actions.updateCeiling({ ceilingShown: !layout.ceilingShown }))}
	</div>
	<label class="ep-field" title="Height">
		<span>Height</span>
		<input type="number" aria-label="Height" value={height} onchange={commitHeight} />
		<span>{unitAbbrev(scene.units)}</span>
	</label>

	<section class="cp-card" aria-label="Tile grid">
		<div class="cp-card-head">
			<h3 class="ep-addcard-title">Tile grid</h3>
			{#if grid}{@render eye(layout.tilesShown, 'tile grid', () => ctl.actions.updateCeiling({ tilesShown: !layout.tilesShown }))}{/if}
		</div>
		<div class="cp-row">
			<span>Tiles</span>
			<div class="cp-pills" role="group" aria-label="Tiles">
				{#each TILES as t (t.value)}
					<button type="button" class:on={layout.tileSize === t.value} aria-pressed={layout.tileSize === t.value} title={t.title} onclick={() => ctl.actions.updateCeiling({ tileSize: t.value })}>{t.label}</button>
				{/each}
			</div>
		</div>
		{#if grid}
			<div class="cp-row">
				<span>Align</span>
				<div class="cp-pills ico" role="group" aria-label="Align">
					{#each ALIGNS as a (a.value)}
						<button type="button" class:on={layout.align === a.value} aria-pressed={layout.align === a.value} aria-label={a.title} title={a.title} onclick={() => ctl.actions.updateCeiling({ align: a.value, offset: [0, 0] })}>
							<svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
								<rect x="1.5" y="1.5" width="15" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".6" />
								<path d="M{a.dot[0]} 1.5V12.5M1.5 {a.dot[1]}H16.5" stroke="currentColor" stroke-width=".8" stroke-dasharray="1.2 1" opacity=".7" />
								<circle cx={a.dot[0]} cy={a.dot[1]} r="1.9" fill="currentColor" />
							</svg>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</section>

	<section class="ep-addcard" aria-label="Add to ceiling">
		<h3 class="ep-addcard-title">Add to ceiling</h3>
		<div class="ep-grid cp-add" role="group" aria-label="Add to ceiling">
			{#each ADD as a (a.kind)}
				<button type="button" class="secondary" class:keep={a.kind === 'keep'} title={a.title} disabled={ctl.ceilingFull} onclick={() => add(a.kind)}><CeilingIcon kind={a.kind} size={16} /><span>{a.label}</span></button>
			{/each}
		</div>
	</section>

	<div class="ep-section">
		<span>Items</span>
		{#if layout.items.length}{@render eye(layout.itemsShown, 'ceiling items', () => ctl.actions.updateCeiling({ itemsShown: !layout.itemsShown }))}{/if}
	</div>
	{#if layout.items.length === 0}
		<span class="ep-chip">None</span>
	{/if}
	<div class="ep-list">
		{#each layout.items as it (it.id)}
			{@const open = ctl.selectedCeilingId === it.id}
			<ItemRow
				id={it.id}
				name={it.name}
				{open}
				hidden={!!it.hidden}
				onToggleOpen={() => toggleOpen(it, open)}
				onRename={(name) => ctl.actions.updateCeilingItem(it.id, { name })}
				onToggleHidden={() => ctl.actions.updateCeilingItem(it.id, { hidden: !it.hidden })}
			>
				{#snippet lead()}
					<span class="cp-lead" class:keep={it.kind === 'keep'}><CeilingIcon kind={it.kind} size={14} /></span>
				{/snippet}
				{#if it.kind === 'keep'}
					<ShapeGeometryFields
						vertices={it.vertices}
						yaw={it.yaw}
						{reference}
						units={scene.units}
						onChange={(vertices, yaw) => reshape(it.id, vertices, yaw)}
						onReferenceChange={(mode) => (reference = mode)}
					/>
				{:else}
					<div class="cp-xy">
						<label class="ep-field" title="X">
							<span>X</span>
							<input type="number" step="any" aria-label="X" value={roundToUnit(it.x, scene.units)} onchange={(e) => commitPoint(it, 'x', e)} />
						</label>
						<label class="ep-field" title="Y">
							<span>Y</span>
							<input type="number" step="any" aria-label="Y" value={roundToUnit(it.y, scene.units)} onchange={(e) => commitPoint(it, 'y', e)} />
						</label>
					</div>
				{/if}
			</ItemRow>
		{/each}
	</div>
</div>

<style>
	.cp-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 10px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
	}
	.cp-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 22px;
	}
	.cp-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.cp-row > span {
		width: 38px;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.cp-pills {
		display: inline-flex;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}
	.cp-pills > button {
		margin: 0;
		padding: 4px 9px;
		border: 0;
		border-radius: 0;
		background: var(--color-bg);
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
	}
	.cp-pills > button + button {
		border-left: 1px solid var(--color-border);
	}
	.cp-pills > button:hover:not(.on) {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}
	.cp-pills > button.on {
		background: var(--color-primary);
		color: #fff;
	}
	.cp-pills.ico > button {
		display: grid;
		place-items: center;
		padding: 3px 6px;
	}
	.cp-pills.ico svg {
		display: block;
	}
	.cp-add > button {
		color: var(--color-warning);
	}
	.cp-add > button.keep {
		color: var(--color-danger);
	}
	.cp-add > button > span {
		max-width: 100%;
		color: var(--color-text);
		white-space: nowrap;
		font-size: 0.62rem;
	}
	.cp-lead {
		display: inline-flex;
		color: var(--color-warning);
	}
	.cp-lead.keep {
		color: var(--color-danger);
	}
	.cp-xy {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px;
	}
	.cp-eye {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 22px;
		height: 22px;
		margin: 0;
		padding: 0;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.cp-eye:hover {
		color: var(--color-text);
	}
	.cp-eye.pressed {
		background: color-mix(in srgb, var(--color-primary) 20%, var(--color-bg-secondary));
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
</style>
