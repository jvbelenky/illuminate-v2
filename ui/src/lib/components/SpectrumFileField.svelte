<script lang="ts">
	import { parseSpectrumFile, type ParsedSpectrumFile } from '$lib/api/client';
	import SpectrumChart from './SpectrumChart.svelte';
	import Modal from './Modal.svelte';

	export interface SpectrumFileFieldValue {
		file: File;
		columnIndex?: number;
	}

	interface Props {
		/** The currently selected file (and, for multi-column files, which column to use). Bindable. */
		value: SpectrumFileFieldValue | null;
		/** Filename of a previously-uploaded spectrum, shown until the user picks a new file. */
		currentFilename?: string;
		/** Controls the trailing hint: "(recommended)" when true, "(optional)" otherwise. */
		recommended?: boolean;
		onerror?: (msg: string) => void;
	}

	let { value = $bindable(null), currentFilename, recommended = false, onerror }: Props = $props();

	let fileInput: HTMLInputElement;
	let parsing = $state(false);
	/** True once the user has explicitly cleared a shown file, so currentFilename stops reappearing. */
	let cleared = $state(false);

	let showColumnPicker = $state(false);
	let parsedSpectrum: ParsedSpectrumFile | null = $state(null);
	let selectedColumnIndex = $state(0);
	let pendingFile: File | null = $state(null);

	let displayName = $derived(value ? value.file.name : (cleared ? null : (currentFilename ?? null)));

	async function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || !input.files[0]) return;
		const file = input.files[0];

		parsing = true;
		try {
			const result = await parseSpectrumFile(file);
			if (result.num_series > 1) {
				// Multi-column: defer setting value until the user picks a column.
				parsedSpectrum = result;
				pendingFile = file;
				selectedColumnIndex = 0;
				showColumnPicker = true;
			} else {
				value = { file };
				cleared = false;
			}
		} catch (err: any) {
			onerror?.(err?.message || 'Failed to parse spectrum file');
		} finally {
			parsing = false;
			// Reset so re-selecting the same filename still fires a change event.
			input.value = '';
		}
	}

	function confirmColumnSelection() {
		if (pendingFile) {
			value = { file: pendingFile, columnIndex: selectedColumnIndex };
			cleared = false;
		}
		showColumnPicker = false;
		parsedSpectrum = null;
		pendingFile = null;
	}

	function cancelColumnSelection() {
		showColumnPicker = false;
		parsedSpectrum = null;
		pendingFile = null;
	}

	function handleClear() {
		value = null;
		cleared = true;
	}
</script>

<div class="spectrum-file-field">
	<div class="form-group">
		<label>
			Spectrum File
			<span class="hint">{recommended ? '(recommended)' : '(optional)'}</span>
		</label>
		{#if parsing}
			<div class="file-status pending">Parsing spectrum file...</div>
		{:else if displayName}
			<div class="file-status success">
				{displayName}
				<span class="file-status-actions">
					<button type="button" class="file-icon-btn" onclick={() => fileInput.click()} title="Replace spectrum file">&#x21c6;</button>
					<button type="button" class="file-icon-btn danger" onclick={handleClear} title="Remove spectrum file">&times;</button>
				</span>
			</div>
		{:else}
			<button type="button" class="secondary" onclick={() => fileInput.click()}>
				Select Spectrum File
			</button>
		{/if}
		<input
			type="file"
			accept=".csv,.xls,.xlsx"
			bind:this={fileInput}
			onchange={handleFileChange}
			style="display: none"
		/>
	</div>
</div>

{#if showColumnPicker && parsedSpectrum}
	<Modal title="Select Spectrum Column" onClose={cancelColumnSelection} width="600px" maxWidth="90vw" zIndex={1100}>
		{#snippet body()}
			{@const ps = parsedSpectrum!}
			<div class="column-picker-body">
				<p class="column-picker-info">
					This file contains {ps.num_series} data columns. Select which one to use as the lamp spectrum.
				</p>

				<div class="column-picker-chart">
					<SpectrumChart
						wavelengths={ps.wavelengths}
						series={ps.series.map((s, i) => ({
							label: s.label,
							intensities: s.intensities,
							color: i === selectedColumnIndex ? '#3b82f6' : '#4b5563',
							visible: true,
						}))}
						height="200px"
						interactive={false}
					/>
				</div>

				<div class="column-picker-list">
					{#each ps.series as s, i}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div
							class="column-option"
							class:selected={selectedColumnIndex === i}
							onclick={() => selectedColumnIndex = i}
						>
							<input
								type="radio"
								name="spectrum-column"
								value={i}
								checked={selectedColumnIndex === i}
								onchange={() => selectedColumnIndex = i}
							/>
							<span class="column-option-text">{s.label}</span>
							<span class="column-peak">{s.peak_wavelength}nm</span>
						</div>
					{/each}
				</div>

				<div class="column-picker-actions">
					<button type="button" class="secondary" onclick={cancelColumnSelection}>Cancel</button>
					<button type="button" class="primary" onclick={confirmColumnSelection}>Use Selected</button>
				</div>
			</div>
		{/snippet}
	</Modal>
{/if}

<style>
	.form-group label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.hint {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.file-status {
		font-size: var(--font-size-base);
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.file-status.success {
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
		color: var(--color-success);
	}

	.file-status.pending {
		background: color-mix(in srgb, var(--color-info) 15%, transparent);
		color: var(--color-info);
	}

	.file-status-actions {
		display: flex;
		gap: 2px;
		margin-left: auto;
		flex-shrink: 0;
	}

	.file-icon-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 1.1em;
		line-height: 1;
		padding: 2px 5px;
		border-radius: var(--radius-sm);
	}

	.file-icon-btn:hover {
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-text-muted) 15%, transparent);
	}

	.file-icon-btn.danger:hover {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
	}

	.spectrum-file-field .secondary {
		width: 100%;
	}

	.column-picker-body {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.column-picker-info {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.column-picker-chart {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs);
		background: var(--color-bg-secondary);
	}

	.column-picker-list {
		max-height: 200px;
		overflow-y: auto;
		overflow-x: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 4px;
	}

	.column-option {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}

	.column-option:hover {
		background: var(--color-bg-tertiary);
	}

	.column-option.selected {
		background: color-mix(in srgb, var(--color-primary) 15%, transparent);
	}

	.column-option input[type="radio"] {
		margin: 0;
	}

	.column-option-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.column-peak {
		color: var(--color-text-muted);
		font-size: 0.7rem;
		white-space: nowrap;
	}

	.column-picker-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-xs);
	}
</style>
