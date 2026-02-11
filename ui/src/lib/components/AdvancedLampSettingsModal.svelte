<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { autoFocus } from '$lib/actions/autoFocus';
	import type { LampInstance, RoomConfig, LampType } from '$lib/types/project';
	import { theme } from '$lib/stores/theme';
	import {
		getSessionLampAdvancedSettings,
		getSessionLampGridPointsPlot,
		getSessionLampIntensityMapPlot,
		updateSessionLampAdvanced,
		uploadSessionLampIntensityMap,
		deleteSessionLampIntensityMap,
		type AdvancedLampSettingsResponse,
		type ScalingMethod,
		type IntensityUnits
	} from '$lib/api/client';

	interface Props {
		lamp: LampInstance;
		room: RoomConfig;
		hasPhotometry?: boolean;
		lampType?: LampType;
		presetDisplayName?: string;
		onClose: () => void;
		onUpdate: () => void;
	}

	let { lamp, room, hasPhotometry = true, lampType = 'krcl_222', presetDisplayName, onClose, onUpdate }: Props = $props();

	// Compute lamp source label (preset name or filename)
	const lampSourceLabel = $derived(() => {
		if (presetDisplayName) return presetDisplayName;
		if (lamp.ies_filename) return lamp.ies_filename;
		if (lamp.preset_id && lamp.preset_id !== 'custom') return lamp.preset_id;
		return 'Custom';
	});

	// Loading state
	let loading = $state(true);
	let error = $state<string | null>(null);
	let saving = $state(false);

	// Advanced settings data
	let settings = $state<AdvancedLampSettingsResponse | null>(null);

	// Grid points plot
	let gridPointsPlotBase64 = $state<string | null>(null);
	let loadingGridPointsPlot = $state(false);

	// Intensity map plot
	let intensityMapPlotBase64 = $state<string | null>(null);
	let loadingIntensityMapPlot = $state(false);

	// Intensity map upload
	let uploadingIntensityMap = $state(false);
	let intensityMapError = $state<string | null>(null);
	let intensityMapFilename = $state<string | null>(null);
	let fileInputRef: HTMLInputElement;

	// Local editable state
	let scalingMethod = $state<ScalingMethod>('factor');
	let scalingValue = $state(1.0);
	let intensityUnits = $state<IntensityUnits>('mW/sr');
	let sourceWidth = $state<number | null>(null);
	let sourceLength = $state<number | null>(null);
	let sourceDensity = $state(1);

	// Track last-saved scaling to avoid re-sending unchanged values
	let lastSavedScalingMethod: ScalingMethod = 'factor';
	let lastSavedScalingValue: number = 1.0;
	let scalingDirty = false;

	// Debounce timer for auto-save
	let saveTimeout: ReturnType<typeof setTimeout>;
	let isInitialized = false;
	let lastScalingMethod = $state<ScalingMethod>('factor');

	// Unit label
	const unitLabel = $derived(room.units === 'feet' ? 'ft' : 'm');

	// Computed: can show surface plot (needs dimensions)
	const canShowSurfacePlot = $derived(
		sourceWidth !== null && sourceWidth > 0 &&
		sourceLength !== null && sourceLength > 0
	);

	// Get the appropriate current value for a scaling method
	function getCurrentValueForMethod(method: ScalingMethod): number {
		if (!settings) return 1.0;
		switch (method) {
			case 'factor':
				return settings.scaling_factor;
			case 'max':
				return settings.max_irradiance;
			case 'total':
				return settings.total_power_mw;
			case 'center':
				return settings.center_irradiance;
			default:
				return 1.0;
		}
	}

	// When scaling method changes, update value to the current unchanged value
	function handleScalingMethodChange() {
		if (settings && scalingMethod !== lastScalingMethod) {
			scalingValue = getCurrentValueForMethod(scalingMethod);
			lastScalingMethod = scalingMethod;
			scalingDirty = true;
		}
	}

	onMount(async () => {
		await fetchSettings();
	});

	onDestroy(() => {
		clearTimeout(saveTimeout);
	});

	// Track if we got a "not found" error (session sync issue)
	let notFoundError = $state(false);
	let retryCount = 0;
	const MAX_RETRIES = 3;
	const RETRY_DELAY_MS = 500;

	async function fetchSettings() {
		loading = true;
		error = null;
		notFoundError = false;
		try {
			settings = await getSessionLampAdvancedSettings(lamp.id);

			// Reset retry count on success
			retryCount = 0;

			// Initialize local state from fetched settings
			scalingValue = settings.scaling_factor;
			lastSavedScalingMethod = 'factor';
			lastSavedScalingValue = settings.scaling_factor;
			scalingDirty = false;
			intensityUnits = settings.intensity_units;
			sourceWidth = settings.source_width;
			sourceLength = settings.source_length;
			sourceDensity = settings.source_density;

			// Fetch plots if applicable
			if (settings.source_width && settings.source_length) {
				fetchGridPointsPlot();
			}
			if (settings.has_intensity_map) {
				fetchIntensityMapPlot();
			}

			// Allow effect tracking after initialization
			setTimeout(() => {
				isInitialized = true;
			}, 50);

			loading = false;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			// Check if this is a "not found" error (likely race condition with lamp sync)
			if (msg.includes('not found') || msg.includes('404')) {
				// Auto-retry a few times since the lamp might still be syncing
				if (retryCount < MAX_RETRIES) {
					retryCount++;
					console.log(`[AdvancedSettings] Lamp not found, retrying (${retryCount}/${MAX_RETRIES})...`);
					setTimeout(() => {
						fetchSettings();
					}, RETRY_DELAY_MS);
					return; // Don't set loading=false yet, keep spinner showing
				}
				// After max retries, show the error
				notFoundError = true;
				error = 'Lamp data is still syncing to the server. Please close and try again in a moment.';
			} else {
				error = msg;
			}
			loading = false;
		}
	}

	async function fetchGridPointsPlot() {
		if (!canShowSurfacePlot) {
			gridPointsPlotBase64 = null;
			return;
		}

		loadingGridPointsPlot = true;
		try {
			const result = await getSessionLampGridPointsPlot(lamp.id, $theme, 100);
			gridPointsPlotBase64 = result.plot_base64;
		} catch (e) {
			console.warn('Failed to load grid points plot:', e);
			gridPointsPlotBase64 = null;
		} finally {
			loadingGridPointsPlot = false;
		}
	}

	async function fetchIntensityMapPlot() {
		if (!settings?.has_intensity_map) {
			intensityMapPlotBase64 = null;
			return;
		}

		loadingIntensityMapPlot = true;
		try {
			const result = await getSessionLampIntensityMapPlot(lamp.id, $theme, 100);
			intensityMapPlotBase64 = result.plot_base64;
		} catch (e) {
			console.warn('Failed to load intensity map plot:', e);
			intensityMapPlotBase64 = null;
		} finally {
			loadingIntensityMapPlot = false;
		}
	}

	// Auto-save when values change
	$effect(() => {
		// Track all editable values
		const _method = scalingMethod;
		const _value = scalingValue;
		const _units = intensityUnits;
		const _width = sourceWidth;
		const _length = sourceLength;
		const _density = sourceDensity;

		if (!isInitialized) return;

		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			saveChanges();
		}, 300);
	});

	async function saveChanges() {
		if (!settings) return;

		saving = true;
		try {
			// Only send scaling fields when the user actually changed them
			const update: Record<string, unknown> = {
				intensity_units: intensityUnits,
				source_width: sourceWidth ?? undefined,
				source_length: sourceLength ?? undefined,
				source_density: sourceDensity
			};
			if (scalingDirty) {
				update.scaling_method = scalingMethod;
				update.scaling_value = scalingValue;
			}

			await updateSessionLampAdvanced(lamp.id, update as any);

			// Refresh settings to get updated computed values
			const updated = await getSessionLampAdvancedSettings(lamp.id);
			settings = updated;

			// Track what we just saved so we don't re-send unchanged scaling
			if (scalingDirty) {
				lastSavedScalingMethod = scalingMethod;
				lastSavedScalingValue = scalingValue;
				scalingDirty = false;
			}

			// Refresh grid points plot if dimensions changed
			if (canShowSurfacePlot) {
				fetchGridPointsPlot();
			} else {
				gridPointsPlotBase64 = null;
			}

			// Refresh intensity map plot (density affects the plot)
			if (updated.has_intensity_map) {
				fetchIntensityMapPlot();
			}

			// Notify parent that lamp was updated (pass new scaling_factor for store sync)
			onUpdate();
		} catch (e) {
			console.error('Failed to save advanced settings:', e);
			error = e instanceof Error ? e.message : 'Failed to save settings';
		} finally {
			saving = false;
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	// Helper to format numbers with appropriate precision
	function formatNumber(value: number | null | undefined, precision: number = 3): string {
		if (value === null || value === undefined) return '';
		return value.toFixed(precision);
	}

	// Input handlers
	function handleScalingValueChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = parseFloat(input.value);
		if (!isNaN(val) && val > 0) {
			scalingValue = val;
			scalingDirty = true;
		}
	}

	function handleSourceWidthChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = parseFloat(input.value);
		sourceWidth = isNaN(val) ? null : val;
	}

	function handleSourceLengthChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = parseFloat(input.value);
		sourceLength = isNaN(val) ? null : val;
	}

	function handleSourceDensityChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = parseInt(input.value);
		if (!isNaN(val) && val >= 0) {
			sourceDensity = val;
		}
	}

	// Intensity map handlers
	function triggerIntensityMapUpload() {
		fileInputRef?.click();
	}

	async function handleIntensityMapUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// Store the filename
		const filename = file.name;

		// Reset input so the same file can be selected again
		input.value = '';

		uploadingIntensityMap = true;
		intensityMapError = null;

		try {
			await uploadSessionLampIntensityMap(lamp.id, file);

			// Refresh settings to get updated has_intensity_map
			const updated = await getSessionLampAdvancedSettings(lamp.id);
			settings = updated;

			// Track the filename
			intensityMapFilename = filename;

			// Fetch the intensity map plot
			fetchIntensityMapPlot();

			onUpdate();
		} catch (e) {
			console.error('Failed to upload intensity map:', e);
			intensityMapError = e instanceof Error ? e.message : 'Failed to upload intensity map';
		} finally {
			uploadingIntensityMap = false;
		}
	}

	async function handleRemoveIntensityMap() {
		uploadingIntensityMap = true;
		intensityMapError = null;

		try {
			await deleteSessionLampIntensityMap(lamp.id);

			// Refresh settings
			const updated = await getSessionLampAdvancedSettings(lamp.id);
			settings = updated;

			// Clear the intensity map plot and filename
			intensityMapPlotBase64 = null;
			intensityMapFilename = null;

			onUpdate();
		} catch (e) {
			console.error('Failed to remove intensity map:', e);
			intensityMapError = e instanceof Error ? e.message : 'Failed to remove intensity map';
		} finally {
			uploadingIntensityMap = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="modal-title" use:autoFocus>
		<div class="modal-header">
			<h2 id="modal-title">
				Advanced Lamp Settings
				<span class="header-lamp-info">
					— {lamp.name || 'Lamp'} ({lampSourceLabel()})
				</span>
			</h2>
			<button type="button" class="close-btn" onclick={onClose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		{#if !hasPhotometry}
			<div class="no-photometry-state">
				<div class="no-photometry-icon">
					<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<circle cx="12" cy="12" r="10"/>
						<path d="M12 8v4m0 4h.01"/>
					</svg>
				</div>
				<h3>No Photometry Data</h3>
				<p>
					{#if lampType === 'krcl_222'}
						Select a lamp preset or upload an IES file to access advanced settings.
					{:else}
						Upload an IES file to access advanced settings.
					{/if}
				</p>
			</div>
		{:else if loading}
			<div class="loading-state">
				<div class="spinner"></div>
				<p>Loading advanced settings...</p>
			</div>
		{:else if error}
			<div class="error-state">
				{#if notFoundError}
					<div class="sync-icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
							<path d="M21 3v5h-5"/>
						</svg>
					</div>
				{/if}
				<p class="error-message">{error}</p>
				{#if notFoundError}
					<button type="button" onclick={onClose}>Close</button>
				{:else}
					<button type="button" onclick={fetchSettings}>Retry</button>
				{/if}
			</div>
		{:else if settings}
			<div class="modal-body">
				<!-- Status indicator -->
				{#if saving}
					<div class="saving-indicator">Saving...</div>
				{/if}

				<!-- Top Row: Scaling + Intensity Units -->
				<div class="top-row">
					<section class="settings-section">
						<h3>Photometry Scaling</h3>
						<div class="section-content">
							<div class="form-row-2">
								<div class="form-group">
									<label for="scaling-method">Method</label>
									<select id="scaling-method" bind:value={scalingMethod} onchange={handleScalingMethodChange}>
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
										onchange={handleScalingValueChange}
										min="0.001"
										step="0.1"
									/>
								</div>
							</div>
							<div class="computed-value">
								Current power: <strong>{settings.total_power_mw.toFixed(2)} mW</strong>
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
								<span>Wrong setting can cause ~10x errors</span>
							</div>
						</div>
					</section>
				</div>

				<!-- Bottom Section: Source Discretization + Intensity Map (combined) -->
				<section class="settings-section">
					<h3>Near-Field Source Options</h3>
					<div class="section-content">
						<!-- Controls row -->
						<div class="combined-controls-row">
							<!-- Source Discretization controls -->
							<div class="control-group centered">
								<div class="control-group-label">Source Discretization</div>
								<div class="form-row-3">
									<div class="form-group">
										<label for="source-width">Width [{unitLabel}]</label>
										<input
											id="source-width"
											type="number"
											value={formatNumber(sourceWidth)}
											onchange={handleSourceWidthChange}
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
											onchange={handleSourceLengthChange}
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
											onchange={handleSourceDensityChange}
											min="0"
											max="10"
											step="1"
										/>
									</div>
								</div>
							</div>

							<!-- Intensity Map controls -->
							<div class="control-group centered">
								<div class="control-group-label">Intensity Map</div>
								<input
									type="file"
									accept=".csv,.txt"
									bind:this={fileInputRef}
									onchange={handleIntensityMapUpload}
									style="display: none;"
								/>
								<div class="intensity-map-controls">
									<button
										type="button"
										class="upload-btn"
										onclick={triggerIntensityMapUpload}
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
											onclick={handleRemoveIntensityMap}
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

						<!-- Plots row - aligned with controls above -->
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

						<!-- Info row -->
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
		{/if}
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-md);
	}

	.modal-content {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		max-width: 800px;
		width: 100%;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		position: sticky;
		top: 0;
		background: var(--color-bg);
		z-index: 1;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.1rem;
		color: var(--color-text);
	}

	.header-lamp-info {
		font-weight: 400;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.close-btn {
		background: transparent;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: all 0.15s;
	}

	.close-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.modal-body {
		padding: var(--spacing-md);
		position: relative;
	}

	.loading-state,
	.error-state,
	.no-photometry-state {
		padding: var(--spacing-xl);
		text-align: center;
	}

	.no-photometry-state {
		padding: var(--spacing-xl) var(--spacing-lg);
	}

	.no-photometry-icon {
		color: var(--color-text-muted);
		margin-bottom: var(--spacing-md);
	}

	.no-photometry-state h3 {
		margin: 0 0 var(--spacing-sm) 0;
		font-size: 1.125rem;
		color: var(--color-text);
	}

	.no-photometry-state p {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.sync-icon {
		color: var(--color-text-muted);
		margin-bottom: var(--spacing-md);
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

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error-message {
		color: var(--color-error);
		margin-bottom: var(--spacing-md);
	}

	.saving-indicator {
		position: absolute;
		top: var(--spacing-sm);
		right: var(--spacing-md);
		font-size: 0.75rem;
		color: var(--color-accent);
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	/* Row Layouts */
	.top-row,
	.bottom-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
	}

	.top-row {
		margin-bottom: var(--spacing-md);
	}

	@media (max-width: 650px) {
		.top-row {
			grid-template-columns: 1fr;
		}
	}

	/* Combined controls row */
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

	/* Plots row - aligned with controls above */
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

	/* Info row */
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

	@media (max-width: 650px) {
		.combined-controls-row,
		.plots-row,
		.info-row {
			grid-template-columns: 1fr;
		}
	}

	/* Sections */
	.settings-section {
		display: flex;
		flex-direction: column;
	}

	.settings-section.full-height {
		flex: 1;
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

	/* Plot container */
	.plot-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 180px;
		margin: var(--spacing-sm) 0;
	}

	.section-plot {
		max-width: 100%;
		max-height: 220px;
		border-radius: var(--radius-sm);
	}

	.plot-placeholder {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-style: italic;
		text-align: center;
		padding: var(--spacing-sm);
	}

	/* Intensity map controls */
	.intensity-map-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		flex-wrap: wrap;
	}

	.intensity-map-hint {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-left: auto;
	}

	/* Forms */
	.form-row-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-sm);
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

	/* Radio buttons */
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

	/* Warning note */
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

	/* Info note */
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

	/* Computed values */
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

	.computed-values {
		margin-top: var(--spacing-sm);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
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

	.computed-row .value.success {
		color: var(--color-success, #22c55e);
	}

	/* Plot loading spinner */
	.plot-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-xs);
		color: var(--color-text-muted);
		font-size: 0.7rem;
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

	.intensity-map-actions {
		display: flex;
		gap: var(--spacing-xs);
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

	.spinner.tiny {
		width: 12px;
		height: 12px;
		border-width: 2px;
		margin: 0;
	}

	.intensity-map-error {
		margin-top: var(--spacing-xs);
		font-size: 0.7rem;
		color: var(--color-error, #ef4444);
	}

	.intensity-map-hint {
		margin-top: var(--spacing-xs);
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	/* Dark mode warning adjustments */
	:global([data-theme="dark"]) .warning-note {
		background: rgba(245, 158, 11, 0.15);
		border-color: rgba(245, 158, 11, 0.4);
		color: #fcd34d;
	}

	:global([data-theme="dark"]) .warning-note svg {
		color: #fbbf24;
	}

	/* Dark mode info adjustments */
	:global([data-theme="dark"]) .info-note {
		background: rgba(59, 130, 246, 0.15);
		border-color: rgba(59, 130, 246, 0.4);
		color: #93c5fd;
	}

	:global([data-theme="dark"]) .info-note svg {
		color: #60a5fa;
	}
</style>
