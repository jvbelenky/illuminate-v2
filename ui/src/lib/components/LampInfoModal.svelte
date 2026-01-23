<script lang="ts">
	import { onMount } from 'svelte';
	import { getLampInfo, getLampIesDownloadUrl, getLampSpectrumDownloadUrl } from '$lib/api/client';
	import type { LampInfoResponse } from '$lib/api/client';

	interface Props {
		presetId: string;
		lampName: string;
		standard: string;
		onClose: () => void;
	}

	let { presetId, lampName, standard, onClose }: Props = $props();

	// State
	let loading = $state(true);
	let error = $state<string | null>(null);
	let lampInfo = $state<LampInfoResponse | null>(null);
	let spectrumScale = $state<'linear' | 'log'>('linear');
	let loadingSpectrum = $state(false);

	// Fetch lamp info on mount
	onMount(() => {
		fetchLampInfo();
	});

	async function fetchLampInfo() {
		loading = true;
		error = null;
		try {
			lampInfo = await getLampInfo(presetId, standard, spectrumScale);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load lamp info';
		} finally {
			loading = false;
		}
	}

	async function toggleSpectrumScale() {
		if (!lampInfo?.has_spectrum || loadingSpectrum) return;

		const newScale = spectrumScale === 'linear' ? 'log' : 'linear';
		loadingSpectrum = true;

		try {
			const updated = await getLampInfo(presetId, standard, newScale);
			lampInfo = updated;
			spectrumScale = newScale;
		} catch (e) {
			console.error('Failed to update spectrum scale:', e);
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
			onClose();
		}
	}

	function downloadIes() {
		window.open(getLampIesDownloadUrl(presetId), '_blank');
	}

	function downloadSpectrum() {
		window.open(getLampSpectrumDownloadUrl(presetId), '_blank');
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="modal-title">
		<div class="modal-header">
			<h2 id="modal-title">{lampName}</h2>
			<button type="button" class="close-btn" onclick={onClose} title="Close">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		{#if loading}
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
				<div class="top-section">
					<!-- Photometric Plot -->
					<div class="plot-section">
						<h3>Photometric Distribution</h3>
						{#if lampInfo.photometric_plot_base64}
							<img
								src="data:image/png;base64,{lampInfo.photometric_plot_base64}"
								alt="Photometric distribution polar plot"
								class="plot-image"
							/>
						{:else}
							<div class="no-plot">No photometric data available</div>
						{/if}
					</div>

					<!-- Info Section -->
					<div class="info-section">
						<h3>Optical Properties</h3>
						<div class="info-grid">
							<div class="info-item">
								<span class="info-label">Total Optical Output</span>
								<span class="info-value highlight">{lampInfo.total_power_mw.toFixed(1)} mW</span>
							</div>
							<div class="info-item">
								<span class="info-label">Max 8h Skin Dose ({standard})</span>
								<span class="info-value">{lampInfo.max_skin_dose_8h.toFixed(1)} mJ/cm&sup2;</span>
							</div>
							<div class="info-item">
								<span class="info-label">Max 8h Eye Dose ({standard})</span>
								<span class="info-value">{lampInfo.max_eye_dose_8h.toFixed(1)} mJ/cm&sup2;</span>
							</div>
						</div>
					</div>
				</div>

				<!-- Spectrum Section -->
				{#if lampInfo.has_spectrum}
					<div class="spectrum-section">
						<div class="spectrum-header">
							<h3>Spectrum</h3>
							<button
								type="button"
								class="secondary scale-toggle"
								onclick={toggleSpectrumScale}
								disabled={loadingSpectrum}
							>
								{loadingSpectrum ? 'Loading...' : spectrumScale === 'linear' ? 'Switch to Log' : 'Switch to Linear'}
							</button>
						</div>
						{#if lampInfo.spectrum_plot_base64}
							<img
								src="data:image/png;base64,{lampInfo.spectrum_plot_base64}"
								alt="Spectral distribution plot"
								class="plot-image spectrum-plot"
							/>
						{:else}
							<div class="no-plot">Failed to generate spectrum plot</div>
						{/if}
					</div>
				{/if}

				<!-- Actions Section -->
				<div class="actions-section">
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
					{#if lampInfo.report_url}
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
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-md);
	}

	.modal-content {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		max-width: 900px;
		width: 90%;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-md) var(--spacing-lg);
		border-bottom: 1px solid var(--color-border);
		position: sticky;
		top: 0;
		background: var(--color-bg-secondary);
		z-index: 1;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.25rem;
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
		padding: var(--spacing-lg);
	}

	.loading-state,
	.error-state {
		padding: var(--spacing-xl);
		text-align: center;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin: 0 auto var(--spacing-md);
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error-message {
		color: #dc2626;
		margin-bottom: var(--spacing-md);
	}

	.top-section {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-lg);
		margin-bottom: var(--spacing-lg);
	}

	@media (max-width: 700px) {
		.top-section {
			grid-template-columns: 1fr;
		}
	}

	.plot-section,
	.info-section,
	.spectrum-section {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.plot-section h3,
	.info-section h3,
	.spectrum-header h3 {
		margin: 0 0 var(--spacing-md) 0;
		font-size: 1rem;
		color: var(--color-text-muted);
	}

	.plot-image {
		width: 100%;
		height: auto;
		border-radius: var(--radius-sm);
	}

	.spectrum-plot {
		max-height: 300px;
		object-fit: contain;
	}

	.no-plot {
		padding: var(--spacing-xl);
		text-align: center;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
	}

	.info-grid {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.info-item {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.info-label {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.info-value {
		font-size: 1.125rem;
		font-family: var(--font-mono);
	}

	.info-value.highlight {
		font-size: 1.5rem;
		color: var(--color-accent);
	}

	.spectrum-section {
		margin-bottom: var(--spacing-lg);
	}

	.spectrum-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-md);
	}

	.spectrum-header h3 {
		margin: 0;
	}

	.scale-toggle {
		font-size: 0.75rem;
		padding: var(--spacing-xs) var(--spacing-sm);
	}

	.actions-section {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
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
</style>
