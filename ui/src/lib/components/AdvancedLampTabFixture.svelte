<script lang="ts">
	import { Canvas } from '@threlte/core';
	import FixturePreview3D from './FixturePreview3D.svelte';

	interface Props {
		housingWidth: number | null;
		housingLength: number | null;
		housingHeight: number | null;
		sourceWidth: number | null;
		sourceLength: number | null;
		fixtureBounds: number[][] | null;
		surfacePoints: number[][] | null;
		unitLabel: string;
		onHousingWidthChange: (e: Event) => void;
		onHousingLengthChange: (e: Event) => void;
		onHousingHeightChange: (e: Event) => void;
	}

	let {
		housingWidth = $bindable(),
		housingLength = $bindable(),
		housingHeight = $bindable(),
		sourceWidth,
		sourceLength,
		fixtureBounds,
		surfacePoints,
		unitLabel,
		onHousingWidthChange,
		onHousingLengthChange,
		onHousingHeightChange
	}: Props = $props();

	function formatNumber(value: number | null | undefined, precision: number = 3): string {
		if (value === null || value === undefined) return '';
		return value.toFixed(precision);
	}
</script>

<div class="tab-fixture">
	<section class="settings-section">
		<h3>Housing Dimensions</h3>
		<div class="section-content">
			<div class="form-row-3">
				<div class="form-group">
					<label for="housing-width">Width [{unitLabel}]</label>
					<input
						id="housing-width"
						type="number"
						value={formatNumber(housingWidth)}
						onchange={onHousingWidthChange}
						min="0"
						step="0.01"
						placeholder="0"
					/>
				</div>
				<div class="form-group">
					<label for="housing-length">Length [{unitLabel}]</label>
					<input
						id="housing-length"
						type="number"
						value={formatNumber(housingLength)}
						onchange={onHousingLengthChange}
						min="0"
						step="0.01"
						placeholder="0"
					/>
				</div>
				<div class="form-group">
					<label for="housing-height">Height [{unitLabel}]</label>
					<input
						id="housing-height"
						type="number"
						value={formatNumber(housingHeight)}
						onchange={onHousingHeightChange}
						min="0"
						step="0.01"
						placeholder="0"
					/>
				</div>
			</div>
		</div>
	</section>

	<section class="settings-section preview-section">
		<h3>3D Preview</h3>
		<div class="preview-container">
			<Canvas>
				<FixturePreview3D
					{fixtureBounds}
					{surfacePoints}
					{sourceWidth}
					{sourceLength}
				/>
			</Canvas>
			<div class="preview-hint">Drag to rotate, scroll to zoom</div>
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

	.form-row-3 {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: var(--spacing-sm);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.form-group label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.form-group input {
		padding: var(--spacing-xs) var(--spacing-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8rem;
	}

	.form-group input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px var(--color-accent-alpha, rgba(99, 102, 241, 0.2));
	}

	.preview-section {
		flex: 1;
	}

	.preview-container {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		height: 280px;
		position: relative;
		overflow: hidden;
	}

	.preview-hint {
		position: absolute;
		bottom: var(--spacing-xs);
		right: var(--spacing-sm);
		font-size: 0.65rem;
		color: var(--color-text-muted);
		opacity: 0.7;
		pointer-events: none;
	}
</style>
