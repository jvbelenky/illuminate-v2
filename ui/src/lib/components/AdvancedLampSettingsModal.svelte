<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { LampInstance, RoomConfig, LampType } from '$lib/types/project';
	import { theme } from '$lib/stores/theme';
	import {
		getSessionLampAdvancedSettings,
		getSessionLampSurfacePlot,
		updateSessionLampAdvanced,
		type AdvancedLampSettingsResponse,
		type ScalingMethod,
		type IntensityUnits
	} from '$lib/api/client';

	interface Props {
		lamp: LampInstance;
		room: RoomConfig;
		hasPhotometry?: boolean;
		lampType?: LampType;
		onClose: () => void;
		onUpdate: () => void;
	}

	let { lamp, room, hasPhotometry = true, lampType = 'krcl_222', onClose, onUpdate }: Props = $props();

	// Loading state
	let loading = $state(true);
	let error = $state<string | null>(null);
	let saving = $state(false);

	// Advanced settings data
	let settings = $state<AdvancedLampSettingsResponse | null>(null);

	// Surface plot
	let surfacePlotBase64 = $state<string | null>(null);
	let loadingSurfacePlot = $state(false);

	// Local editable state
	let scalingMethod = $state<ScalingMethod>('factor');
	let scalingValue = $state(1.0);
	let intensityUnits = $state<IntensityUnits>('mW/sr');
	let sourceWidth = $state<number | null>(null);
	let sourceLength = $state<number | null>(null);
	let sourceDepth = $state<number | null>(null);
	let sourceDensity = $state(1);

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

	async function fetchSettings() {
		loading = true;
		error = null;
		notFoundError = false;
		try {
			settings = await getSessionLampAdvancedSettings(lamp.id);

			// Initialize local state from fetched settings
			scalingValue = settings.scaling_factor;
			intensityUnits = settings.intensity_units;
			sourceWidth = settings.source_width;
			sourceLength = settings.source_length;
			sourceDepth = settings.source_depth;
			sourceDensity = settings.source_density;

			// Fetch surface plot if dimensions are set
			if (settings.source_width && settings.source_length) {
				fetchSurfacePlot();
			}

			// Allow effect tracking after initialization
			setTimeout(() => {
				isInitialized = true;
			}, 50);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			// Check if this is a "not found" error (session sync issue)
			if (msg.includes('not found') || msg.includes('404')) {
				notFoundError = true;
				error = 'Lamp data is still syncing to the server. Please close and try again in a moment.';
			} else {
				error = msg;
			}
		} finally {
			loading = false;
		}
	}

	async function fetchSurfacePlot() {
		if (!canShowSurfacePlot) {
			surfacePlotBase64 = null;
			return;
		}

		loadingSurfacePlot = true;
		try {
			const result = await getSessionLampSurfacePlot(lamp.id, $theme, 150);
			surfacePlotBase64 = result.plot_base64;
		} catch (e) {
			console.warn('Failed to load surface plot:', e);
			surfacePlotBase64 = null;
		} finally {
			loadingSurfacePlot = false;
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
		const _depth = sourceDepth;
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
			await updateSessionLampAdvanced(lamp.id, {
				scaling_method: scalingMethod,
				scaling_value: scalingValue,
				intensity_units: intensityUnits,
				source_width: sourceWidth ?? undefined,
				source_length: sourceLength ?? undefined,
				source_depth: sourceDepth ?? undefined,
				source_density: sourceDensity
			});

			// Refresh settings to get updated computed values
			const updated = await getSessionLampAdvancedSettings(lamp.id);
			settings = updated;

			// Refresh surface plot if dimensions changed
			if (canShowSurfacePlot) {
				fetchSurfacePlot();
			} else {
				surfacePlotBase64 = null;
			}

			// Notify parent that lamp was updated
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

	function handleSourceDepthChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = parseFloat(input.value);
		sourceDepth = isNaN(val) ? null : val;
	}

	function handleSourceDensityChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = parseInt(input.value);
		if (!isNaN(val) && val >= 0) {
			sourceDensity = val;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="modal-title">
		<div class="modal-header">
			<h2 id="modal-title">Advanced Lamp Settings</h2>
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

				<div class="two-column-layout">
					<!-- Left Column: Scaling & Units -->
					<div class="column">
						<!-- Photometry Scaling Section -->
						<section class="settings-section">
							<h3>Photometry Scaling</h3>
							<div class="section-content">
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
								<div class="computed-value">
									Current power: <strong>{settings.total_power_mw.toFixed(2)} mW</strong>
									{#if settings.scaling_factor !== 1.0}
										<span class="scale-info">({(settings.scaling_factor * 100).toFixed(0)}%)</span>
									{/if}
								</div>
							</div>
						</section>

						<!-- Intensity Units Section -->
						<section class="settings-section">
							<h3>Intensity Units</h3>
							<div class="section-content">
								<div class="radio-group">
									<label class="radio-label">
										<input
											type="radio"
											name="intensity-units"
											value="mW/sr"
											bind:group={intensityUnits}
										/>
										<span>mW/sr (default)</span>
									</label>
									<label class="radio-label">
										<input
											type="radio"
											name="intensity-units"
											value="uW/cm2"
											bind:group={intensityUnits}
										/>
										<span>uW/cm²</span>
									</label>
								</div>
								<div class="warning-note">
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
									</svg>
									<span>Wrong setting can cause ~10x errors</span>
								</div>
							</div>
						</section>
					</div>

					<!-- Right Column: Near-field Options -->
					<div class="column">
						<section class="settings-section full-height">
							<h3>Near-field Source Options</h3>
							<div class="section-content">
								<div class="form-grid-2">
									<div class="form-group">
										<label for="source-width">Width (X) [{unitLabel}]</label>
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
										<label for="source-length">Length (Y) [{unitLabel}]</label>
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
										<label for="source-depth">Depth (Z) [{unitLabel}]</label>
										<input
											id="source-depth"
											type="number"
											value={formatNumber(sourceDepth)}
											onchange={handleSourceDepthChange}
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

								<div class="computed-values">
									{#if settings.photometric_distance}
										<div class="computed-row">
											<span class="label">Photometric distance:</span>
											<span class="value">{settings.photometric_distance.toFixed(3)} {unitLabel}</span>
										</div>
									{/if}
									<div class="computed-row">
										<span class="label">Grid points:</span>
										<span class="value">{settings.num_points[0]} x {settings.num_points[1]} = {settings.num_points[0] * settings.num_points[1]} points</span>
									</div>
									{#if settings.has_intensity_map}
										<div class="computed-row">
											<span class="label">Intensity map:</span>
											<span class="value success">Loaded</span>
										</div>
									{/if}
								</div>

								<!-- Surface Plot -->
								{#if canShowSurfacePlot}
									<div class="surface-plot-container">
										{#if loadingSurfacePlot}
											<div class="plot-loading">
												<div class="spinner small"></div>
												<span>Loading plot...</span>
											</div>
										{:else if surfacePlotBase64}
											<img
												src="data:image/png;base64,{surfacePlotBase64}"
												alt="Source surface discretization"
												class="surface-plot"
											/>
										{:else}
											<div class="plot-placeholder">
												Surface visualization unavailable
											</div>
										{/if}
									</div>
								{:else}
									<div class="plot-placeholder">
										Set source width and length to view surface discretization
									</div>
								{/if}
							</div>
						</section>
					</div>
				</div>
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
		max-width: 750px;
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
		font-size: 1.25rem;
		color: var(--color-text);
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

	/* Two Column Layout */
	.two-column-layout {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
	}

	@media (max-width: 650px) {
		.two-column-layout {
			grid-template-columns: 1fr;
		}
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
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
		margin: 0 0 var(--spacing-sm) 0;
		font-size: 0.875rem;
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
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	/* Forms */
	.form-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-sm);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		margin-bottom: var(--spacing-sm);
	}

	.form-group:last-child {
		margin-bottom: 0;
	}

	.form-group label {
		font-size: 0.813rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.form-group input,
	.form-group select {
		padding: var(--spacing-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.875rem;
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
		font-size: 0.875rem;
	}

	.radio-label input[type="radio"] {
		width: 16px;
		height: 16px;
		margin: 0;
		cursor: pointer;
	}

	/* Warning note */
	.warning-note {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-warning-bg, #fef3c7);
		border: 1px solid var(--color-warning-border, #f59e0b);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		color: var(--color-warning-text, #92400e);
	}

	.warning-note svg {
		flex-shrink: 0;
		color: var(--color-warning-icon, #f59e0b);
	}

	/* Computed values */
	.computed-value {
		margin-top: var(--spacing-sm);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
		font-size: 0.813rem;
		color: var(--color-text);
	}

	.computed-value strong {
		color: var(--color-accent);
	}

	.scale-info {
		color: var(--color-text-muted);
		font-size: 0.75rem;
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
		font-size: 0.813rem;
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

	/* Surface plot */
	.surface-plot-container {
		margin-top: var(--spacing-sm);
		flex: 1;
		min-height: 150px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.surface-plot {
		max-width: 100%;
		max-height: 200px;
		border-radius: var(--radius-sm);
	}

	.plot-loading {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		color: var(--color-text-muted);
		font-size: 0.813rem;
	}

	.plot-placeholder {
		padding: var(--spacing-md);
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.813rem;
		font-style: italic;
		background: var(--color-bg);
		border-radius: var(--radius-sm);
		margin-top: var(--spacing-sm);
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
</style>
