<script lang="ts">
	import type { AdvancedLampSettingsResponse, ScalingMethod, IntensityUnits } from '$lib/api/client';

	interface Props {
		scalingMethod: ScalingMethod;
		scalingValue: number;
		intensityUnits: IntensityUnits;
		settings: AdvancedLampSettingsResponse;
		precision: number;
		onScalingMethodChange: () => void;
		onScalingValueChange: (e: Event) => void;
	}

	let {
		scalingMethod = $bindable(),
		scalingValue = $bindable(),
		intensityUnits = $bindable(),
		settings,
		precision,
		onScalingMethodChange,
		onScalingValueChange
	}: Props = $props();
</script>

<div class="tab-scaling">
	<div class="top-row">
		<section class="settings-section">
			<h3>Photometry Scaling</h3>
			<div class="section-content">
				<div class="form-row-2">
					<div class="form-group">
						<label for="scaling-method">Method</label>
						<select id="scaling-method" bind:value={scalingMethod} onchange={onScalingMethodChange}>
							<option value="factor">Scale by factor</option>
							<option value="max">Scale to max irradiance</option>
							<option value="total">Scale to total power</option>
							<option value="center">Scale to center irradiance</option>
						</select>
					</div>
					<div class="form-group">
						<label for="scaling-value">
							{#if scalingMethod === 'factor'}
								Factor
							{:else if scalingMethod === 'max'}
								Max (uW/cm²)
							{:else if scalingMethod === 'total'}
								Power (mW)
							{:else}
								Center (uW/cm²)
							{/if}
						</label>
						<input
							id="scaling-value"
							type="number"
							value={scalingValue}
							onchange={onScalingValueChange}
							min="0.001"
							step="0.1"
						/>
					</div>
				</div>
				<div class="computed-value">
					Current power: <strong>{settings.total_power_mw.toFixed(precision)} mW</strong>
					{#if settings.scaling_factor !== 1.0}
						<span class="scale-info">({(settings.scaling_factor * 100).toFixed(0)}%)</span>
					{/if}
				</div>
			</div>
		</section>

		<section class="settings-section">
			<h3>Intensity Units</h3>
			<div class="section-content">
				<div class="radio-group">
					<label class="radio-label">
						<input type="radio" name="intensity-units" value="mW/sr" bind:group={intensityUnits} />
						<span>mW/sr (default)</span>
					</label>
					<label class="radio-label">
						<input type="radio" name="intensity-units" value="uW/cm2" bind:group={intensityUnits} />
						<span>uW/cm²</span>
					</label>
				</div>
				<div class="warning-note">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
					</svg>
					<span>Wrong setting can cause 10x errors</span>
				</div>
			</div>
		</section>
	</div>
</div>

<style>
	.tab-scaling {
		padding: var(--spacing-md);
	}

	.top-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
	}

	@media (max-width: 650px) {
		.top-row {
			grid-template-columns: 1fr;
		}
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

	.form-row-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-sm);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		margin-bottom: var(--spacing-xs);
	}

	.form-group:last-child {
		margin-bottom: 0;
	}

	.form-group label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.form-group input,
	.form-group select {
		padding: var(--spacing-xs) var(--spacing-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8rem;
	}

	.form-group input:focus,
	.form-group select:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px var(--color-accent-alpha, rgba(99, 102, 241, 0.2));
	}

	.radio-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.radio-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		cursor: pointer;
		font-size: 0.8rem;
	}

	.radio-label input[type="radio"] {
		width: 14px;
		height: 14px;
		margin: 0;
		cursor: pointer;
	}

	.warning-note {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin-top: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-warning-bg, #fef3c7);
		border: 1px solid var(--color-warning-border, #f59e0b);
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		color: var(--color-warning-text, #92400e);
	}

	.warning-note svg {
		flex-shrink: 0;
		color: var(--color-warning-icon, #f59e0b);
	}

	.computed-value {
		margin-top: var(--spacing-sm);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
		font-size: 0.75rem;
		color: var(--color-text);
	}

	.computed-value strong {
		color: var(--color-accent);
	}

	.scale-info {
		color: var(--color-text-muted);
		font-size: 0.7rem;
		margin-left: var(--spacing-xs);
	}

	:global([data-theme="dark"]) .warning-note {
		background: rgba(245, 158, 11, 0.15);
		border-color: rgba(245, 158, 11, 0.4);
		color: #fcd34d;
	}

	:global([data-theme="dark"]) .warning-note svg {
		color: #fbbf24;
	}
</style>
