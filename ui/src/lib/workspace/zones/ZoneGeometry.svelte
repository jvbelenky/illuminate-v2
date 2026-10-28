<script lang="ts">
	// A zone's geometry, as the old calc zone editor showed it: a rectangle as two
	// ranges (X Range, Y Range; on a wall Along and Up), a drawn outline as its
	// corners table. Headings carry no units.
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import { isAxisRectangle } from '$lib/utils/zoneFootprint';
	import { validatePolygon, type Vertex } from '$lib/utils/roomGeometry';
	import { editRange, rangesOf, type Ranges } from './zoneFields';

	interface Props {
		vertices: Vertex[];
		/** The two axis names (X, Y; Along, Up; X, Z). */
		axes: [string, string];
		precision: number;
		step: number;
		/** Ranges even when not a rectangle (a legacy plane's bounds). */
		ranges?: boolean;
		readonly?: boolean;
		onRanges: (ranges: Ranges) => void;
		onCorners: (vertices: Vertex[]) => void;
	}

	let { vertices, axes, precision, step, ranges = false, readonly = false, onRanges, onCorners }: Props = $props();

	const asRanges = $derived(ranges || isAxisRectangle(vertices));
	const r = $derived(rangesOf(vertices));
	const SHORT: Record<string, string> = { X: 'x', Y: 'y', Z: 'z', Along: 'a', Up: 'u' };
	const short = (axis: string) => SHORT[axis] ?? axis.toLowerCase();

	function setRange(i: 0 | 1 | 2 | 3, v: number) {
		if (v === r[i]) return;
		const next = editRange(r, i, v);
		if (next) onRanges(next);
	}

	function cornerMoved(index: number, axis: 0 | 1, v: number): Vertex[] {
		return vertices.map((p, i) => (i === index ? (axis === 0 ? [v, p[1]] : [p[0], v]) : [p[0], p[1]]) as Vertex);
	}

	function setCorner(index: number, axis: 0 | 1, v: number) {
		if (v === vertices[index][axis]) return;
		onCorners(cornerMoved(index, axis, v));
	}
</script>

{#if asRanges}
	{#each axes as axis, k (axis)}
		{@const lo = (k * 2) as 0 | 2}
		{@const hi = (k * 2 + 1) as 1 | 3}
		<div class="zp-group" role="group" aria-label="{axis} Range">
			<span class="zp-label">{axis} Range</span>
			<div class="zp-range">
				<label><span class="sr-only">{short(axis)}1</span><ValidatedNumberInput value={r[lo]} {precision} {step} disabled={readonly} validate={(v) => editRange(r, lo, v) !== null} oncommit={(v) => setRange(lo, v)} /></label>
				<span class="zp-range-sep">–</span>
				<label><span class="sr-only">{short(axis)}2</span><ValidatedNumberInput value={r[hi]} {precision} {step} disabled={readonly} validate={(v) => editRange(r, hi, v) !== null} oncommit={(v) => setRange(hi, v)} /></label>
			</div>
		</div>
	{/each}
{:else}
	<div class="zp-corners">
		<span class="zp-label">Corners</span>
		<div class="zp-corner-head"><span></span><span>{axes[0]}</span><span>{axes[1]}</span></div>
		{#each vertices as [vx, vy], i (i)}
			<div class="zp-corner-row">
				<span>{i + 1}</span>
				<label><span class="sr-only">Corner {i + 1} {axes[0]}</span><ValidatedNumberInput value={vx} {precision} {step} disabled={readonly} validate={(v) => validatePolygon(cornerMoved(i, 0, v)) === null} oncommit={(v) => setCorner(i, 0, v)} /></label>
				<label><span class="sr-only">Corner {i + 1} {axes[1]}</span><ValidatedNumberInput value={vy} {precision} {step} disabled={readonly} validate={(v) => validatePolygon(cornerMoved(i, 1, v)) === null} oncommit={(v) => setCorner(i, 1, v)} /></label>
			</div>
		{/each}
	</div>
{/if}
