<script lang="ts">
	import Modal from './Modal.svelte';
	import SpectrumChart from './SpectrumChart.svelte';
	import { parseSpectrumFile, type ParsedSpectrumSeries } from '$lib/api/client';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let fileName: string | null = $state(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let wavelengths: number[] = $state([]);
	let series: ParsedSpectrumSeries[] = $state([]);
	let wavelengthRange: [number, number] | null = $state(null);
	let visible: boolean[] = $state([]);
	let labels: string[] = $state([]);
	let yscale: 'linear' | 'log' = $state('linear');
	let editingIndex: number | null = $state(null);
	let editingValue = $state('');
	let fileInput: HTMLInputElement;
	let chartComponent: SpectrumChart;

	const chartSeries = $derived(
		series.map((s, i) => ({
			label: labels[i] ?? s.label,
			intensities: s.intensities,
			visible: visible[i] ?? true,
		}))
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

	const COLORS = [
		'#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899',
		'#06b6d4', '#f97316', '#14b8a6', '#a855f7', '#64748b', '#84cc16',
	];
</script>

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
				{/if}
				{#if loading}
					<span class="loading-text">Parsing...</span>
				{/if}
			</div>

			{#if error}
				<div class="error-msg">{error}</div>
			{/if}

			{#if series.length > 0}
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
					<button type="button" class="reset-zoom-btn" onclick={() => chartComponent?.resetZoom()}>
						Reset Zoom
					</button>
				</div>

				<div class="series-list">
					<h4>Series</h4>
					{#each series as s, i}
						<div class="series-item">
							<label class="series-toggle">
								<input
									type="checkbox"
									checked={visible[i]}
									onchange={() => toggleSeries(i)}
								/>
								<span class="color-dot" style="background: {COLORS[i % COLORS.length]}"></span>
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
								{/if}
							</label>
							{#if editingIndex !== i}
								<button type="button" class="edit-btn" onclick={() => startEditing(i)} title="Rename">
									&#x270E;
								</button>
							{/if}
							<span class="peak-info">peak: {s.peak_wavelength}nm</span>
						</div>
					{/each}
				</div>

				{#if wavelengthRange}
					<div class="metadata">
						Range: {wavelengthRange[0]}&ndash;{wavelengthRange[1]} nm
						&middot; {series.length} series
					</div>
				{/if}
			{/if}
		</div>
	{/snippet}
</Modal>

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
		padding: var(--spacing-xs) var(--spacing-md);
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}

	.select-file-btn:hover {
		opacity: 0.9;
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

	.series-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.series-list h4 {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.series-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
	}

	.series-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		flex: 1;
		min-width: 0;
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
		flex: 1;
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

	.peak-info {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	.metadata {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		padding-top: var(--spacing-xs);
		border-top: 1px solid var(--color-border);
	}
</style>
