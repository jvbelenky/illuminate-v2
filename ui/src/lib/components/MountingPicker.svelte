<script lang="ts">
	import type { IesAnalysisResponse } from '$lib/api/contract';
	import {
		HORIZONTAL_AXES, bestHorizontal, isPhotometricAxis, mountingOf, wallSideOf, axisForWallSide,
		type Mounting, type PhotometricAxis
	} from '$lib/utils/photometricAxis';

	interface Props {
		analysis: IesAnalysisResponse | null;
		axis: PhotometricAxis;
		onAxisChange: (axis: PhotometricAxis) => void;
	}

	let { analysis, axis, onAxisChange }: Props = $props();

	// The user says how the fixture is mounted; the beam points away from the
	// mount. Ceiling and floor are the file's down and up axes; for a wall the
	// user picks which side of the file faces the wall.
	const GROUPS: { id: Mounting; title: string; caption: string }[] = [
		{ id: 'ceiling', title: 'Ceiling', caption: 'Hung from or flush with the ceiling; light goes down or out sideways' },
		{ id: 'wall', title: 'Wall', caption: 'Back of the fixture against a wall; light goes into the room' },
		{ id: 'floor', title: 'Floor', caption: 'Sits on the floor or a shelf and shines up' },
	];

	const scores = $derived<Record<string, number>>(analysis?.axis_scores ?? {});
	const mounting = $derived(mountingOf(axis));
	const suggested = $derived.by(() => {
		const s = analysis?.suggested_axis;
		return isPhotometricAxis(s) ? mountingOf(s) : null;
	});

	function pick(m: Mounting) {
		if (m === 'ceiling') onAxisChange('down');
		else if (m === 'floor') onAxisChange('up');
		else onAxisChange(mounting === 'wall' ? axis : bestHorizontal(scores));
	}

	function handleWallSide(e: Event) {
		const phi = Number((e.currentTarget as HTMLSelectElement).value);
		if (Number.isFinite(phi)) onAxisChange(axisForWallSide(phi));
	}
</script>

<div class="mounting-picker">
	<div class="group-buttons" role="group" aria-label="How is the fixture mounted?">
		{#each GROUPS as g (g.id)}
			<button
				type="button"
				class="mount-btn"
				data-group={g.id}
				aria-pressed={g.id === mounting}
				title={g.id === suggested ? `${g.caption} (detected from file)` : g.caption}
				onclick={() => pick(g.id)}
			>
				<span class="group-title">{g.title}</span>
				{#if g.id === suggested}
					<span class="detected" aria-hidden="true"></span>
					<span class="sr-only">Detected from file</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if mounting === 'wall'}
		<select id="wall-side" aria-label="Side of the file against the wall" value={String(wallSideOf(axis))} onchange={handleWallSide}>
			{#each HORIZONTAL_AXES as a (a)}
				<option value={String(wallSideOf(a))}>{wallSideOf(a)}° side to wall ({Math.round((scores[a] ?? 0) * 100)}% light out)</option>
			{/each}
		</select>
	{/if}
</div>

<style>
	/* buttons on one line, the wall-side menu (when shown) on the next */
	.mounting-picker {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.group-buttons {
		display: flex;
		flex: 1;
		min-width: 0;
	}

	.mount-btn {
		position: relative;
		flex: 1;
		padding: 4px 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	.mount-btn + .mount-btn {
		border-left: none;
	}

	.mount-btn:first-child {
		border-radius: var(--radius-sm) 0 0 var(--radius-sm);
	}

	.mount-btn:last-child {
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	.mount-btn[aria-pressed="true"] {
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

	#wall-side {
		width: 100%;
		font-size: var(--font-size-sm);
	}
</style>
