<script lang="ts">
	import type { IesAnalysisResponse } from '$lib/api/contract';
	import {
		HORIZONTAL_AXES, AXIS_LABELS, axisGroup, bestHorizontal,
		isPhotometricAxis, type AxisGroup, type PhotometricAxis
	} from '$lib/utils/photometricAxis';

	interface Props {
		analysis: IesAnalysisResponse | null;
		axis: PhotometricAxis;
		onAxisChange: (axis: PhotometricAxis) => void;
	}

	let { analysis, axis, onAxisChange }: Props = $props();

	// The user picks how the fixture is mounted; the four horizontal IES
	// azimuths collapse into one "sideways" choice, with the file's strongest
	// side chosen automatically and a secondary select to override it.
	const GROUPS: { id: AxisGroup; title: string; caption: string }[] = [
		{ id: 'down', title: 'Down', caption: 'Ceiling or pendant mount, shines down' },
		{ id: 'up', title: 'Up', caption: 'Shines at the ceiling' },
		{ id: 'sideways', title: 'Sideways', caption: 'Wall-mounted, shines across the room' },
	];

	const scores = $derived<Record<string, number>>(analysis?.axis_scores ?? {});
	const group = $derived(axisGroup(axis));
	const suggestedGroup = $derived.by(() => {
		const s = analysis?.suggested_axis;
		return isPhotometricAxis(s) ? axisGroup(s) : null;
	});

	function pickGroup(g: AxisGroup) {
		if (g === 'sideways') onAxisChange(group === 'sideways' ? axis : bestHorizontal(scores));
		else onAxisChange(g);
	}

	function handleAzimuthChange(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		if (isPhotometricAxis(v)) onAxisChange(v);
	}
</script>

<div class="axis-picker">
	<div class="group-buttons" role="group" aria-label="Which way does this fixture shine?">
		{#each GROUPS as g (g.id)}
			<button
				type="button"
				class="axis-btn"
				data-group={g.id}
				aria-pressed={g.id === group}
				onclick={() => pickGroup(g.id)}
			>
				<span class="group-title">{g.title}</span>
				<span class="group-caption">{g.caption}</span>
				{#if g.id === suggestedGroup}
					<span class="detected">Detected from file</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if group === 'sideways'}
		<div class="azimuth-row">
			<label for="beam-azimuth">Beam side in file</label>
			<select id="beam-azimuth" value={axis} onchange={handleAzimuthChange}>
				{#each HORIZONTAL_AXES as a (a)}
					<option value={a}>{AXIS_LABELS[a]} ({Math.round((scores[a] ?? 0) * 100)}% of power)</option>
				{/each}
			</select>
		</div>
	{/if}
</div>

<style>
	.axis-picker {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.group-buttons {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--spacing-xs);
	}

	.axis-btn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: 6px 8px;
		text-align: left;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		cursor: pointer;
	}

	.axis-btn[aria-pressed="true"] {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
	}

	.group-title {
		font-weight: 600;
	}

	.group-caption {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: 1.25;
	}

	.detected {
		margin-top: 2px;
		padding: 1px 6px;
		font-size: var(--font-size-sm);
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		color: var(--color-text);
	}

	.azimuth-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.azimuth-row label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.azimuth-row select {
		flex: 1;
		min-width: 0;
	}

	@media (max-width: 480px) {
		.group-buttons {
			grid-template-columns: 1fr;
		}
	}
</style>
