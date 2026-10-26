<script lang="ts">
	// A footprint's geometry: X/Y of its reference point (its own corner or its
	// middle), Width and Length along its own sides (the reference point stays
	// put), Rotation, and the corner table. Every change hands back the whole
	// polygon and yaw through onChange. Used for keep-out areas and structures.
	import { roundToUnit, unitAbbrev, type LengthUnit } from '$lib/utils/unitConversion';
	import { validatePolygon, type Vertex } from '$lib/utils/roomGeometry';
	import { moveReference, referencePoint, resizeShape, rotateShape, shapeSize, type ReferenceMode } from './shapeGeometry';

	interface Props {
		vertices: Vertex[];
		/** Degrees about the vertical. */
		yaw: number;
		reference: ReferenceMode;
		units: LengthUnit;
		onChange: (vertices: Vertex[], yaw: number) => void;
		onReferenceChange: (mode: ReferenceMode) => void;
	}

	let { vertices, yaw, reference, units, onChange, onReferenceChange }: Props = $props();

	const unit = $derived(unitAbbrev(units));
	const ref = $derived(referencePoint(vertices, yaw, reference));
	const size = $derived(shapeSize(vertices, yaw));
	const shown = (v: number) => roundToUnit(v, units);

	/** A typed number, or null (and the field shows `fallback` again) when it isn't one. */
	function read(event: Event, fallback: number, ok: (v: number) => boolean = Number.isFinite): number | null {
		const input = event.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		if (input.value.trim() === '' || !Number.isFinite(v) || !ok(v)) {
			input.value = String(shown(fallback));
			return null;
		}
		return v;
	}

	function setReference(axis: 0 | 1, event: Event) {
		const v = read(event, ref[axis]);
		if (v === null || v === shown(ref[axis])) return;
		onChange(moveReference(vertices, yaw, reference, axis, v), yaw);
	}

	function setSize(which: 'width' | 'length', event: Event) {
		const current = size[which];
		const v = read(event, current, (x) => Number.isFinite(x) && x > 0);
		if (v === null || v === shown(current)) return;
		onChange(resizeShape(vertices, yaw, reference, which, v), yaw);
	}

	function setRotation(event: Event) {
		const v = read(event, yaw);
		if (v === null || v === yaw) return;
		onChange(rotateShape(vertices, yaw, v), v);
	}

	function setCorner(index: number, axis: 0 | 1, event: Event) {
		const current = vertices[index][axis];
		const v = read(event, current);
		if (v === null || v === shown(current)) return;
		const next = vertices.map((p, i) => (i === index ? (axis === 0 ? [v, p[1]] : [p[0], v]) : [p[0], p[1]]) as Vertex);
		if (validatePolygon(next) !== null) {
			(event.currentTarget as HTMLInputElement).value = String(shown(current));
			return;
		}
		onChange(next, yaw);
	}
</script>

<div class="shape-geometry">
	<div class="sg-row">
		<label class="sg-dim"><span>X</span><input type="number" step="any" aria-label="X" value={shown(ref[0])} onchange={(e) => setReference(0, e)} /></label>
		<label class="sg-dim"><span>Y</span><input type="number" step="any" aria-label="Y" value={shown(ref[1])} onchange={(e) => setReference(1, e)} /></label>
		<label class="sg-dim">
			<span>Reference</span>
			<select aria-label="Reference" value={reference} onchange={(e) => onReferenceChange((e.currentTarget as HTMLSelectElement).value as ReferenceMode)}>
				<option value="corner">Corner</option>
				<option value="centre">Centre</option>
			</select>
		</label>
	</div>
	<div class="sg-row">
		<label class="sg-dim"><span>Width</span><input type="number" step="any" min="0" aria-label="Width" value={shown(size.width)} onchange={(e) => setSize('width', e)} /></label>
		<label class="sg-dim"><span>Length</span><input type="number" step="any" min="0" aria-label="Length" value={shown(size.length)} onchange={(e) => setSize('length', e)} /></label>
		<label class="sg-dim"><span>Rotation °</span><input type="number" step="any" aria-label="Rotation" value={+yaw.toFixed(2)} onchange={setRotation} /></label>
	</div>
	<div class="sg-corners">
		<span class="sg-label">Corners ({unit})</span>
		{#each vertices as [vx, vy], i (i)}
			<div class="sg-corner">
				<span>{i + 1}</span>
				<input type="number" step="any" aria-label="Corner {i + 1} X" value={shown(vx)} onchange={(e) => setCorner(i, 0, e)} />
				<input type="number" step="any" aria-label="Corner {i + 1} Y" value={shown(vy)} onchange={(e) => setCorner(i, 1, e)} />
			</div>
		{/each}
	</div>
</div>

<style>
	.shape-geometry {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sg-row {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
	}
	.sg-dim {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		margin: 0;
	}
	.sg-dim > span,
	.sg-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.sg-dim input,
	.sg-dim select,
	.sg-corner input {
		width: 100%;
		min-width: 0;
		height: 28px;
		box-sizing: border-box;
	}
	.sg-dim select {
		padding: 0 4px;
		font-size: var(--font-size-xs);
	}
	.sg-corners {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.sg-corner {
		display: grid;
		grid-template-columns: 1.4rem 1fr 1fr;
		gap: 6px;
		align-items: center;
	}
	.sg-corner > span {
		text-align: center;
		font-size: var(--font-size-xs);
		font-family: var(--font-mono, monospace);
		color: var(--color-text-muted);
	}
</style>
