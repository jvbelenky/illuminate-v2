<script lang="ts">
	import type { AdvancedLampSettingsResponse } from '$lib/api/client';

	interface Props {
		sourceWidth: number | null;
		sourceLength: number | null;
		sourceDensity: number;
		settings: AdvancedLampSettingsResponse;
		unitLabel: string;
		gridPointsPlotBase64: string | null;
		loadingGridPointsPlot: boolean;
		intensityMapPlotBase64: string | null;
		loadingIntensityMapPlot: boolean;
		uploadingIntensityMap: boolean;
		intensityMapError: string | null;
		intensityMapFilename: string | null;
		onSourceWidthChange: (e: Event) => void;
		onSourceLengthChange: (e: Event) => void;
		onSourceDensityChange: (e: Event) => void;
		onRemoveIntensityMap: () => void;
		onIntensityMapUpload: (e: Event) => void;
	}

	let {
		sourceWidth = $bindable(),
		sourceLength = $bindable(),
		sourceDensity = $bindable(),
		settings,
		unitLabel,
		gridPointsPlotBase64,
		loadingGridPointsPlot,
		intensityMapPlotBase64,
		loadingIntensityMapPlot,
		uploadingIntensityMap,
		intensityMapError,
		intensityMapFilename,
		onSourceWidthChange,
		onSourceLengthChange,
		onSourceDensityChange,
		onRemoveIntensityMap,
		onIntensityMapUpload
	}: Props = $props();

	let fileInputRef: HTMLInputElement;

	function formatNumber(value: number | null | undefined, precision: number = 3): string {
		if (value === null || value === undefined) return '';
		return value.toFixed(precision);
	}

	const canShowSurfacePlot = $derived(
		sourceWidth !== null && sourceWidth > 0 &&
		sourceLength !== null && sourceLength > 0
	);
</script>

<div class="tab-luminous-opening">
	<section class="settings-section">
		<h3>Near-Field Source Options</h3>
		<div class="section-content">
			<div class="combined-controls-row">
				<div class="control-group centered">
					<div class="control-group-label">Source Discretization</div>
					<div class="form-row-3">
						<div class="form-group">
							<label for="source-width">Width [{unitLabel}]</label>
							<input
								id="source-width"
								type="number"
								value={formatNumber(sourceWidth)}
								onchange={onSourceWidthChange}
								min="0"
								step="0.01"
								placeholder="0"
							/>
						</div>
						<div class="form-group">
							<label for="source-length">Length [{unitLabel}]</label>
							<input
								id="source-length"
								type="number"
								value={formatNumber(sourceLength)}
								onchange={onSourceLengthChange}
								min="0"
								step="0.01"
								placeholder="0"
							/>
						</div>
						<div class="form-group">
							<label for="source-density">Point Density</label>
							<input
								id="source-density"
								type="number"
								value={sourceDensity}
								onchange={onSourceDensityChange}
								min="0"
								max="10"
								step="1"
							/>
						</div>
					</div>
				</div>

				<div class="control-group centered">
					<div class="control-group-label">Intensity Map</div>
					<input
						type="file"
						accept=".csv,.txt"
						bind:this={fileInputRef}
						onchange={onIntensityMapUpload}
						style="display: none;"
					/>
					<div class="intensity-map-controls">
						<button
							type="button"
							class="upload-btn"
							onclick={() => fileInputRef?.click()}
							disabled={uploadingIntensityMap}
						>
							{#if uploadingIntensityMap}
								<div class="spinner tiny"></div>
							{:else}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
									<polyline points="17 8 12 3 7 8"/>
									<line x1="12" y1="3" x2="12" y2="15"/>
								</svg>
							{/if}
							Upload CSV
						</button>
						{#if settings.has_intensity_map}
							<span class="status-badge success">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<polyline points="20 6 9 17 4 12"/>
								</svg>
								Loaded
							</span>
							<button
								type="button"
								class="remove-btn"
								onclick={onRemoveIntensityMap}
								disabled={uploadingIntensityMap}
								title="Remove"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M18 6L6 18M6 6l12 12"/>
								</svg>
							</button>
						{/if}
					</div>
					{#if settings.has_intensity_map && intensityMapFilename}
						<div class="intensity-map-filename">{intensityMapFilename}</div>
					{/if}
					{#if intensityMapError}
						<div class="intensity-map-error">{intensityMapError}</div>
					{/if}
				</div>
			</div>

			<div class="plots-row">
				<div class="plot-cell">
					{#if canShowSurfacePlot}
						{#if loadingGridPointsPlot}
							<div class="plot-loading">
								<div class="spinner small"></div>
							</div>
						{:else if gridPointsPlotBase64}
							<img src="data:image/png;base64,{gridPointsPlotBase64}" alt="Grid points" class="section-plot" />
						{:else}
							<div class="plot-placeholder">Unavailable</div>
						{/if}
					{:else}
						<div class="plot-placeholder">Set dimensions to view grid</div>
					{/if}
				</div>
				<div class="plot-cell">
					{#if settings.has_intensity_map}
						{#if loadingIntensityMapPlot}
							<div class="plot-loading">
								<div class="spinner small"></div>
							</div>
						{:else if intensityMapPlotBase64}
							<img src="data:image/png;base64,{intensityMapPlotBase64}" alt="Intensity map" class="section-plot" />
						{:else}
							<div class="plot-placeholder">Unavailable</div>
						{/if}
					{:else}
						<div class="plot-placeholder">Upload CSV to view intensity map</div>
					{/if}
				</div>
			</div>

			<div class="info-row">
				<div class="computed-values">
					{#if settings.photometric_distance}
						<div class="computed-row">
							<span class="label">Photometric distance:</span>
							<span class="value">{settings.photometric_distance.toFixed(3)} {unitLabel}</span>
						</div>
					{/if}
					<div class="computed-row">
						<span class="label">Grid points:</span>
						<span class="value">{settings.num_points[0]} x {settings.num_points[1]} = {settings.num_points[0] * settings.num_points[1]}</span>
					</div>
				</div>
				{#if settings.has_intensity_map && sourceDensity <= 1}
					<div class="info-note">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="10"/>
							<path d="M12 16v-4m0-4h.01"/>
						</svg>
						<span>Intensity map requires Point Density &gt; 1 to take effect</span>
					</div>
				{/if}
			</div>
		</div>
	</section>
</div>

<style>
	.tab-luminous-opening {
		padding: var(--spacing-md);
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

	.combined-controls-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.control-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.control-group.centered {
		align-items: center;
		text-align: center;
	}

	.control-group.centered .intensity-map-controls {
		justify-content: center;
	}

	.control-group-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
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

	.plots-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-sm);
	}

	.plot-cell {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 140px;
	}

	.section-plot {
		max-width: 100%;
		max-height: 180px;
		border-radius: var(--radius-sm);
	}

	.plot-placeholder {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-style: italic;
		text-align: center;
		padding: var(--spacing-sm);
	}

	.info-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
	}

	.info-row .computed-values {
		margin-top: 0;
		padding-top: 0;
		border-top: none;
	}

	.info-row .info-note {
		margin-top: 0;
	}

	.computed-values {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.computed-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
	}

	.computed-row .label {
		color: var(--color-text-muted);
	}

	.computed-row .value {
		color: var(--color-text);
		font-weight: 500;
	}

	.intensity-map-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		flex-wrap: wrap;
	}

	.upload-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.7rem;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
	}

	.upload-btn:hover:not(:disabled) {
		background: var(--color-border);
	}

	.upload-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.remove-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xs);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.remove-btn:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.1);
		border-color: var(--color-error, #ef4444);
		color: var(--color-error, #ef4444);
	}

	.remove-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
	}

	.status-badge.success {
		background: rgba(34, 197, 94, 0.15);
		color: var(--color-success, #22c55e);
	}

	.intensity-map-filename {
		margin-top: var(--spacing-xs);
		font-size: 0.7rem;
		color: var(--color-text-muted);
		word-break: break-all;
	}

	.intensity-map-error {
		margin-top: var(--spacing-xs);
		font-size: 0.7rem;
		color: var(--color-error, #ef4444);
	}

	.info-note {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin-top: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-info-bg, #dbeafe);
		border: 1px solid var(--color-info-border, #3b82f6);
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		color: var(--color-info-text, #1e40af);
	}

	.info-note svg {
		flex-shrink: 0;
		color: var(--color-info-icon, #3b82f6);
	}

	.plot-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-xs);
		color: var(--color-text-muted);
		font-size: 0.7rem;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin: 0 auto var(--spacing-sm);
	}

	.spinner.small {
		width: 20px;
		height: 20px;
		border-width: 2px;
		margin: 0;
	}

	.spinner.tiny {
		width: 12px;
		height: 12px;
		border-width: 2px;
		margin: 0;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (max-width: 650px) {
		.combined-controls-row,
		.plots-row,
		.info-row {
			grid-template-columns: 1fr;
		}
	}

	:global([data-theme="dark"]) .info-note {
		background: rgba(59, 130, 246, 0.15);
		border-color: rgba(59, 130, 246, 0.4);
		color: #93c5fd;
	}

	:global([data-theme="dark"]) .info-note svg {
		color: #60a5fa;
	}
</style>
