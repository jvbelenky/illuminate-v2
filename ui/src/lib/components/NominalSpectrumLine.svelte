<script lang="ts">
	// Stand-in spectrum for a lamp without a spectrum file: a single line at
	// the lamp type's nominal wavelength, labelled as an assumption.
	interface Props {
		wavelength: number | null;
		color: string;
	}

	let { wavelength, color }: Props = $props();

	const W = 300, H = 150, PAD = 18;
	const X0 = 200, X1 = 320;
	const x = (nm: number) => PAD + ((nm - X0) / (X1 - X0)) * (W - 2 * PAD);
	const base = H - 22;
	const top = 18;
	const ticks = [200, 220, 240, 260, 280, 300, 320];
	const inRange = $derived(wavelength != null && wavelength >= X0 && wavelength <= X1);
</script>

<svg class="nominal-spectrum" viewBox="0 0 {W} {H}" role="img" aria-label={wavelength != null ? `Assumed ${wavelength} nm line` : 'No wavelength set'}>
	<line x1={PAD} y1={base} x2={W - PAD} y2={base} class="axis" />
	{#each ticks as nm (nm)}
		<line x1={x(nm)} y1={base} x2={x(nm)} y2={base + 3} class="axis" />
		<text x={x(nm)} y={H - 6} text-anchor="middle">{nm}</text>
	{/each}
	<text x={W - PAD} y={H - 16} text-anchor="end">nm</text>
	{#if wavelength != null && inRange}
		<line x1={x(wavelength)} y1={base} x2={x(wavelength)} y2={top} stroke={color} stroke-width="2.5" />
		<text x={x(wavelength) + 5} y={top + 8} style:fill={color} class="label">{wavelength} nm (assumed)</text>
	{:else if wavelength != null}
		<text x={W / 2} y={H / 2} text-anchor="middle" class="label">{wavelength} nm (assumed)</text>
	{:else}
		<text x={W / 2} y={H / 2} text-anchor="middle">Set a wavelength or add a spectrum</text>
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

	text {
		fill: var(--color-text-muted);
		font-size: 9px;
	}

	text.label {
		font-size: 10px;
	}
</style>
