<script lang="ts">
	import { getLampInfo, getSessionLampInfo, getLampIesDownloadUrl, getLampSpectrumDownloadUrl } from '$lib/api/client';
	import type { LampInfoResponse, SessionLampInfoResponse } from '$lib/api/client';
	import { theme } from '$lib/stores/theme';
	import type { LampType } from '$lib/types/project';

	interface Props {
		presetId?: string;  // For preset lamps
		lampId?: string;    // For session lamps (custom IES)
		lampName: string;
		hasPhotometry?: boolean;
		lampType?: LampType;
		onClose: () => void;
	}

	let { presetId, lampId, lampName, hasPhotometry = true, lampType = 'krcl_222', onClose }: Props = $props();

	// Determine if this is a session lamp (custom IES) or preset lamp
	const isSessionLamp = !presetId && !!lampId;

	// State - use a union type for both response types
	let loading = $state(true);
	let error = $state<string | null>(null);
	let lampInfo = $state<LampInfoResponse | SessionLampInfoResponse | null>(null);
	let spectrumScale = $state<'linear' | 'log'>('linear');
	let loadingSpectrum = $state(false);
	let spectrumError = $state<string | null>(null);
	let lastFetchedTheme = $state<string | null>(null);
	let expandedImageType = $state<'photometric' | 'spectrum' | null>(null);

	// Hi-res image prefetching
	let hiResPhotometric = $state<string | null>(null);
	let hiResSpectrum = $state<string | null>(null);
	let loadingHiRes = $state(false);

	// Retry logic for race conditions with lamp sync
	let retryCount = 0;
	const MAX_RETRIES = 3;
	const RETRY_DELAY_MS = 500;

	// Fetch lamp info on mount and when theme changes
	$effect(() => {
		const currentTheme = $theme;
		if (currentTheme !== lastFetchedTheme) {
			lastFetchedTheme = currentTheme;
			// Reset hi-res cache when theme changes
			hiResPhotometric = null;
			hiResSpectrum = null;
			fetchLampInfo();
		}
	});

	// Prefetch hi-res images once lampInfo is loaded
	$effect(() => {
		if (lampInfo && !hiResPhotometric && !loadingHiRes) {
			prefetchHiResImages();
		}
	});

	async function fetchLampInfo() {
		loading = true;
		error = null;
		try {
			if (isSessionLamp && lampId) {
				lampInfo = await getSessionLampInfo(lampId, spectrumScale, $theme);
			} else if (presetId) {
				lampInfo = await getLampInfo(presetId, spectrumScale, $theme);
			} else {
				throw new Error('No lamp identifier provided');
			}
			// Reset retry count on success
			retryCount = 0;
			loading = false;
		} catch (e) {
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

	async function prefetchHiResImages() {
		loadingHiRes = true;
		try {
			let hiRes: LampInfoResponse | SessionLampInfoResponse;
			if (isSessionLamp && lampId) {
				hiRes = await getSessionLampInfo(lampId, spectrumScale, $theme, 300);
			} else if (presetId) {
				hiRes = await getLampInfo(presetId, spectrumScale, $theme, 300);
			} else {
				return;
			}
			if (hiRes.photometric_plot_base64) {
				hiResPhotometric = `data:image/png;base64,${hiRes.photometric_plot_base64}`;
			}
			if (hiRes.spectrum_plot_base64) {
				hiResSpectrum = `data:image/png;base64,${hiRes.spectrum_plot_base64}`;
			}
		} catch (e) {
			console.error('Failed to prefetch hi-res images:', e);
		} finally {
			loadingHiRes = false;
		}
	}

	async function toggleSpectrumScale() {
		if (!lampInfo?.has_spectrum || loadingSpectrum) return;

		const newScale = spectrumScale === 'linear' ? 'log' : 'linear';
		loadingSpectrum = true;
		spectrumError = null;
		// Clear cached hi-res spectrum since scale is changing
		hiResSpectrum = null;

		try {
			let updated: LampInfoResponse | SessionLampInfoResponse;
			let hiRes: LampInfoResponse | SessionLampInfoResponse;
			if (isSessionLamp && lampId) {
				updated = await getSessionLampInfo(lampId, newScale, $theme);
				hiRes = await getSessionLampInfo(lampId, newScale, $theme, 300);
			} else if (presetId) {
				updated = await getLampInfo(presetId, newScale, $theme);
				hiRes = await getLampInfo(presetId, newScale, $theme, 300);
			} else {
				return;
			}
			lampInfo = updated;
			spectrumScale = newScale;
			if (hiRes.spectrum_plot_base64) {
				hiResSpectrum = `data:image/png;base64,${hiRes.spectrum_plot_base64}`;
			}
		} catch (e) {
			console.error('Failed to update spectrum scale:', e);
			spectrumError = 'Failed to update scale';
		} finally {
			loadingSpectrum = false;
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (expandedImageType) {
				expandedImageType = null;
			} else {
				onClose();
			}
		}
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
	}

	// Derive the current expanded image based on type and hi-res availability
	let expandedImage = $derived.by(() => {
		if (!expandedImageType) return null;
		if (expandedImageType === 'photometric') {
			return hiResPhotometric;
		} else if (expandedImageType === 'spectrum') {
			return hiResSpectrum;
		}
		return null;
	});

	function closeLightbox(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			expandedImageType = null;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="modal-title">
		<div class="modal-header">
			<h2 id="modal-title">{lampName}{lampInfo?.name ? ` (${lampInfo.name})` : ''}</h2>
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
						Select a lamp preset or upload an IES file to view lamp information.
					{:else}
						Upload an IES file to view lamp information.
					{/if}
				</p>
			</div>
		{:else if loading}
			<div class="loading-state">
				<div class="spinner"></div>
				<p>Loading lamp information...</p>
			</div>
		{:else if error}
			<div class="error-state">
				<p class="error-message">{error}</p>
				<button type="button" onclick={fetchLampInfo}>Retry</button>
			</div>
		{:else if lampInfo}
			<div class="modal-body">
				<div class="main-section">
					<!-- Left column: Photometric -->
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
							{:else}
								<div class="no-plot">No photometric data available</div>
							{/if}
						</div>
					</div>

					<!-- Right column: Power + TLV table + Spectrum -->
					<div class="right-column">
						<!-- Combined Power + TLV Section -->
						<div class="specs-section">
							<div class="spec-block power-block">
								<h3>Total Optical Output: <span class="power-value">{lampInfo.total_power_mw.toFixed(1)}</span> <span class="power-unit">mW</span></h3>
							</div>

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
											<td>{lampInfo.tlv_acgih.skin.toFixed(1)}</td>
											<td>{lampInfo.tlv_icnirp.skin.toFixed(1)}</td>
										</tr>
										<tr>
											<td class="row-label">Eye</td>
											<td>{lampInfo.tlv_acgih.eye.toFixed(1)}</td>
											<td>{lampInfo.tlv_icnirp.eye.toFixed(1)}</td>
										</tr>
									</tbody>
								</table>
							</div>
						</div>

						<!-- Spectrum Section -->
						{#if lampInfo.has_spectrum}
							<div class="spectrum-section">
								<div class="spectrum-header">
									<h3>Spectrum</h3>
									<div class="spectrum-controls">
										<button
											type="button"
											class="scale-toggle"
											onclick={toggleSpectrumScale}
											disabled={loadingSpectrum}
										>
											{loadingSpectrum ? '...' : spectrumScale === 'linear' ? 'Log' : 'Linear'}
										</button>
										{#if spectrumError}
											<span class="inline-error">{spectrumError}</span>
										{/if}
									</div>
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
	</div>
</div>

{#if expandedImageType}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="lightbox-backdrop" onclick={closeLightbox}>
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
		<button type="button" class="lightbox-close" onclick={() => { expandedImageType = null; }} title="Close">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M18 6L6 18M6 6l12 12"/>
			</svg>
		</button>
	</div>
{/if}

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
		width: 90%;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.25rem;
		word-wrap: break-word;
		overflow-wrap: break-word;
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

	.main-section {
		display: grid;
		grid-template-columns: 380px 1fr;
		gap: var(--spacing-md);
		align-items: stretch;
	}

	@media (max-width: 700px) {
		.main-section {
			grid-template-columns: 1fr;
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
		color: var(--color-text);
		margin-left: 1.5em;
	}

	.power-unit {
		font-weight: normal;
	}

	.plot-section {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-xs) var(--spacing-sm);
	}

	.plot-section h3 {
		margin: 0 0 var(--spacing-sm) 0;
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

	.right-column {
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

	.spectrum-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.inline-error {
		font-size: 0.75rem;
		color: var(--color-error, #dc3545);
	}

	.spectrum-plot {
		width: 100%;
		max-height: 320px;
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
