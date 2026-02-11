<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { autoFocus } from '$lib/actions/autoFocus';
	import { rovingTabindex } from '$lib/actions/rovingTabindex';
	import type { RoomConfig } from '$lib/types/project';
	import { lamps } from '$lib/stores/project';
	import { theme } from '$lib/stores/theme';
	import {
		getSessionLampAdvancedSettings,
		getSessionLampGridPointsPlot,
		getSessionLampIntensityMapPlot,
		updateSessionLampAdvanced,
		uploadSessionLampIntensityMap,
		deleteSessionLampIntensityMap,
		getPhotometricWeb,
		getSessionLampPhotometricWeb,
		type AdvancedLampSettingsResponse,
		type ScalingMethod,
		type IntensityUnits,
		type PhotometricWebData
	} from '$lib/api/client';
	import AdvancedLampTabScaling from './AdvancedLampTabScaling.svelte';
	import AdvancedLampTabLuminousOpening from './AdvancedLampTabLuminousOpening.svelte';
	import AdvancedLampTabFixture from './AdvancedLampTabFixture.svelte';

	interface Props {
		initialLampId: string;
		room: RoomConfig;
		onClose: () => void;
		onUpdate: () => void;
	}

	let { initialLampId, room, onClose, onUpdate }: Props = $props();

	// Lamp sidebar state
	let selectedLampId = $state(initialLampId);
	const selectedLamp = $derived($lamps.find(l => l.id === selectedLampId));

	// Derive photometry status per lamp
	function lampHasPhotometry(l: { preset_id?: string; lamp_type?: string; has_ies_file?: boolean }): boolean {
		return (
			(l.preset_id !== undefined && l.preset_id !== '' && l.preset_id !== 'custom' && l.lamp_type === 'krcl_222') ||
			!!l.has_ies_file
		);
	}

	const hasPhotometry = $derived(selectedLamp ? lampHasPhotometry(selectedLamp) : false);

	// Setting tab state
	let activeTab = $state<'scaling' | 'opening' | 'fixture'>('scaling');

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

	// Local editable state
	let scalingMethod = $state<ScalingMethod>('factor');
	let scalingValue = $state(1.0);
	let intensityUnits = $state<IntensityUnits>('mW/sr');
	let sourceWidth = $state<number | null>(null);
	let sourceLength = $state<number | null>(null);
	let sourceDensity = $state(1);

	// Housing dimensions
	let housingWidth = $state<number | null>(null);
	let housingLength = $state<number | null>(null);
	let housingHeight = $state<number | null>(null);

	// Photometric web data (for fixture 3D preview)
	let photometricWebData = $state<PhotometricWebData | null>(null);

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

	// Computed: can show surface plot
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

	function handleScalingMethodChange() {
		if (settings && scalingMethod !== lastScalingMethod) {
			scalingValue = getCurrentValueForMethod(scalingMethod);
			lastScalingMethod = scalingMethod;
			scalingDirty = true;
		}
	}

	onMount(async () => {
		await fetchSettings();
		fetchPhotometricWeb();
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
			settings = await getSessionLampAdvancedSettings(selectedLampId);

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
			housingWidth = settings.housing_width;
			housingLength = settings.housing_length;
			housingHeight = settings.housing_height;

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
			if (msg.includes('not found') || msg.includes('404')) {
				if (retryCount < MAX_RETRIES) {
					retryCount++;
					setTimeout(() => {
						fetchSettings();
					}, RETRY_DELAY_MS);
					return;
				}
				notFoundError = true;
				error = 'Lamp data is still syncing to the server. Please close and try again in a moment.';
			} else {
				error = msg;
			}
			loading = false;
		}
	}

	async function fetchPhotometricWeb() {
		if (!selectedLamp) return;

		const hasPreset = selectedLamp.preset_id && selectedLamp.preset_id !== 'custom';
		const hasSessionIes = selectedLamp.has_ies_file;

		if (!hasPreset && !hasSessionIes) {
			photometricWebData = null;
			return;
		}

		try {
			if (hasPreset) {
				photometricWebData = await getPhotometricWeb({
					preset_id: selectedLamp.preset_id!,
					scaling_factor: selectedLamp.scaling_factor,
					units: room.units,
					source_density: selectedLamp.source_density,
					source_width: selectedLamp.source_width,
					source_length: selectedLamp.source_length
				});
			} else {
				photometricWebData = await getSessionLampPhotometricWeb(selectedLampId);
			}
		} catch (e) {
			console.warn('Failed to fetch photometric web for fixture preview:', e);
			photometricWebData = null;
		}
	}

	async function fetchGridPointsPlot() {
		if (!canShowSurfacePlot) {
			gridPointsPlotBase64 = null;
			return;
		}

		loadingGridPointsPlot = true;
		try {
			const result = await getSessionLampGridPointsPlot(selectedLampId, $theme, 100);
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
			const result = await getSessionLampIntensityMapPlot(selectedLampId, $theme, 100);
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
		const _method = scalingMethod;
		const _value = scalingValue;
		const _units = intensityUnits;
		const _width = sourceWidth;
		const _length = sourceLength;
		const _density = sourceDensity;
		const _hw = housingWidth;
		const _hl = housingLength;
		const _hh = housingHeight;

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
			// Include housing dimensions if set
			if (housingWidth !== null) update.housing_width = housingWidth;
			if (housingLength !== null) update.housing_length = housingLength;
			if (housingHeight !== null) update.housing_height = housingHeight;

			await updateSessionLampAdvanced(selectedLampId, update as any);

			// Refresh settings to get updated computed values
			const updated = await getSessionLampAdvancedSettings(selectedLampId);
			settings = updated;

			if (scalingDirty) {
				lastSavedScalingMethod = scalingMethod;
				lastSavedScalingValue = scalingValue;
				scalingDirty = false;
			}

			if (canShowSurfacePlot) {
				fetchGridPointsPlot();
			} else {
				gridPointsPlotBase64 = null;
			}

			if (updated.has_intensity_map) {
				fetchIntensityMapPlot();
			}

			onUpdate();
		} catch (e) {
			console.error('Failed to save advanced settings:', e);
			error = e instanceof Error ? e.message : 'Failed to save settings';
		} finally {
			saving = false;
		}
	}

	// Lamp switch function
	async function switchLamp(lampId: string) {
		if (lampId === selectedLampId) return;
		// Flush pending save for current lamp
		clearTimeout(saveTimeout);
		if (isInitialized) await saveChanges();
		// Switch
		selectedLampId = lampId;
		isInitialized = false;
		// Clear current state
		settings = null;
		gridPointsPlotBase64 = null;
		intensityMapPlotBase64 = null;
		intensityMapFilename = null;
		intensityMapError = null;
		photometricWebData = null;
		// Fetch new lamp's data
		await fetchSettings();
		fetchPhotometricWeb();
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

	function handleHousingWidthChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = parseFloat(input.value);
		housingWidth = isNaN(val) ? null : val;
	}

	function handleHousingLengthChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = parseFloat(input.value);
		housingLength = isNaN(val) ? null : val;
	}

	function handleHousingHeightChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = parseFloat(input.value);
		housingHeight = isNaN(val) ? null : val;
	}

	// Intensity map handlers
	async function handleIntensityMapUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const filename = file.name;
		input.value = '';

		uploadingIntensityMap = true;
		intensityMapError = null;

		try {
			await uploadSessionLampIntensityMap(selectedLampId, file);
			const updated = await getSessionLampAdvancedSettings(selectedLampId);
			settings = updated;
			intensityMapFilename = filename;
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
			await deleteSessionLampIntensityMap(selectedLampId);
			const updated = await getSessionLampAdvancedSettings(selectedLampId);
			settings = updated;
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

	// Get lamp display label
	function getLampLabel(l: { name?: string; preset_id?: string; id: string }): string {
		return l.name || l.preset_id || l.id.slice(0, 8);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="modal-title" use:autoFocus>
		<div class="modal-header">
			<h2 id="modal-title">Advanced Lamp Settings</h2>
			<button type="button" class="close-btn" onclick={onClose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<div class="modal-body-layout">
			<!-- Left: Lamp sidebar -->
			<div class="lamp-sidebar" role="tablist" aria-orientation="vertical" aria-label="Lamps" use:rovingTabindex={{ orientation: 'vertical', selector: 'button' }}>
				{#each $lamps as l (l.id)}
					<button
						role="tab"
						class="lamp-tab"
						class:active={selectedLampId === l.id}
						aria-selected={selectedLampId === l.id}
						onclick={() => switchLamp(l.id)}
					>
						{getLampLabel(l)}
					</button>
				{/each}
			</div>

			<!-- Right: Settings area -->
			<div class="settings-area">
				{#if !hasPhotometry}
					<div class="no-photometry-state">
						<div class="no-photometry-icon">
							<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<circle cx="12" cy="12" r="10"/>
								<path d="M12 8v4m0 4h.01"/>
							</svg>
						</div>
						<h3>No Photometry Data</h3>
						<p>Select a lamp preset or upload an IES file to access advanced settings.</p>
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
					<!-- Top tabs -->
					<div class="tab-bar" role="tablist" aria-label="Settings categories" use:rovingTabindex={{ orientation: 'horizontal', selector: 'button' }}>
						<button
							role="tab"
							class="tab-btn"
							class:active={activeTab === 'scaling'}
							aria-selected={activeTab === 'scaling'}
							onclick={() => activeTab = 'scaling'}
						>
							Scaling & Units
						</button>
						<button
							role="tab"
							class="tab-btn"
							class:active={activeTab === 'opening'}
							aria-selected={activeTab === 'opening'}
							onclick={() => activeTab = 'opening'}
						>
							Luminous Opening
						</button>
						<button
							role="tab"
							class="tab-btn"
							class:active={activeTab === 'fixture'}
							aria-selected={activeTab === 'fixture'}
							onclick={() => activeTab = 'fixture'}
						>
							Lamp Fixture
						</button>
					</div>

					<!-- Tab content -->
					<div class="tab-panel">
						{#if saving}
							<div class="saving-indicator">Saving...</div>
						{/if}

						{#if activeTab === 'scaling'}
							<AdvancedLampTabScaling
								bind:scalingMethod
								bind:scalingValue
								bind:intensityUnits
								{settings}
								onScalingMethodChange={handleScalingMethodChange}
								onScalingValueChange={handleScalingValueChange}
							/>
						{:else if activeTab === 'opening'}
							<AdvancedLampTabLuminousOpening
								bind:sourceWidth
								bind:sourceLength
								bind:sourceDensity
								{settings}
								{unitLabel}
								{gridPointsPlotBase64}
								{loadingGridPointsPlot}
								{intensityMapPlotBase64}
								{loadingIntensityMapPlot}
								{uploadingIntensityMap}
								{intensityMapError}
								{intensityMapFilename}
								onSourceWidthChange={handleSourceWidthChange}
								onSourceLengthChange={handleSourceLengthChange}
								onSourceDensityChange={handleSourceDensityChange}
								onRemoveIntensityMap={handleRemoveIntensityMap}
								onIntensityMapUpload={handleIntensityMapUpload}
							/>
						{:else if activeTab === 'fixture'}
							<AdvancedLampTabFixture
								bind:housingWidth
								bind:housingLength
								bind:housingHeight
								{sourceWidth}
								{sourceLength}
								fixtureBounds={photometricWebData?.fixture_bounds ?? null}
								surfacePoints={photometricWebData?.surface_points ?? null}
								{unitLabel}
								onHousingWidthChange={handleHousingWidthChange}
								onHousingLengthChange={handleHousingLengthChange}
								onHousingHeightChange={handleHousingHeightChange}
							/>
						{/if}
					</div>
				{/if}
			</div>
		</div>
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
		max-width: 900px;
		width: 100%;
		max-height: 90vh;
		overflow: hidden;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.1rem;
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

	/* Two-axis layout: lamp sidebar + settings area */
	.modal-body-layout {
		display: flex;
		height: 520px;
		overflow: hidden;
	}

	/* Lamp sidebar */
	.lamp-sidebar {
		width: 160px;
		flex-shrink: 0;
		border-right: 1px solid var(--color-border);
		padding: var(--spacing-sm) 0;
		overflow-y: auto;
		max-height: 70vh;
	}

	.lamp-tab {
		display: block;
		width: 100%;
		padding: var(--spacing-xs) var(--spacing-sm);
		text-align: left;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-left: 2px solid transparent;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lamp-tab:hover {
		color: var(--color-text);
		background: var(--color-bg-secondary);
	}

	.lamp-tab.active {
		color: var(--color-accent);
		border-left-color: var(--color-accent);
		background: var(--color-bg-secondary);
	}

	/* Settings area (right side) */
	.settings-area {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}

	/* Top tab bar */
	.tab-bar {
		display: flex;
		padding: 0 var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.tab-btn {
		padding: var(--spacing-xs) var(--spacing-md);
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		margin-bottom: -1px;
		transition: all 0.15s;
	}

	.tab-btn:hover {
		color: var(--color-text);
	}

	.tab-btn.active {
		color: var(--color-accent);
		border-bottom-color: var(--color-accent);
	}

	/* Tab panel content */
	.tab-panel {
		flex: 1;
		position: relative;
		overflow-y: auto;
	}

	/* Loading/error/no-photometry states */
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
		z-index: 1;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}
</style>
