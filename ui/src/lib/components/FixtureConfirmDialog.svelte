<script lang="ts">
	// Shown after a fresh IES upload: previews the fixture settings detected
	// from the file and asks the user to accept them or open the editor.
	import { Canvas } from '@threlte/core';
	import Modal from './Modal.svelte';
	import FixtureScene from './FixtureScene.svelte';
	import type { IesAnalysisResponse } from '$lib/api/contract';
	import { unitAbbrev, type LengthUnit } from '$lib/utils/unitConversion';
	import { aimToHousingExtents, fixtureSummary, type FixtureDraft } from '$lib/utils/housingGeometry';
	import { resolveFixtureView } from '$lib/utils/fixtureView';

	interface Props {
		draft: FixtureDraft;
		analysis: IesAnalysisResponse | null;
		units: LengthUnit;
		color?: string;
		plot?: string | null;  // photometric polar plot, base64 PNG
		onaccept: () => void;
		onedit: () => void;
	}

	let { draft, analysis, units, color, plot = null, onaccept, onedit }: Props = $props();

	const view = $derived(resolveFixtureView(draft, analysis, units));
	const fmtL = (v: number) => String(parseFloat(v.toFixed(4)));
	// the opening along the housing's L / W / H, matching the housing line
	const openingH = $derived(aimToHousingExtents(draft.face, draft.roll, view.luminous));
	const opening = $derived(`${fmtL(openingH.length)} × ${fmtL(openingH.width)} × ${fmtL(openingH.height)} ${unitAbbrev(units)}`);
	const summary = $derived(fixtureSummary(view.layoutDisplay, view.luminousHeight, draft.axis, units));
</script>

<!-- Closing the popup keeps the detected settings, like "Looks right" -->
<Modal title="Does this look right?" onClose={onaccept} width="960px" maxWidth="95vw" zIndex={1100}>
	{#snippet body()}
		<div class="confirm">
			<div class="previews">
			<div class="preview">
				<Canvas>
					<FixtureScene
						layout={view.layoutMeters}
						axis={draft.axis}
						surfaceLength={view.surfaceMeters.length}
						surfaceWidth={view.surfaceMeters.width}
						surfaceHeight={view.surfaceMeters.height}
						web={view.web}
						{color}
					/>
				</Canvas>
				<div class="preview-hint">Drag to rotate</div>
			</div>
			<div class="plot-box">
				{#if plot}
					<img class="photometric-plot" src={`data:image/png;base64,${plot}`} alt="Photometric distribution (polar plot)" />
				{:else}
					<div class="plot-placeholder">Rendering photometric distribution…</div>
				{/if}
			</div>
			</div>
			<p class="intro">These fixture settings were detected from the IES file:</p>
			<dl class="summary">
				<dt>Mounting</dt>
				<dd>{summary.mounting}</dd>
				<dt>Luminous opening</dt>
				<dd>{opening}</dd>
				<dt>Housing</dt>
				<dd>{summary.housing}</dd>
				<dt>Photometric center</dt>
				<dd>{summary.lightCenter}</dd>
				{#if analysis}
					<dt>Total power</dt>
					<dd>{fmtL(analysis.total_power_mw)} mW</dd>
				{/if}
			</dl>
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="actions">
			<button type="button" class="secondary confirm-edit" onclick={onedit}>No, I need to make changes</button>
			<button type="button" class="primary confirm-accept" onclick={onaccept}>Looks right</button>
		</div>
	{/snippet}
</Modal>

<style>
	.confirm {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding: var(--spacing-md) var(--spacing-md) 0;
	}

	.previews {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--spacing-sm);
	}

	.plot-box {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 320px;
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		overflow: hidden;
	}

	.photometric-plot {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}

	.plot-placeholder {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	@media (max-width: 720px) {
		.previews {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.preview {
		position: relative;
		height: 320px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--color-bg-secondary);
	}

	.preview-hint {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 4px 8px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		text-align: center;
		pointer-events: none;
	}

	.intro {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.summary {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 4px var(--spacing-md);
		margin: 0;
	}

	.summary dt {
		color: var(--color-text-muted);
	}

	.summary dd {
		margin: 0;
		font-weight: 600;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md);
	}
</style>
