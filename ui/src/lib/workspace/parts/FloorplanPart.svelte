<script lang="ts">
	// Room › Floorplan: the room's size and units, its area and volume, the
	// floor plan file to trace over (a file box, as the lamp files are); the vertex table is folded under Vertices.
	import './parts.css';
	import VertexTable from '$lib/components/VertexTable.svelte';
	import Glyph from '$lib/workspace/Glyph.svelte';
	import FileBox from '$lib/components/FileBox.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import FloorplanImportModal, { type FloorplanImportResult } from '$lib/floorplan/FloorplanImportModal.svelte';
	import { frameFromPlacement, type Pt } from '$lib/floorplan/importFrame';
	import { polygonArea, polygonBoundingBox, outlineSize, resizeOutline } from '$lib/utils/roomGeometry';
	import { displayQuantity } from '$lib/utils/formatting';
	import { unitAbbrev, LENGTH_UNITS, roundToUnit } from '$lib/utils/unitConversion';
	import type { PlanController } from '$lib/plan/planController.svelte';

	let { controller }: { controller: PlanController } = $props();
	const ctl = $derived(controller);

	const scene = $derived(ctl.scene());
	const room = $derived(scene.room);
	const units = $derived(scene.units);
	const area = $derived(polygonArea(scene.vertices));
	const volume = $derived(area * scene.roomZ);

	// W and L are the outline's own width and length (a room moved or turned off the origin is narrower than its far edge)
	const size = $derived(scene.vertices.length >= 3 ? outlineSize(scene.vertices) : { x: room.x, y: room.y });
	const atOrigin = $derived.by(() => {
		if (scene.vertices.length < 3) return true;
		const bb = polygonBoundingBox(scene.vertices);
		return Math.abs(bb.xMin) < 1e-9 && Math.abs(bb.yMin) < 1e-9;
	});

	function shown(key: 'x' | 'y' | 'z'): number {
		return roundToUnit(key === 'z' ? room.z : size[key], units);
	}

	function commit(key: 'x' | 'y' | 'z', event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		if (!Number.isFinite(v) || v <= 0) {
			input.value = String(shown(key));
			return;
		}
		if (v === shown(key)) return;
		// Off the origin the outline stretches about its own lower-left corner, staying put
		if (key !== 'z' && !atOrigin) ctl.actions.setOutline(resizeOutline(scene.vertices, key === 'x' ? v : undefined, key === 'y' ? v : undefined));
		else ctl.actions.updateRoom({ [key]: v });
		ctl.requestFit();
	}

	// --- The floor plan file: Upload opens the window (it asks for the file); Edit reopens it; Remove asks first
	const fileName = $derived(ctl.placement ? (ctl.imageFileName ?? 'Floor plan file') : null);
	const fileBadge = $derived.by(() => {
		const ext = ctl.imageFileName?.split('.').pop();
		if (ext && ext !== ctl.imageFileName) return ext.toUpperCase();
		const mime = scene.image?.mime ?? '';
		return (mime.split('/').pop()?.replace('svg+xml', 'svg').replace('jpeg', 'jpg') || 'file').toUpperCase();
	});
	let confirmRemove = $state(false);

	// The import window: reopened on the current image, its frame and outline come along
	const session = $derived(ctl.importSession);
	const importInitial = $derived.by(() => {
		if (!session?.initial) return null;
		const f = frameFromPlacement(session.initial);
		return f.origin && f.pxPerM ? { rotation: f.rotation, origin: f.origin, pxPerM: f.pxPerM } : null;
	});
	const importOutline = $derived<Pt[] | null>(session?.imageId && scene.vertices.length >= 3 ? scene.vertices.map(([x, y]) => [x / ctl.k, y / ctl.k] as Pt) : null);
	function applyImport(result: FloorplanImportResult) {
		void ctl.applyImport(result);
	}
	/** The file chosen in the window (first, or Change file…): the window starts over on it. */
	function chooseFile(file: File) {
		void ctl.openImport(file);
	}

	let geometryOpen = $state(false);
	// Edit vertices is a mode toggle (the outline otherwise sits in its move/resize/rotate box)
	const cornering = $derived(ctl.onOutline && ctl.shapeMode === 'corners');
</script>

<div class="ep-part floorplan-part">
	<div class="dims-block">
		<span class="dims-title">Dimensions</span>
		<div class="dims-row">
			<div class="dims">
				<label class="dim">
					<span>W</span>
					<input type="number" aria-label="Width" value={shown('x')} onchange={(e) => commit('x', e)} />
				</label>
				<label class="dim">
					<span>L</span>
					<input type="number" aria-label="Length" value={shown('y')} onchange={(e) => commit('y', e)} />
				</label>
				<label class="dim">
					<span>H</span>
					<input type="number" aria-label="Height" value={shown('z')} onchange={(e) => commit('z', e)} />
				</label>
			</div>
			<select class="units-select" aria-label="Units" value={units} onchange={ctl.handleUnitsChange}>
				{#each LENGTH_UNITS as u (u)}
					<option value={u}>{unitAbbrev(u)}</option>
				{/each}
			</select>
		</div>
	</div>

	<span class="plan-summary" aria-label="Floor area and volume">{displayQuantity(area, scene.precision)} {ctl.unit}² · {displayQuantity(volume, scene.precision)} {ctl.unit}³</span>
	{#if ctl.validationMessage && ctl.draft.length >= 3}
		<p class="ep-error" role="alert">Not saved: {ctl.validationMessage}</p>
	{:else if ctl.dirty && !ctl.drawing}
		<span class="ep-chip" role="alert">Not saved</span>
	{/if}

	<div class="plan-actions">
		<div class="shape-tools">
			<button type="button" class="secondary plan-btn" disabled={ctl.drawing} onclick={ctl.requestNewOutline}><Glyph name="pen" size={16} /><span>Draw new outline</span></button>
			<button type="button" class="secondary plan-btn" class:active={cornering} aria-pressed={cornering} disabled={ctl.drawing || !ctl.hasOutline} onclick={ctl.editOutlineCorners}><Glyph name="corners" size={16} /><span>Edit vertices</span></button>
		</div>
	</div>

	<div class="floorplan-file" role="group" aria-label="Floor plan file">
		<FileBox
			name={fileName}
			badge={fileBadge}
			variant="box"
			addLabel="Upload floor plan file"
			replaceLabel="Edit"
			replaceTitle="Edit the floor plan"
			removeTitle="Remove the floor plan file"
			disabled={ctl.drawing || ctl.decoding || (!!ctl.placement && !ctl.hasImage)}
			onpick={() => (ctl.placement ? ctl.adjustImage() : ctl.startImport())}
			onremove={() => (confirmRemove = true)}
		/>
		{#if ctl.imageMissing}
			<span class="ep-chip">File missing</span>
		{/if}
		{#if ctl.imageError && !session}
			<p class="ep-error" role="alert">{ctl.imageError}</p>
		{/if}
		{#if ctl.placement && ctl.pdfPageCount > 1}
			<label class="reference-row">
				<span>Page</span>
				<select value={ctl.pdfPage} onchange={(e) => ctl.changePdfPage(Number((e.currentTarget as HTMLSelectElement).value))} aria-label="PDF page">
					{#each Array.from({ length: ctl.pdfPageCount }, (_, i) => i + 1) as n}
						<option value={n}>{n} of {ctl.pdfPageCount}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>

	<button type="button" class="ep-disc" aria-expanded={geometryOpen} onclick={() => (geometryOpen = !geometryOpen)}>
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
		Vertices
	</button>
	{#if geometryOpen}
		<VertexTable
			vertices={ctl.draft}
			unit={ctl.unit}
			precision={scene.precision}
			selectedIndex={ctl.selectedIndex}
			min={0}
			step={ctl.snapStep}
			disabled={ctl.drawing}
			oncommit={(i, axis, v) => ctl.setVertexCoord(i, axis, v)}
			onremove={(i) => ctl.removeVertex(i)}
			onadd={ctl.addVertex}
		/>
	{/if}
</div>

{#if session}
	<!-- A chosen file (the first, or Change file…) opens a new session: the window starts over on it -->
	{#key session}
		<FloorplanImportModal
			src={session.src}
			widthPx={session.widthPx}
			heightPx={session.heightPx}
			fileName={session.fileName}
			{units}
			precision={scene.precision}
			initial={importInitial}
			currentOutline={importOutline}
			opacity={session.opacity}
			onOpacityChange={ctl.setImportOpacity}
			onUnitsChange={ctl.handleUnitsChange}
			onChooseFile={chooseFile}
			decoding={ctl.decoding}
			error={ctl.imageError}
			onApply={applyImport}
			onClose={ctl.closeImport}
		/>
	{/key}
{/if}
{#if confirmRemove}
	<ConfirmDialog
		title="Remove the floor plan file?"
		message="The plan is taken off the 2D view. The room outline stays."
		confirmLabel="Remove"
		onConfirm={() => { confirmRemove = false; ctl.removeImage(); }}
		onCancel={() => (confirmRemove = false)}
	/>
{/if}

<style>
	.dims-block {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}
	.dims-title {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.dims-row {
		display: flex;
		gap: var(--spacing-sm);
		align-items: flex-end;
	}
	.dims {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--spacing-xs);
		flex: 1;
		min-width: 0;
	}
	.dim {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		min-width: 0;
	}
	.dim {
		gap: 4px;
	}
	.dim > span {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-weight: 500;
	}
	.dim input {
		width: 100%;
		min-width: 0;
		padding: 6px 8px;
	}
	.units-select {
		padding-top: 6px;
		padding-bottom: 6px;
	}
	.units-select {
		width: 60px;
		flex-shrink: 0;
	}
	.plan-summary {
		margin-top: var(--spacing-xs);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.plan-actions {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
	}
	.plan-actions .plan-btn {
		width: 100%;
		padding: 6px 12px;
		font-size: var(--font-size-sm);
		font-weight: 500;
		background: var(--color-btn-fill);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
	}
	.plan-actions .plan-btn:hover:not(:disabled) {
		background: var(--color-btn-fill-hover);
		border-color: transparent;
	}
	/* The floor plan file: below the outline, a file box as the lamp files are */
	.floorplan-file {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: var(--spacing-sm);
		font-size: var(--font-size-sm);
	}
	.reference-row {
		display: grid;
		grid-template-columns: 4.2rem 1fr;
		align-items: center;
		gap: var(--spacing-xs);
		margin: 0;
	}
	.reference-row > span {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
</style>
