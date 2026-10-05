<script lang="ts">
	import { lamps, project } from '$lib/stores/project';
	import { customLamps } from '$lib/stores/lampLibrary';
	import SpectrumFileField from './SpectrumFileField.svelte';
	import type { SpectrumFileFieldValue } from './SpectrumFileField.svelte';

	// Instance-level source data for a custom lamp: the wavelength and spectrum
	// the upload form sets on a library definition, edited here for this one
	// placed lamp only. Reads and writes the store directly (no local mirror);
	// every change rides the sync queue via project.updateLamp.
	interface Props {
		lampId: string;
		/** Fired after a change has been sent to the backend. */
		onChanged?: () => void;
	}

	let { lampId, onChanged }: Props = $props();

	const lamp = $derived($lamps.find((l) => l.id === lampId));
	const definitionName = $derived(
		lamp?.custom_lamp_id ? $customLamps.find((d) => d.id === lamp.custom_lamp_id)?.name : undefined
	);

	// Transient: a picked file is handed to the store immediately, then reset.
	let spectrumValue = $state<SpectrumFileFieldValue | null>(null);
	let error = $state<string | null>(null);

	// The filename to show: an upload in flight, else the attached spectrum.
	const spectrumFilename = $derived(
		lamp?.pending_spectrum_file?.name ?? (lamp?.has_spectrum_file ? (lamp.spectrum_filename ?? 'Spectrum file') : undefined)
	);

	async function afterSync() {
		await project.whenSynced();
		onChanged?.();
	}

	$effect(() => {
		const v = spectrumValue;
		if (!v) return;
		spectrumValue = null;
		error = null;
		project.updateLamp(lampId, {
			pending_spectrum_file: v.file,
			pending_spectrum_column_index: v.columnIndex ?? 0,
			pending_remove_spectrum: undefined,
		});
		afterSync();
	});

	function removeSpectrum() {
		if (!lamp) return;
		if (!lamp.has_spectrum_file) {
			// Only an upload was pending: cancel it.
			project.updateLamp(lampId, { pending_spectrum_file: undefined, pending_spectrum_column_index: undefined });
			return;
		}
		project.updateLamp(lampId, {
			pending_spectrum_file: undefined,
			pending_spectrum_column_index: undefined,
			pending_remove_spectrum: true,
			has_spectrum_file: false,
			wavelength_from_spectrum: false,
			spectrum_filename: undefined,
		});
		afterSync();
	}

	function commitWavelength(raw: string) {
		const v = parseFloat(raw);
		if (!lamp || !Number.isFinite(v) || v <= 0 || v === lamp.wavelength) return;
		project.updateLamp(lampId, { wavelength: v });
		afterSync();
	}
</script>

{#if lamp}
	<section class="source-settings" aria-label="Lamp source">
		<div class="source-row">
			{#if lamp.lamp_type === 'other'}
				<div class="form-group wavelength-group">
					<label for="source-wavelength">
						Wavelength (nm)
						{#if lamp.wavelength_from_spectrum}
							<span class="hint">from spectrum peak</span>
						{/if}
					</label>
					<input
						id="source-wavelength"
						type="number"
						step="any"
						min="100"
						max="1000"
						placeholder="not set"
						value={lamp.wavelength ?? ''}
						disabled={lamp.wavelength_from_spectrum}
						title={lamp.wavelength_from_spectrum ? 'Defined by the spectrum peak; remove the spectrum to set it' : 'Nominal wavelength used when no spectrum is attached'}
						onchange={(e) => commitWavelength(e.currentTarget.value)}
					/>
				</div>
			{/if}
			<div class="spectrum-group">
				{#key `${lampId}:${spectrumFilename ?? ''}`}
					<SpectrumFileField
						bind:value={spectrumValue}
						currentFilename={spectrumFilename}
						recommended={lamp.lamp_type !== 'lp_254'}
						onerror={(msg) => (error = msg)}
						oncleared={removeSpectrum}
					/>
				{/key}
			</div>
		</div>
		{#if error}
			<p class="source-error">{error}</p>
		{/if}
		{#if definitionName}
			<p class="source-note">
				Changes apply to this lamp only. Editing &ldquo;{definitionName}&rdquo; in the lamp library will replace them.
			</p>
		{/if}
	</section>
{/if}

<style>
	.source-settings {
		padding: var(--spacing-sm) var(--spacing-md) 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.source-row {
		display: flex;
		gap: var(--spacing-md);
		align-items: flex-end;
		flex-wrap: wrap;
	}

	.wavelength-group {
		width: 9rem;
	}

	.wavelength-group label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.wavelength-group input {
		width: 100%;
	}

	.spectrum-group {
		flex: 1;
		min-width: 14rem;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.source-error {
		margin: 0;
		color: var(--color-error);
		font-size: var(--font-size-sm);
	}

	.source-note {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}
</style>
