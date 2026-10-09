<script lang="ts">
	// Stand-in spectrum for a lamp without a spectrum file: a single line at
	// the lamp type's nominal wavelength (or the one typed for an "other" lamp).
	interface Props {
		wavelength: number | null;
		color: string;
		tag?: 'assumed' | 'entered';
		/** Relative-intensity and wavelength axes, for the large detail chart */
		axes?: boolean;
	}

	let { wavelength, color, tag = 'assumed', axes = false }: Props = $props();

	const X0 = 200, X1 = 320, PAD = 18;
	const W = 300;
	const H = $derived(axes ? 170 : 150);
	const L = $derived(axes ? 54 : PAD);
	const B = $derived(axes ? 36 : 22);
	const T = $derived(axes ? 14 : 18);
	const x = (nm: number) => L + ((nm - X0) / (X1 - X0)) * (W - L - PAD);
	const y = (v: number) => H - B - v * (H - B - T);
	const ticks = [200, 220, 240, 260, 280, 300, 320];
	const levels = [0, 0.25, 0.5, 0.75, 1];
	const inRange = $derived(wavelength != null && wavelength >= X0 && wavelength <= X1);
</script>

<svg class="nominal-spectrum" viewBox="0 0 {W} {H}" role="img" aria-label={wavelength != null ? `${wavelength} nm line (${tag})` : 'No wavelength set'}>
	{#if axes}
		{#each levels as v (v)}
			<line x1={L} y1={y(v)} x2={W - PAD} y2={y(v)} class="grid" />
			<text x={L - 5} y={y(v) + 3} text-anchor="end">{v}</text>
		{/each}
		<line x1={L} y1={y(0)} x2={L} y2={y(1)} class="axis" />
		<text transform="translate(20,{(y(0) + y(1)) / 2}) rotate(-90)" text-anchor="middle" class="title">Relative intensity</text>
		<text x={(L + W - PAD) / 2} y={H - 6} text-anchor="middle" class="title">Wavelength (nm)</text>
	{:else}
		<text x={W - PAD} y={y(0) - 4} text-anchor="end">nm</text>
	{/if}
	<line x1={L} y1={y(0)} x2={W - PAD} y2={y(0)} class="axis" />
	{#each ticks as nm (nm)}
		<line x1={x(nm)} y1={y(0)} x2={x(nm)} y2={y(0) + 3} class="axis" />
		<text x={x(nm)} y={y(0) + 12} text-anchor="middle">{nm}</text>
	{/each}
	{#if wavelength != null && inRange}
		<line x1={x(wavelength)} y1={y(0)} x2={x(wavelength)} y2={y(1)} stroke={color} stroke-width="2.5" />
		<text x={x(wavelength) + 5} y={y(1) + 8} style:fill={color} class="label">{wavelength} nm ({tag})</text>
	{:else if wavelength != null}
		<text x={(L + W - PAD) / 2} y={(y(0) + y(1)) / 2} text-anchor="middle" class="label">{wavelength} nm ({tag})</text>
	{:else}
		<text x={(L + W - PAD) / 2} y={(y(0) + y(1)) / 2 - 5} text-anchor="middle" class="label">Enter a wavelength,</text>
		<text x={(L + W - PAD) / 2} y={(y(0) + y(1)) / 2 + 9} text-anchor="middle" class="label">or add a spectrum file</text>
	{/if}
</svg>

<style>
	.nominal-spectrum {
		width: 100%;
		height: 100%;
	}

	.axis {
		stroke: var(--color-border);
	}

	.grid {
		stroke: var(--color-border);
		stroke-width: 0.5;
		opacity: 0.6;
	}

	text {
		fill: var(--color-text-muted);
		font-size: 8px;
	}

	text.label {
		font-size: 10px;
	}

	text.title {
		font-size: 8.5px;
	}
</style>
