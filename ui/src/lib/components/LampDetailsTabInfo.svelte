<script lang="ts">
	import { getLampInfo, getSessionLampInfo, getSessionLampPlots, getLampIesDownloadUrl, getLampSpectrumDownloadUrl } from '$lib/api/client';
	import type { LampInfoResponse, SessionLampInfoResponse } from '$lib/api/client';
	import { theme } from '$lib/stores/theme';
	import { project } from '$lib/stores/project';
	import type { LampType } from '$lib/types/project';

	interface Props {
		presetId?: string;  // For preset lamps
		lampId?: string;    // For session lamps (custom IES)
		lampName: string;
		hasIes?: boolean;
		lampType?: LampType;
		spectrumUploading?: boolean;  // True when a spectrum file upload is in-flight
		onLightboxChange?: (open: boolean) => void;  // Notify parent when lightbox opens/closes
	}

	let { presetId, lampId, lampName, hasIes = true, lampType = 'krcl_222', spectrumUploading = false, onLightboxChange }: Props = $props();

	// Determine if this is a session lamp (custom IES) or preset lamp
	const isSessionLamp = !presetId && !!lampId;

	// State - use a union type for both response types
	let loading = $state(true);
	let error = $state<string | null>(null);
	let lampInfo = $state<LampInfoResponse | SessionLampInfoResponse | null>(null);
	let spectrumScale = $state<'linear' | 'log'>('log');
	let plotsLoading = $state(false);
	let lastFetchedTheme = $state<string | null>(null);
	let expandedImageType = $state<'photometric' | 'spectrum' | 'spectrum_linear' | 'spectrum_log' | null>(null);

	// Retry logic for race conditions with lamp sync
	let retryCount = 0;
	const MAX_RETRIES = 3;
	const RETRY_DELAY_MS = 500;

	// Generation counter to ignore stale fetch responses (e.g. when a re-fetch
	// is triggered while the original fetch is still in-flight)
	let fetchGeneration = 0;

	// Fetch lamp info on mount and when theme changes
	$effect(() => {
		const currentTheme = $theme;
		if (currentTheme !== lastFetchedTheme) {
			lastFetchedTheme = currentTheme;
			fetchLampInfo();
		}
	});

	// Re-fetch when a spectrum upload completes while the modal is open
	let prevSpectrumUploading = spectrumUploading;
	$effect(() => {
		const uploading = spectrumUploading;
		if (prevSpectrumUploading && !uploading) {
			// Upload just finished — re-fetch to get the new spectrum data
			prevSpectrumUploading = uploading;
			fetchLampInfo();
		}
		prevSpectrumUploading = uploading;
	});

	async function fetchPlots(thisGeneration: number) {
		if (!isSessionLamp || !lampId) return;
		plotsLoading = true;
		try {
			// Fetch lo-res only for fast initial display
			const plots = await getSessionLampPlots(lampId, spectrumScale, $theme, 100, false);
			if (thisGeneration !== fetchGeneration) return;
			if (lampInfo) {
				lampInfo = { ...lampInfo, ...plots };
			}
		} catch (e) {
			console.warn('[LampInfo] Failed to load plots:', e);
		} finally {
			if (thisGeneration === fetchGeneration) {
				plotsLoading = false;
			}
		}
	}

	// Fetch hi-res on demand when user opens lightbox
	let loadingHiRes = $state(false);
	async function fetchHiRes() {
		if (!isSessionLamp || !lampId || loadingHiRes) return;
		// Already have hi-res?
		if (lampInfo && 'photometric_plot_hires_base64' in lampInfo && lampInfo.photometric_plot_hires_base64) return;
		loadingHiRes = true;
		try {
			const plots = await getSessionLampPlots(lampId, spectrumScale, $theme, 150, true);
			if (lampInfo) {
				lampInfo = { ...lampInfo, ...plots };
			}
		} catch (e) {
			console.warn('[LampInfo] Failed to load hi-res plots:', e);
		} finally {
			loadingHiRes = false;
		}
	}

	async function fetchLampInfo() {
		const thisGeneration = ++fetchGeneration;
		loading = true;
		error = null;
		try {
			// Check prefetch cache for session lamps (populated on file upload)
			if (isSessionLamp && lampId) {
				const cached = project.getLampInfoCache(lampId, $theme);
				if (cached) {
					lampInfo = cached;
					retryCount = 0;
					loading = false;
					// Cache may have partial data (no plots yet) — fetch them
					const needsPhotometric = cached.has_ies && !cached.photometric_plot_base64;
					const needsSpectrum = cached.has_spectrum && !cached.spectrum_plot_base64;
					if (needsPhotometric || needsSpectrum) {
						fetchPlots(thisGeneration);
					}
					return;
				}
			}

			let result: LampInfoResponse | SessionLampInfoResponse;
			if (isSessionLamp && lampId) {
				result = await getSessionLampInfo(lampId);
			} else if (presetId) {
				result = await getLampInfo(presetId, spectrumScale, $theme);
			} else {
				throw new Error('No lamp identifier provided');
			}
			// Ignore stale response if a newer fetch was started
			if (thisGeneration !== fetchGeneration) return;
			lampInfo = result;
			// Reset retry count on success
			retryCount = 0;
			loading = false;

			// For session lamps, fetch all plots progressively
			if (isSessionLamp && (result.has_ies || result.has_spectrum)) {
				fetchPlots(thisGeneration);
			}
		} catch (e) {
			if (thisGeneration !== fetchGeneration) return;
			const msg = e instanceof Error ? e.message : 'Failed to load lamp info';
			// Check if this is a "not found" error (likely race condition with lamp sync)
			if (isSessionLamp && (msg.includes('not found') || msg.includes('404'))) {
				// Auto-retry a few times since the lamp might still be syncing
				if (retryCount < MAX_RETRIES) {
					retryCount++;
					console.log(`[LampInfo] Lamp not found, retrying (${retryCount}/${MAX_RETRIES})...`);
					setTimeout(() => {
						fetchLampInfo();
					}, RETRY_DELAY_MS);
					return; // Don't set loading=false yet
				}
			}
			error = msg;
			loading = false;
		}
	}

	// Hi-res images derived from response (fetched on-demand for lightbox)
	let hiResPhotometric = $derived.by(() => {
		if (!lampInfo) return null;
		const hires = 'photometric_plot_hires_base64' in lampInfo ? lampInfo.photometric_plot_hires_base64 : null;
		return hires ? `data:image/png;base64,${hires}` : null;
	});
	let hiResSpectrum = $derived.by(() => {
		if (!lampInfo) return null;
		// For preset lamps with both scales, use the current scale's hires
		if (spectrumScale === 'linear') {
			const hires = 'spectrum_linear_plot_hires_base64' in lampInfo ? lampInfo.spectrum_linear_plot_hires_base64 : null;
			if (hires) return `data:image/png;base64,${hires}`;
		}
		if (spectrumScale === 'log') {
			const hires = 'spectrum_log_plot_hires_base64' in lampInfo ? lampInfo.spectrum_log_plot_hires_base64 : null;
			if (hires) return `data:image/png;base64,${hires}`;
		}
		const hires = 'spectrum_plot_hires_base64' in lampInfo ? lampInfo.spectrum_plot_hires_base64 : null;
		return hires ? `data:image/png;base64,${hires}` : null;
	});
	let hiResSpectrumLinear = $derived.by(() => {
		if (!lampInfo) return null;
		const hires = 'spectrum_linear_plot_hires_base64' in lampInfo ? lampInfo.spectrum_linear_plot_hires_base64 : null;
		return hires ? `data:image/png;base64,${hires}` : null;
	});
	let hiResSpectrumLog = $derived.by(() => {
		if (!lampInfo) return null;
		const hires = 'spectrum_log_plot_hires_base64' in lampInfo ? lampInfo.spectrum_log_plot_hires_base64 : null;
		return hires ? `data:image/png;base64,${hires}` : null;
	});

	function toggleSpectrumScale() {
		if (!lampInfo?.has_spectrum) return;

		const newScale = spectrumScale === 'linear' ? 'log' : 'linear';

		// Both scales are always bundled in the response — just swap locally
		const linearPlot = 'spectrum_linear_plot_base64' in lampInfo ? lampInfo.spectrum_linear_plot_base64 : null;
		const logPlot = 'spectrum_log_plot_base64' in lampInfo ? lampInfo.spectrum_log_plot_base64 : null;
		if (linearPlot && logPlot) {
			lampInfo = {
				...lampInfo,
				spectrum_plot_base64: newScale === 'linear' ? linearPlot : logPlot,
			};
		}
		spectrumScale = newScale;
	}

	/** Close lightbox if open. Returns true if it was open (handled). */
	export function closeLightbox(): boolean {
		if (expandedImageType) {
			expandedImageType = null;
			onLightboxChange?.(false);
			return true;
		}
		return false;
	}

	function downloadIes() {
		if (presetId) {
			window.open(getLampIesDownloadUrl(presetId), '_blank');
		}
	}

	function downloadSpectrum() {
		if (presetId) {
			window.open(getLampSpectrumDownloadUrl(presetId), '_blank');
		}
	}

	// Check if downloads are available (only for preset lamps)
	const canDownload = !!presetId;

	function openImageLightbox(imageType: 'photometric' | 'spectrum') {
		expandedImageType = imageType;
		onLightboxChange?.(true);
		// For session lamps, fetch hi-res on demand (prefetch only loads lo-res)
		if (isSessionLamp) {
			fetchHiRes();
		}
	}

	// Derive the current expanded image based on type and hi-res availability
	let expandedImage = $derived.by(() => {
		if (!expandedImageType) return null;
		if (expandedImageType === 'photometric') {
			return hiResPhotometric;
		} else if (expandedImageType === 'spectrum') {
			return hiResSpectrum;
		} else if (expandedImageType === 'spectrum_linear') {
			return hiResSpectrumLinear;
		} else if (expandedImageType === 'spectrum_log') {
			return hiResSpectrumLog;
		}
		return null;
	});

	function handleLightboxClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			expandedImageType = null;
			onLightboxChange?.(false);
		}
	}

	/** Format TLV value: show "--" when zero (no wavelength data), otherwise 1 decimal */
	function fmtTlv(val: number): string {
		return val > 0 ? val.toFixed(1) : '--';
	}

	// True when we have stale data and are fetching fresh data in the background
	// (e.g. after a spectrum upload completes and we're re-fetching to get the plots)
	let spectrumRefreshing = $derived(loading && !!lampInfo && !lampInfo.has_spectrum);

	const displayTitle = $derived(lampName + (lampInfo?.name ? ` (${lampInfo.name})` : ''));
</script>

{#if loading && !lampInfo}
	<div class="loading-state">
		<div class="spinner"></div>
		<p>Loading lamp information...</p>
	</div>
{:else if error && !lampInfo}
	<div class="error-state">
		<p class="error-message">{error}</p>
		<button type="button" onclick={fetchLampInfo}>Retry</button>
	</div>
{:else if lampInfo}
	<div class="info-tab-body">
		<h3 class="info-title">{displayTitle}</h3>
		<div class="main-section" class:single-column={!hasIes}>
			{#if hasIes}
				<!-- Photometric plot -->
				<div class="left-column">
					<div class="plot-section">
						<h3>Photometric Distribution</h3>
						{#if lampInfo.photometric_plot_base64}
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
							<img
								src="data:image/png;base64,{lampInfo.photometric_plot_base64}"
								alt="Photometric distribution polar plot"
								class="plot-image clickable"
								onclick={() => openImageLightbox('photometric')}
							/>
						{:else if plotsLoading}
							<div class="plot-loading">
								<div class="spinner small"></div>
								<p>Loading plot...</p>
							</div>
						{:else}
							<div class="no-plot">No photometric data available</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Power + TLV Section -->
			<div class="specs-section">
				{#if hasIes}
					<div class="spec-block power-block">
						<h3>Total Optical Output: <span class="power-value">{lampInfo.total_power_mw.toFixed(1)}</span> <span class="power-unit">mW</span></h3>
					</div>
				{/if}

				<div class="spec-block">
					<h3>8-Hour Exposure Limits (mJ/cm²)</h3>
					<table class="tlv-table">
						<thead>
							<tr>
								<th></th>
								<th>ACGIH</th>
								<th>ICNIRP</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td class="row-label">Skin</td>
								<td>{fmtTlv(lampInfo.tlv_acgih.skin)}</td>
								<td>{fmtTlv(lampInfo.tlv_icnirp.skin)}</td>
							</tr>
							<tr>
								<td class="row-label">Eye</td>
								<td>{fmtTlv(lampInfo.tlv_acgih.eye)}</td>
								<td>{fmtTlv(lampInfo.tlv_icnirp.eye)}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>

			<!-- Spectrum Section -->
			<div class="spectrum-wrapper">
				{#if lampInfo.has_spectrum && !lampInfo.spectrum_plot_base64 && plotsLoading}
					<div class="no-spectrum-note">
						<div class="spectrum-loading">
							<div class="spinner small"></div>
							<p><strong>Loading spectrum plots...</strong></p>
						</div>
					</div>
				{:else if lampInfo.has_spectrum}
					{#if !hasIes && 'spectrum_linear_plot_base64' in lampInfo && lampInfo.spectrum_linear_plot_base64}
						<!-- Dual side-by-side spectrum plots when no IES -->
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
						<div class="dual-spectrum">
							<div class="spectrum-section">
								<h3>Spectrum (Linear)</h3>
								<img
									src="data:image/png;base64,{lampInfo.spectrum_linear_plot_base64}"
									alt="Spectral distribution (linear scale)"
									class="plot-image spectrum-plot clickable"
									onclick={() => openImageLightbox('spectrum_linear')}
								/>
							</div>
							<div class="spectrum-section">
								<h3>Spectrum (Log)</h3>
								{#if 'spectrum_log_plot_base64' in lampInfo && lampInfo.spectrum_log_plot_base64}
									<img
										src="data:image/png;base64,{lampInfo.spectrum_log_plot_base64}"
										alt="Spectral distribution (log scale)"
										class="plot-image spectrum-plot clickable"
										onclick={() => openImageLightbox('spectrum_log')}
									/>
								{:else}
									<div class="no-plot">Failed to generate log plot</div>
								{/if}
							</div>
						</div>
					{:else}
						<div class="spectrum-section">
							<div class="spectrum-header">
								<h3>Spectrum</h3>
								<button
									type="button"
									class="scale-toggle"
									onclick={toggleSpectrumScale}
								>
									{spectrumScale === 'linear' ? 'Log' : 'Linear'}
								</button>
							</div>
							{#if lampInfo.spectrum_plot_base64}
								<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
								<img
									src="data:image/png;base64,{lampInfo.spectrum_plot_base64}"
									alt="Spectral distribution plot"
									class="plot-image spectrum-plot clickable"
									onclick={() => openImageLightbox('spectrum')}
								/>
							{:else}
								<div class="no-plot">Failed to generate spectrum plot</div>
							{/if}
						</div>
					{/if}
				{:else if spectrumUploading || spectrumRefreshing}
					<div class="no-spectrum-note">
						<div class="spectrum-loading">
							<div class="spinner small"></div>
							<p><strong>{spectrumUploading ? 'Uploading spectrum data...' : 'Loading spectrum...'}</strong></p>
						</div>
					</div>
				{:else}
					<div class="no-spectrum-note">
						<p><strong>No spectrum data available.</strong></p>
						<p>TLV estimates are based on monochromatic output at the nominal wavelength. Actual TLVs may be more restrictive if the lamp emits at multiple wavelengths.</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Actions Section (only show for preset lamps with downloads available) -->
		{#if canDownload || ('report_url' in lampInfo && lampInfo.report_url)}
			<div class="actions-section">
				{#if canDownload}
					<button type="button" class="secondary" onclick={downloadIes}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
							<polyline points="7 10 12 15 17 10"/>
							<line x1="12" y1="15" x2="12" y2="3"/>
						</svg>
						Download IES
					</button>
					{#if lampInfo.has_spectrum}
						<button type="button" class="secondary" onclick={downloadSpectrum}>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
								<polyline points="7 10 12 15 17 10"/>
								<line x1="12" y1="15" x2="12" y2="3"/>
							</svg>
							Download Spectrum
						</button>
					{/if}
				{/if}
				{#if 'report_url' in lampInfo && lampInfo.report_url}
					<a href={lampInfo.report_url} target="_blank" rel="noopener noreferrer" class="report-link">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
							<polyline points="15 3 21 3 21 9"/>
							<line x1="10" y1="14" x2="21" y2="3"/>
						</svg>
						View Full Report
					</a>
				{/if}
			</div>
		{/if}
	</div>
{/if}

{#if expandedImageType}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="lightbox-backdrop" onclick={handleLightboxClick}>
		{#if expandedImage}
			<img src={expandedImage} alt="Expanded plot" class="lightbox-image" />
		{:else if loadingHiRes}
			<div class="lightbox-loading-container">
				<div class="spinner large"></div>
				<p>Loading hi-res image...</p>
			</div>
		{:else}
			<div class="lightbox-loading-container">
				<p>Failed to load image</p>
			</div>
		{/if}
		<button type="button" class="lightbox-close" onclick={() => { expandedImageType = null; onLightboxChange?.(false); }} title="Close">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M18 6L6 18M6 6l12 12"/>
			</svg>
		</button>
	</div>
{/if}

<style>
	.info-tab-body {
		padding: var(--spacing-md);
	}

	.info-title {
		margin: 0 0 var(--spacing-md) 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.loading-state,
	.error-state {
		padding: var(--spacing-xl);
		text-align: center;
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

	.plot-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-xl) 0;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.plot-loading p {
		margin: 0;
	}

	.spectrum-loading {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		justify-content: center;
		padding: var(--spacing-sm) 0;
	}

	.spectrum-loading p {
		margin: 0;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error-message {
		color: var(--color-error);
		margin-bottom: var(--spacing-md);
	}

	.main-section {
		display: grid;
		grid-template-columns: 400px 1fr;
		grid-template-rows: auto 1fr;
		gap: var(--spacing-md);
		align-items: start;
	}

	.main-section .left-column {
		grid-column: 1;
		grid-row: 1 / -1;
	}

	.main-section .specs-section {
		grid-column: 2;
		grid-row: 1;
	}

	.main-section .spectrum-wrapper {
		grid-column: 2;
		grid-row: 2;
	}

	.main-section.single-column {
		grid-template-columns: 1fr;
	}

	.main-section.single-column .specs-section,
	.main-section.single-column .spectrum-wrapper {
		grid-column: 1;
	}

	@media (max-width: 700px) {
		.main-section {
			grid-template-columns: 1fr;
			grid-template-rows: auto;
		}

		.main-section .specs-section {
			grid-column: 1;
			grid-row: auto;
			order: 1;
		}

		.main-section .left-column {
			grid-column: 1;
			grid-row: auto;
			order: 2;
		}

		.main-section .spectrum-wrapper {
			grid-column: 1;
			grid-row: auto;
			order: 3;
		}
	}

	.left-column {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.left-column .plot-section {
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.left-column .plot-section .plot-image {
		flex: 1;
		object-fit: contain;
	}

	.specs-section {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.spec-block h3 {
		margin: 0 0 var(--spacing-xs) 0;
		font-size: 1rem;
		color: var(--color-text);
		font-weight: 600;
	}

	.power-block h3 {
		margin: 0;
	}

	.power-value {
		font-weight: 600;
		color: var(--color-info);
		margin-left: 1.5em;
	}

	.power-unit {
		font-weight: normal;
	}

	.plot-section {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-xs);
	}

	.plot-section h3 {
		margin: 0 0 var(--spacing-xs) 0;
		font-size: 1rem;
		color: var(--color-text);
		font-weight: 600;
		text-align: center;
	}

	.plot-image {
		width: 100%;
		height: auto;
		border-radius: var(--radius-sm);
	}

	.spectrum-wrapper {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.tlv-table {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}

	.tlv-table th,
	.tlv-table td {
		padding: 2px var(--spacing-xs);
		text-align: center;
	}

	.tlv-table th {
		font-weight: 500;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		text-transform: uppercase;
	}

	.tlv-table td.row-label {
		color: var(--color-text-muted);
		font-family: var(--font-sans);
		font-size: 0.85rem;
	}

	.dual-spectrum {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-sm);
	}

	.dual-spectrum h3 {
		text-align: center;
		margin: 0 0 var(--spacing-xs) 0;
		font-size: 0.9rem;
	}

	@media (max-width: 700px) {
		.dual-spectrum {
			grid-template-columns: 1fr;
		}
	}

	.spectrum-section {
		flex: 1;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-xs) var(--spacing-sm);
		display: flex;
		flex-direction: column;
	}

	.spectrum-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-xs);
	}

	.spectrum-header h3 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-text);
		font-weight: 600;
	}

	.scale-toggle {
		font-size: 0.85rem;
		padding: 4px 10px;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.scale-toggle:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.scale-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spectrum-plot {
		width: 100%;
		max-height: 300px;
		object-fit: contain;
	}

	.no-plot {
		padding: var(--spacing-lg);
		text-align: center;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
	}

	.no-spectrum-note {
		flex: 1;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.no-spectrum-note p {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}

	.no-spectrum-note p:first-child {
		margin-bottom: var(--spacing-sm);
	}

	.no-spectrum-note strong {
		color: var(--color-text);
	}

	.actions-section {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border);
	}

	.actions-section button,
	.actions-section a {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.report-link {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		text-decoration: none;
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
		transition: background 0.2s;
	}

	.report-link:hover {
		background: var(--color-border);
	}

	/* Clickable images */
	.plot-image.clickable {
		cursor: zoom-in;
		transition: opacity 0.15s;
	}

	.plot-image.clickable:hover {
		opacity: 0.9;
	}

	/* Lightbox */
	.lightbox-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.9);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2000;
		padding: var(--spacing-lg);
	}

	.lightbox-image {
		max-width: 90vw;
		max-height: 90vh;
		object-fit: contain;
		border-radius: var(--radius-md);
	}

	.lightbox-close {
		position: absolute;
		top: var(--spacing-md);
		right: var(--spacing-md);
		width: 44px;
		height: 44px;
		padding: 0;
		background: rgba(255, 255, 255, 0.1);
		border: none;
		border-radius: 50%;
		color: white;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
	}

	.lightbox-close:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	.lightbox-loading-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-md);
		color: white;
	}

	.lightbox-loading-container p {
		margin: 0;
		font-size: 1rem;
	}

	.spinner.large {
		width: 48px;
		height: 48px;
		border-width: 4px;
	}
</style>
