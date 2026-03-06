<script lang="ts">
	import { zones, results, project } from '$lib/stores/project';
	import { getSessionExportZip, getSessionReport, getSessionZoneExport } from '$lib/api/client';
	import Modal from './Modal.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let includePlots = $state(false);
	let includeReport = $state(false);
	let exportingZip = $state(false);
	let exportingReport = $state(false);
	let exportingZoneId = $state<string | null>(null);
	let errorMessage = $state<string | null>(null);

	const hasResults = $derived(
		$results?.zones != null && Object.keys($results.zones).length > 0
	);

	const zoneList = $derived(
		$zones.map((z) => ({
			id: z.id,
			name: z.name || z.id,
			hasResults: $results?.zones?.[z.id]?.statistics != null
		}))
	);

	function downloadBlob(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleExportZip() {
		exportingZip = true;
		errorMessage = null;
		try {
			const blob = await getSessionExportZip({
				include_plots: includePlots,
				include_report: includeReport,
			});
			downloadBlob(blob, 'illuminate.zip');
		} catch (error) {
			console.error('Failed to export ZIP:', error);
			errorMessage = 'Failed to export ZIP. Please try again.';
		} finally {
			exportingZip = false;
		}
	}

	async function handleExportReport() {
		exportingReport = true;
		errorMessage = null;
		try {
			const blob = await getSessionReport();
			const name = $project.name.replace(/[^a-zA-Z0-9_-]/g, '_');
			downloadBlob(blob, `${name}_report.csv`);
		} catch (error) {
			console.error('Failed to export report:', error);
			errorMessage = 'Failed to export report. Please try again.';
		} finally {
			exportingReport = false;
		}
	}

	async function handleExportZone(zoneId: string, zoneName: string) {
		exportingZoneId = zoneId;
		errorMessage = null;
		try {
			const blob = await getSessionZoneExport(zoneId);
			downloadBlob(blob, `${zoneName}.csv`);
		} catch (error) {
			console.error('Failed to export zone:', error);
			errorMessage = 'Failed to export zone. Please try again.';
		} finally {
			exportingZoneId = null;
		}
	}
</script>

<Modal title="Export" {onClose} maxWidth="480px">
	{#snippet body()}
		<div class="export-body">
			{#if errorMessage}
				<div class="error-message">{errorMessage}</div>
			{/if}

			{#if !hasResults}
				<div class="no-results-hint">Run calculations first to enable export options.</div>
			{/if}

			<section class="export-section">
				<h4>Full Export</h4>
				<div class="section-content">
					<div class="export-options">
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={includePlots} disabled={!hasResults} />
							<span>Include plots</span>
						</label>
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={includeReport} disabled={!hasResults} />
							<span>Include report</span>
						</label>
					</div>
					<button
						class="export-btn primary"
						onclick={handleExportZip}
						disabled={!hasResults || exportingZip}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="7 10 12 15 17 10" />
							<line x1="12" y1="15" x2="12" y2="3" />
						</svg>
						{exportingZip ? 'Exporting...' : 'Download ZIP'}
					</button>
				</div>
			</section>

			<section class="export-section">
				<h4>Report Only</h4>
				<div class="section-content">
					<button
						class="export-btn"
						onclick={handleExportReport}
						disabled={!hasResults || exportingReport}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
							<polyline points="14 2 14 8 20 8" />
						</svg>
						{exportingReport ? 'Exporting...' : 'Download Report (CSV)'}
					</button>
				</div>
			</section>

			{#if zoneList.length > 0}
				<section class="export-section">
					<h4>Individual Zones</h4>
					<div class="section-content">
						<div class="zone-list">
							{#each zoneList as zone}
								<button
									class="zone-btn"
									onclick={() => handleExportZone(zone.id, zone.name)}
									disabled={!zone.hasResults || exportingZoneId === zone.id}
								>
									<span class="zone-name">{zone.name}</span>
									<span class="zone-action">
										{#if exportingZoneId === zone.id}
											Exporting...
										{:else}
											CSV
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
												<polyline points="7 10 12 15 17 10" />
												<line x1="12" y1="15" x2="12" y2="3" />
											</svg>
										{/if}
									</span>
								</button>
							{/each}
						</div>
					</div>
				</section>
			{/if}
		</div>
	{/snippet}
</Modal>

<style>
	.export-body {
		padding: var(--spacing-lg);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.error-message {
		color: var(--color-error, #dc3545);
		font-size: var(--font-size-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: color-mix(in srgb, var(--color-error, #dc3545) 10%, var(--color-bg));
		border: 1px solid color-mix(in srgb, var(--color-error, #dc3545) 25%, transparent);
		border-radius: var(--radius-md);
	}

	.no-results-hint {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-style: italic;
		text-align: center;
		padding: var(--spacing-xs) 0;
	}

	.export-section h4 {
		margin: 0 0 var(--spacing-xs) 0;
		font-size: var(--font-size-xs);
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
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.export-options {
		display: flex;
		gap: var(--spacing-md);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		cursor: pointer;
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
	}

	.export-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-xs);
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.export-btn:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		border-color: var(--color-text-muted);
	}

	.export-btn.primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: white;
	}

	.export-btn.primary:hover:not(:disabled) {
		background: var(--color-accent-hover);
		border-color: var(--color-accent-hover);
	}

	.export-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.zone-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.zone-btn {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.zone-btn:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		border-color: var(--color-text-muted);
	}

	.zone-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.zone-name {
		font-weight: 500;
	}

	.zone-action {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.zone-btn:hover:not(:disabled) .zone-action {
		color: var(--color-text);
	}
</style>
