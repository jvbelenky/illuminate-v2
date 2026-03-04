<script lang="ts">
	import Modal from './Modal.svelte';
	import SpectrumChart from './SpectrumChart.svelte';
	import { parseSpectrumFile, type ParsedSpectrumSeries } from '$lib/api/client';

	interface Props {
		show: boolean;
		onClose: () => void;
	}

	let { show, onClose }: Props = $props();

	let fileName: string | null = $state(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let wavelengths: number[] = $state([]);
	let series: ParsedSpectrumSeries[] = $state([]);
	let wavelengthRange: [number, number] | null = $state(null);
	let visible: boolean[] = $state([]);
	let labels: string[] = $state([]);
	let yscale: 'linear' | 'log' = $state('linear');
	let normalized = $state(false);
	let editingIndex: number | null = $state(null);
	let editingValue = $state('');
	let fileInput: HTMLInputElement;
	let chartComponent: SpectrumChart;

	const chartSeries = $derived(
		series.map((s, i) => {
			let intensities = s.intensities;
			if (normalized) {
				const max = Math.max(...intensities);
				if (max > 0) {
					intensities = intensities.map(v => v / max);
				}
			}
			return {
				label: labels[i] ?? s.label,
				intensities,
				visible: visible[i] ?? true,
			};
		})
	);

	async function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || !input.files[0]) return;
		const file = input.files[0];
		fileName = file.name;
		loading = true;
		error = null;

		try {
			const result = await parseSpectrumFile(file);
			wavelengths = result.wavelengths;
			series = result.series;
			wavelengthRange = result.wavelength_range;
			visible = result.series.map(() => true);
			labels = result.series.map(s => s.label);
		} catch (e: any) {
			error = e.message || 'Failed to parse spectrum file';
			wavelengths = [];
			series = [];
		} finally {
			loading = false;
		}
	}

	function toggleSeries(index: number) {
		visible = visible.map((v, i) => i === index ? !v : v);
	}

	function startEditing(index: number) {
		editingIndex = index;
		editingValue = labels[index];
	}

	function finishEditing() {
		if (editingIndex !== null && editingValue.trim()) {
			labels = labels.map((l, i) => i === editingIndex ? editingValue.trim() : l);
		}
		editingIndex = null;
	}

	function handleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			finishEditing();
		} else if (e.key === 'Escape') {
			editingIndex = null;
		}
	}

	function clearFile() {
		fileName = null;
		error = null;
		wavelengths = [];
		series = [];
		wavelengthRange = null;
		visible = [];
		labels = [];
		normalized = false;
		yscale = 'linear';
		if (fileInput) fileInput.value = '';
	}

	function formatTlv(value: number | null): string {
		return value != null ? value.toFixed(1) : 'N/A';
	}

	const COLORS = [
		'#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899',
		'#06b6d4', '#f97316', '#14b8a6', '#a855f7', '#64748b', '#84cc16',
	];
</script>

{#if show}
<Modal title="Spectrum Viewer" {onClose} width="700px" maxWidth="90vw">
	{#snippet body()}
		<div class="viewer-body">
			<div class="file-row">
				<input
					type="file"
					accept=".csv,.xls,.xlsx"
					bind:this={fileInput}
					onchange={handleFileChange}
					style="display: none"
				/>
				<button type="button" class="select-file-btn" onclick={() => fileInput.click()}>
					Select File
				</button>
				{#if fileName}
					<span class="file-name">{fileName}</span>
					<button type="button" class="clear-file-btn" onclick={clearFile} title="Unload file">&times;</button>
				{/if}
				{#if loading}
					<span class="loading-text">Parsing...</span>
				{/if}
			</div>

			{#if error}
				<div class="error-msg">{error}</div>
			{/if}

			<SpectrumChart
				bind:this={chartComponent}
				{wavelengths}
				series={chartSeries}
				{yscale}
				height="320px"
				interactive={true}
			/>

			<div class="controls-row">
				<div class="scale-toggle">
					<button
						type="button"
						class:active={yscale === 'linear'}
						onclick={() => yscale = 'linear'}
					>Linear</button>
					<button
						type="button"
						class:active={yscale === 'log'}
						onclick={() => yscale = 'log'}
					>Log</button>
				</div>
				<label class="normalize-toggle">
					<input type="checkbox" bind:checked={normalized} />
					Normalize
				</label>
				<button type="button" class="reset-zoom-btn" onclick={() => chartComponent?.resetZoom()}>
					Reset Zoom
				</button>
			</div>

			<div class="series-table-wrap">
				<table class="series-table">
					<thead>
						<tr>
							<th class="col-vis"></th>
							<th class="col-label">Series</th>
							<th class="col-peak" title="Peak emission wavelength (nm)">Peak</th>
							<th class="col-tlv" title="ACGIH skin TLV (mJ/cm² per 8h)">ACGIH Skin</th>
							<th class="col-tlv" title="ACGIH eye TLV (mJ/cm² per 8h)">ACGIH Eye</th>
							<th class="col-tlv" title="ICNIRP TLV (mJ/cm² per 8h)">ICNIRP</th>
						</tr>
					</thead>
					<tbody>
						{#each series as s, i}
							<tr>
								<td class="col-vis">
									<label class="series-toggle">
										<input
											type="checkbox"
											checked={visible[i]}
											onchange={() => toggleSeries(i)}
										/>
										<span class="color-dot" style="background: {COLORS[i % COLORS.length]}"></span>
									</label>
								</td>
								<td class="col-label">
									{#if editingIndex === i}
										<input
											type="text"
											class="label-edit"
											bind:value={editingValue}
											onblur={finishEditing}
											onkeydown={handleEditKeydown}
										/>
									{:else}
										<span class="series-label">{labels[i]}</span>
										<button type="button" class="edit-btn" onclick={() => startEditing(i)} title="Rename">
											&#x270E;
										</button>
									{/if}
								</td>
								<td class="col-peak">{s.peak_wavelength} nm</td>
								<td class="col-tlv">{formatTlv(s.acgih_skin)}</td>
								<td class="col-tlv">{formatTlv(s.acgih_eye)}</td>
								<td class="col-tlv">{formatTlv(s.icnirp)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if wavelengthRange}
				<div class="metadata">
					Range: {wavelengthRange[0]}&ndash;{wavelengthRange[1]} nm
					&middot; {series.length} series
				</div>
			{/if}
		</div>
	{/snippet}
</Modal>
{/if}

<style>
	.viewer-body {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.file-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.select-file-btn {
		padding: var(--spacing-sm) var(--spacing-lg);
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--font-size-base);
		transition: background 0.15s ease;
	}

	.select-file-btn:hover {
		background: var(--color-border);
	}

	.clear-file-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 1.1rem;
		line-height: 1;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		transition: color 0.15s ease, background 0.15s ease;
	}

	.clear-file-btn:hover {
		color: var(--color-danger);
		background: rgba(239, 68, 68, 0.1);
	}

	.file-name {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.loading-text {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-style: italic;
	}

	.error-msg {
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: rgba(239, 68, 68, 0.1);
		border-radius: var(--radius-sm);
	}

	.controls-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
	}

	.scale-toggle {
		display: flex;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.scale-toggle button {
		padding: var(--spacing-xs) var(--spacing-sm);
		border: none;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}

	.scale-toggle button.active {
		background: var(--color-primary);
		color: white;
	}

	.normalize-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.reset-zoom-btn {
		padding: var(--spacing-xs) var(--spacing-sm);
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}

	.reset-zoom-btn:hover {
		background: var(--color-bg-tertiary);
	}

	.series-table-wrap {
		overflow-x: auto;
	}

	.series-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sm);
	}

	.series-table th {
		text-align: left;
		padding: var(--spacing-xs) var(--spacing-sm);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}

	.series-table td {
		padding: var(--spacing-xs) var(--spacing-sm);
		vertical-align: middle;
	}

	.series-table tbody tr:hover {
		background: var(--color-bg-secondary);
	}

	.col-vis {
		width: 40px;
	}

	.col-label {
		min-width: 100px;
	}

	.col-peak, .col-tlv {
		white-space: nowrap;
		text-align: center;
	}

	.col-tlv {
		font-variant-numeric: tabular-nums;
	}

	.series-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
	}

	.color-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.series-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text);
	}

	.label-edit {
		width: 100%;
		padding: 1px 4px;
		font-size: var(--font-size-sm);
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		outline: none;
	}

	.edit-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-text-muted);
		padding: 0 2px;
		font-size: 0.8rem;
		flex-shrink: 0;
	}

	.edit-btn:hover {
		color: var(--color-text);
	}

	.metadata {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		padding-top: var(--spacing-xs);
		border-top: 1px solid var(--color-border);
	}
</style>
