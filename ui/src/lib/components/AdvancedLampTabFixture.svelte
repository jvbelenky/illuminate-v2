<script lang="ts">
	import FixtureEditor from './FixtureEditor.svelte';
	import type { IesAnalysisResponse } from '$lib/api/contract';
	import type { LengthUnit } from '$lib/utils/unitConversion';
	import type { FixtureDraft } from '$lib/utils/housingGeometry';

	interface Props {
		draft: FixtureDraft;
		onchange: (d: FixtureDraft) => void;
		iesAnalysis: IesAnalysisResponse | null;
		units: LengthUnit;
		sourceWidth: number | null;
		sourceLength: number | null;
	}

	let { draft, onchange, iesAnalysis, units, sourceWidth, sourceLength }: Props = $props();
</script>

<div class="tab-fixture">
	<section class="settings-section">
		<h3>Fixture</h3>
		<div class="section-content">
			<FixtureEditor
				value={draft}
				{onchange}
				analysis={iesAnalysis}
				{units}
				fallbackHousing={null}
				surface={sourceWidth != null && sourceLength != null ? { width: sourceWidth, length: sourceLength } : null}
			/>
		</div>
	</section>
</div>

<style>
	.tab-fixture {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.settings-section {
		display: flex;
		flex-direction: column;
	}

	.settings-section h3 {
		margin: 0 0 var(--spacing-xs) 0;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.section-content {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}
</style>
