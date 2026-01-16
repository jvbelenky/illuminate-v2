<script lang="ts">
	import { project } from '$lib/stores/project';
	import { getLampOptions } from '$lib/api/client';
	import type { LampInstance, RoomConfig, LampPresetInfo, LampType } from '$lib/types/project';
	import { onMount } from 'svelte';

	interface Props {
		lamp: LampInstance;
		room: RoomConfig;
		onClose: () => void;
	}

	let { lamp, room, onClose }: Props = $props();

	// Lamp options from API
	let presets: LampPresetInfo[] = $state([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Local state for editing - initialize from lamp
	let name = $state(lamp.name || '');
	let lamp_type = $state<LampType>(lamp.lamp_type || 'krcl_222');
	let preset_id = $state(lamp.preset_id || '');
	let x = $state(lamp.x);
	let y = $state(lamp.y);
	let z = $state(lamp.z);
	let aimx = $state(lamp.aimx);
	let aimy = $state(lamp.aimy);
	let aimz = $state(lamp.aimz);
	let scaling_factor = $state(lamp.scaling_factor);
	let enabled = $state(lamp.enabled ?? true);

	// File uploads for custom lamps
	let iesFile: File | null = $state(null);
	let spectrumFile: File | null = $state(null);
	let iesFileInput: HTMLInputElement;
	let spectrumFileInput: HTMLInputElement;

	// Derived state
	let isCustomLamp = $derived(preset_id === 'custom' || lamp_type === 'lp_254');
	let needsIesFile = $derived(
		(lamp_type === 'lp_254' || preset_id === 'custom') && !lamp.has_ies_file
	);
	let canUploadSpectrum = $derived(lamp_type === 'krcl_222' && preset_id === 'custom');

	// Auto-save when any field changes (debounced to prevent cascading updates)
	let saveTimeout: ReturnType<typeof setTimeout>;
	let isInitialized = false;

	$effect(() => {
		// Read all values to track them
		const updates = {
			name: name || undefined,
			lamp_type,
			preset_id: lamp_type === 'lp_254' ? 'custom' : preset_id,
			x,
			y,
			z,
			aimx,
			aimy,
			aimz,
			scaling_factor,
			enabled,
			pending_ies_file: iesFile || undefined,
			pending_spectrum_file: spectrumFile || undefined
		};

		// Skip the initial run
		if (!isInitialized) {
			isInitialized = true;
			return;
		}

		// Debounce updates to prevent cascading re-renders
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			if (lamp_type === 'lp_254' || preset_id) {
				project.updateLamp(lamp.id, updates);
			}
		}, 100);
	});

	onMount(async () => {
		try {
			const options = await getLampOptions();
			presets = options.presets_222nm;
			loading = false;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load lamp options';
			loading = false;
		}
	});

	function remove() {
		if (confirm('Delete this lamp?')) {
			project.removeLamp(lamp.id);
			onClose();
		}
	}

	// Quick aim presets (aim point, not direction)
	function aimDown() {
		aimx = x;
		aimy = y;
		aimz = 0;
	}

	function aimUp() {
		aimx = x;
		aimy = y;
		aimz = room.z;
	}

	function aimHorizontal() {
		aimx = 0;
		aimy = y;
		aimz = z;
	}

	function handleIesFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			iesFile = input.files[0];
		}
	}

	function handleSpectrumFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			spectrumFile = input.files[0];
		}
	}

	function handleLampTypeChange() {
		if (lamp_type === 'lp_254') {
			preset_id = 'custom';
		} else if (preset_id === 'custom' || !preset_id) {
			preset_id = '';
		}
	}
</script>

<div class="lamp-editor">
	<div class="editor-header">
		<h3>Edit Lamp</h3>
		<button type="button" class="close-btn" onclick={onClose} title="Close">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M18 6L6 18M6 6l12 12"/>
			</svg>
		</button>
	</div>

	{#if loading}
		<div class="loading">Loading lamp options...</div>
	{:else if error}
		<div class="error">{error}</div>
	{:else}
		<div class="form-group">
			<label for="lamp-name">Name</label>
			<input id="lamp-name" type="text" bind:value={name} placeholder="Unnamed" />
		</div>

		<div class="form-group">
			<label for="lamp-type">Lamp Type</label>
			<select id="lamp-type" bind:value={lamp_type} onchange={handleLampTypeChange}>
				<option value="krcl_222">Krypton chloride (222 nm)</option>
				<option value="lp_254">Low-pressure mercury (254 nm)</option>
			</select>
		</div>

		{#if lamp_type === 'krcl_222'}
			<div class="form-group">
				<label for="preset">Select Lamp</label>
				<select id="preset" bind:value={preset_id}>
					<option value="" disabled>-- Select a lamp --</option>
					{#each presets as preset}
						<option value={preset.id}>{preset.name}</option>
					{/each}
				</select>
			</div>
		{/if}

		{#if isCustomLamp}
			<div class="file-upload-section">
				<div class="form-group">
					<label>
						IES Photometric File
						{#if lamp_type === 'lp_254'}
							<span class="required">(required)</span>
						{:else}
							<span class="required">(required for custom)</span>
						{/if}
					</label>
					{#if lamp.has_ies_file}
						<div class="file-status success">IES file uploaded</div>
					{:else if iesFile}
						<div class="file-status pending">Selected: {iesFile.name}</div>
					{:else}
						<div class="file-status warning">No IES file</div>
					{/if}
					<input
						type="file"
						accept=".ies"
						bind:this={iesFileInput}
						onchange={handleIesFileChange}
						style="display: none"
					/>
					<button type="button" class="secondary" onclick={() => iesFileInput.click()}>
						{lamp.has_ies_file ? 'Replace IES File' : 'Select IES File'}
					</button>
				</div>

				{#if canUploadSpectrum}
					<div class="form-group">
						<label>
							Spectrum CSV File
							<span class="optional">(optional)</span>
						</label>
						{#if lamp.has_spectrum_file}
							<div class="file-status success">Spectrum file uploaded</div>
						{:else if spectrumFile}
							<div class="file-status pending">Selected: {spectrumFile.name}</div>
						{:else}
							<div class="file-status muted">No spectrum file</div>
						{/if}
						<input
							type="file"
							accept=".csv"
							bind:this={spectrumFileInput}
							onchange={handleSpectrumFileChange}
							style="display: none"
						/>
						<button type="button" class="secondary" onclick={() => spectrumFileInput.click()}>
							{lamp.has_spectrum_file ? 'Replace Spectrum File' : 'Select Spectrum File'}
						</button>
					</div>
				{/if}

				{#if lamp_type === 'lp_254'}
					<p class="info-text">
						254nm lamps are assumed to be monochromatic. No spectrum file is needed.
					</p>
				{/if}
			</div>
		{/if}

		<div class="form-group">
			<label>Position ({room.units})</label>
			<div class="form-row">
				<div>
					<span class="input-label">X</span>
					<input type="number" bind:value={x} min="0" max={room.x} step="0.1" />
				</div>
				<div>
					<span class="input-label">Y</span>
					<input type="number" bind:value={y} min="0" max={room.y} step="0.1" />
				</div>
				<div>
					<span class="input-label">Z</span>
					<input type="number" bind:value={z} min="0" max={room.z} step="0.1" />
				</div>
			</div>
		</div>

		<div class="form-group">
			<label>Aim Point ({room.units})</label>
			<div class="form-row">
				<div>
					<span class="input-label">X</span>
					<input type="number" bind:value={aimx} step="0.1" />
				</div>
				<div>
					<span class="input-label">Y</span>
					<input type="number" bind:value={aimy} step="0.1" />
				</div>
				<div>
					<span class="input-label">Z</span>
					<input type="number" bind:value={aimz} step="0.1" />
				</div>
			</div>
			<div class="aim-presets">
				<button type="button" class="secondary small" onclick={aimDown}>Down</button>
				<button type="button" class="secondary small" onclick={aimUp}>Up</button>
				<button type="button" class="secondary small" onclick={aimHorizontal}>Horizontal</button>
			</div>
		</div>

		<div class="form-group">
			<label for="scaling">Scaling Factor</label>
			<input id="scaling" type="number" bind:value={scaling_factor} min="0" step="0.1" />
		</div>

		<div class="form-group checkbox-group">
			<label>
				<input type="checkbox" bind:checked={enabled} />
				Enabled (include in calculations)
			</label>
		</div>

		<div class="editor-actions">
			<button class="delete-btn" onclick={remove}>Delete</button>
			<button class="secondary" onclick={onClose}>Close</button>
		</div>
	{/if}
</div>

<style>
	.lamp-editor {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.editor-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-md);
	}

	.editor-header h3 {
		margin: 0;
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

	.input-label {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-bottom: 2px;
	}

	.aim-presets {
		display: flex;
		gap: var(--spacing-xs);
		margin-top: var(--spacing-sm);
	}

	.small {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.75rem;
	}

	.editor-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: var(--spacing-lg);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border);
	}

	.delete-btn {
		background: transparent;
		color: #dc2626;
		border: 1px solid #dc2626;
		border-radius: var(--radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		cursor: pointer;
	}

	.delete-btn:hover {
		background: rgba(220, 38, 38, 0.1);
	}

	.loading,
	.error {
		padding: var(--spacing-md);
		text-align: center;
	}

	.error {
		color: #dc2626;
	}

	.file-upload-section {
		background: var(--color-bg-secondary, #f5f5f5);
		border-radius: var(--radius-sm);
		padding: var(--spacing-md);
		margin: var(--spacing-md) 0;
	}

	.file-status {
		font-size: 0.875rem;
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		margin-bottom: var(--spacing-sm);
	}

	.file-status.success {
		background: #dcfce7;
		color: #166534;
	}

	.file-status.warning {
		background: #fef3c7;
		color: #92400e;
	}

	.file-status.pending {
		background: #dbeafe;
		color: #1e40af;
	}

	.file-status.muted {
		background: #f3f4f6;
		color: #6b7280;
	}

	.required {
		color: #dc2626;
		font-size: 0.75rem;
	}

	.optional {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.info-text {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-top: var(--spacing-sm);
		font-style: italic;
	}

	.checkbox-group {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.checkbox-group label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
	}

	.checkbox-group input[type='checkbox'] {
		width: auto;
	}
</style>
