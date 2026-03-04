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
				include_report: includeReport
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

			<section class="export-section">
				<h3>Export All (ZIP)</h3>
				<label class="checkbox-row">
					<input type="checkbox" bind:checked={includePlots} disabled={!hasResults} />
					<span>Include plots</span>
				</label>
				<label class="checkbox-row">
					<input type="checkbox" bind:checked={includeReport} disabled={!hasResults} />
					<span>Include report</span>
				</label>
				<button
					class="export-btn"
					onclick={handleExportZip}
					disabled={!hasResults || exportingZip}
				>
					{exportingZip ? 'Exporting...' : 'Export ZIP'}
				</button>
			</section>

			<hr class="section-divider" />

			<section class="export-section">
				<h3>Export Report Only</h3>
				<button
					class="export-btn"
					onclick={handleExportReport}
					disabled={!hasResults || exportingReport}
				>
					{exportingReport ? 'Exporting...' : 'Export Report (CSV)'}
				</button>
			</section>

			{#if zoneList.length > 0}
				<hr class="section-divider" />

				<section class="export-section">
					<h3>Export Individual Zones</h3>
					{#each zoneList as zone}
						<button
							class="export-btn zone-btn"
							onclick={() => handleExportZone(zone.id, zone.name)}
							disabled={!zone.hasResults || exportingZoneId === zone.id}
						>
							{exportingZoneId === zone.id ? 'Exporting...' : `${zone.name} — Export CSV`}
						</button>
					{/each}
				</section>
			{/if}
		</div>
	{/snippet}
</Modal>

<style>
	.export-body {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.error-message {
		color: var(--color-error, #dc3545);
		font-size: 0.85rem;
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-secondary, #fff3f3);
		border-radius: var(--radius-sm);
	}

	.export-section h3 {
		margin: 0 0 var(--spacing-xs) 0;
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 0.85rem;
		color: var(--color-text);
		cursor: pointer;
		padding: 2px 0;
	}

	.checkbox-row input[type="checkbox"] {
		margin: 0;
	}

	.section-divider {
		border: none;
		border-top: 1px solid var(--color-border);
		margin: var(--spacing-xs) 0;
	}

	.export-btn {
		display: block;
		width: 100%;
		padding: var(--spacing-xs) var(--spacing-sm);
		margin-top: var(--spacing-xs);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-size: 0.85rem;
		cursor: pointer;
		text-align: left;
		transition: background 0.15s;
	}

	.export-btn:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
	}

	.export-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
