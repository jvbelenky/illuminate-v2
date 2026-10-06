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
				title={g.id === suggestedGroup ? `${g.caption} (detected from file)` : g.caption}
				onclick={() => pickGroup(g.id)}
			>
				<span class="group-title">{g.title}</span>
				{#if g.id === suggestedGroup}
					<span class="detected" aria-hidden="true"></span>
					<span class="sr-only">Detected from file</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if group === 'sideways'}
		<select id="beam-azimuth" aria-label="Beam side in file" value={axis} onchange={handleAzimuthChange}>
			{#each HORIZONTAL_AXES as a (a)}
				<option value={a}>{AXIS_LABELS[a]} ({Math.round((scores[a] ?? 0) * 100)}%)</option>
			{/each}
		</select>
	{/if}
</div>

<style>
	.axis-picker {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		min-width: 0;
	}

	.group-buttons {
		display: flex;
		flex: 1;
		min-width: 0;
	}

	.axis-btn {
		position: relative;
		flex: 1;
		padding: 4px 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	.axis-btn + .axis-btn {
		border-left: none;
	}

	.axis-btn:first-child {
		border-radius: var(--radius-sm) 0 0 var(--radius-sm);
	}

	.axis-btn:last-child {
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	.axis-btn[aria-pressed="true"] {
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		font-weight: 600;
	}

	/* small dot marking the group the file analysis suggested */
	.detected {
		position: absolute;
		top: 3px;
		right: 4px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-accent);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	#beam-azimuth {
		flex: 0 0 auto;
		width: auto;
		font-size: var(--font-size-sm);
	}
</style>
