<script lang="ts">
	import { project, lamps } from '$lib/stores/project';
	import { getLampOptions } from '$lib/api/client';
	import type { LampInstance, RoomConfig, LampPresetInfo, LampType } from '$lib/types/project';
	import { onMount, onDestroy } from 'svelte';
	import LampInfoModal from './LampInfoModal.svelte';
	import AdvancedLampSettingsModal from './AdvancedLampSettingsModal.svelte';
	import { getDownlightPlacement, getCornerPlacement, getEdgePlacement, type PlacementMode } from '$lib/utils/lampPlacement';

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
	let lamp_type = $state<LampType>(lamp.lamp_type || 'krcl_222');
	let preset_id = $state(lamp.preset_id || '');
	let x = $state(lamp.x);
	let y = $state(lamp.y);
	let z = $state(lamp.z);
	let aimx = $state(lamp.aimx);
	let aimy = $state(lamp.aimy);
	let aimz = $state(lamp.aimz);
	let enabled = $state(lamp.enabled ?? true);

	// File uploads for custom lamps
	let iesFile: File | null = $state(null);
	let spectrumFile: File | null = $state(null);
	let iesFileInput: HTMLInputElement;
	let spectrumFileInput: HTMLInputElement;

	// Modal states
	let showInfoModal = $state(false);
	let showAdvancedModal = $state(false);

	// Placement mode state
	let cornerIndex = $state(-1);
	let edgeIndex = $state(-1);

	// Get other lamps (excluding current lamp)
	const otherLamps = $derived($lamps.filter(l => l.id !== lamp.id));

	function applyDownlightPlacement() {
		const placement = getDownlightPlacement(room, otherLamps);
		x = placement.x;
		y = placement.y;
		z = placement.z;
		aimx = placement.aimx;
		aimy = placement.aimy;
		aimz = placement.aimz;
		// Reset corner/edge indices since we switched modes
		cornerIndex = -1;
		edgeIndex = -1;
	}

	function applyCornerPlacement() {
		const placement = getCornerPlacement(room, otherLamps, cornerIndex);
		x = placement.x;
		y = placement.y;
		z = placement.z;
		aimx = placement.aimx;
		aimy = placement.aimy;
		aimz = placement.aimz;
		cornerIndex = placement.nextIndex;
		// Reset edge index since we're in corner mode
		edgeIndex = -1;
	}

	function applyEdgePlacement() {
		const placement = getEdgePlacement(room, otherLamps, edgeIndex);
		x = placement.x;
		y = placement.y;
		z = placement.z;
		aimx = placement.aimx;
		aimy = placement.aimy;
		aimz = placement.aimz;
		edgeIndex = placement.nextIndex;
		// Reset corner index since we're in edge mode
		cornerIndex = -1;
	}

	// Derived state
	let isCustomLamp = $derived(preset_id === 'custom' || lamp_type === 'lp_254');
	let isPresetLamp = $derived(preset_id !== '' && preset_id !== 'custom');
	let needsIesFile = $derived(
		(lamp_type === 'lp_254' || preset_id === 'custom') && !lamp.has_ies_file
	);
	let canUploadSpectrum = $derived(lamp_type === 'krcl_222' && preset_id === 'custom');
	// Lamp has photometric data (preset selected or IES uploaded)
	let hasPhotometry = $derived(
		(preset_id !== '' && preset_id !== 'custom' && lamp_type === 'krcl_222') ||
		lamp.has_ies_file
	);

	// Prompt message for buttons when no photometry
	let showPhotometryPrompt = $state(false);

	function handleLampInfoClick() {
		if (hasPhotometry) {
			showInfoModal = true;
		} else {
			showPhotometryPrompt = true;
		}
	}

	function handleAdvancedClick() {
		if (hasPhotometry) {
			showAdvancedModal = true;
		} else {
			showPhotometryPrompt = true;
		}
	}

	// Auto-save when any field changes (debounced to prevent cascading updates)
	let saveTimeout: ReturnType<typeof setTimeout>;
	let isInitialized = false;

	$effect(() => {
		// Read all values to track them
		const updates = {
			lamp_type,
			preset_id: lamp_type === 'lp_254' ? 'custom' : preset_id,
			x,
			y,
			z,
			aimx,
			aimy,
			aimz,
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
			// Always sync position/aim updates - these are independent of photometry
			project.updateLamp(lamp.id, updates);
		}, 100);
	});

	// Cleanup timer on unmount to prevent memory leaks
	onDestroy(() => {
		clearTimeout(saveTimeout);
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

	// Aim corner cycling state and logic
	let aimCornerIndex = $state(-1); // -1 means not initialized
	const aimCorners = $derived([
		{ x: 0, y: 0, z: 0 },
		{ x: room.x, y: 0, z: 0 },
		{ x: room.x, y: room.y, z: 0 },
		{ x: 0, y: room.y, z: 0 }
	]);

	function getFurthestAimCornerIndex(): number {
		let maxDist = -1;
		let maxIdx = 0;
		for (let i = 0; i < aimCorners.length; i++) {
			const c = aimCorners[i];
			const dist = Math.sqrt((c.x - x) ** 2 + (c.y - y) ** 2 + (c.z - z) ** 2);
			if (dist > maxDist) {
				maxDist = dist;
				maxIdx = i;
			}
		}
		return maxIdx;
	}

	function aimCorner() {
		if (aimCornerIndex === -1) {
			// First click: aim at furthest corner
			aimCornerIndex = getFurthestAimCornerIndex();
		} else {
			// Cycle to next corner
			aimCornerIndex = (aimCornerIndex + 1) % 4;
		}
		const c = aimCorners[aimCornerIndex];
		aimx = c.x;
		aimy = c.y;
		aimz = c.z;
	}

	// Horizontal direction cycling state and logic
	let horizIndex = $state(-1); // -1 means not initialized
	// 4 cardinal directions: towards each wall (at lamp's z height)
	const horizDirections = $derived([
		{ x: 0, y: y, z: z },       // towards X=0 wall
		{ x: x, y: room.y, z: z },  // towards Y=max wall
		{ x: room.x, y: y, z: z },  // towards X=max wall
		{ x: x, y: 0, z: z }        // towards Y=0 wall
	]);

	function getFurthestHorizIndex(): number {
		let maxDist = -1;
		let maxIdx = 0;
		for (let i = 0; i < horizDirections.length; i++) {
			const d = horizDirections[i];
			const dist = Math.sqrt((d.x - x) ** 2 + (d.y - y) ** 2);
			if (dist > maxDist) {
				maxDist = dist;
				maxIdx = i;
			}
		}
		return maxIdx;
	}

	function aimHorizontal() {
		if (horizIndex === -1) {
			// First click: aim at furthest direction
			horizIndex = getFurthestHorizIndex();
		} else {
			// Cycle to next direction
			horizIndex = (horizIndex + 1) % 4;
		}
		const d = horizDirections[horizIndex];
		aimx = d.x;
		aimy = d.y;
		aimz = d.z;
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
	{#if loading}
		<div class="loading">Loading lamp options...</div>
	{:else if error}
		<div class="error">{error}</div>
	{:else}
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

		<div class="lamp-action-buttons">
			<button type="button" class="secondary" onclick={handleLampInfoClick}>
				Lamp Info
			</button>
			<button type="button" class="secondary" onclick={handleAdvancedClick}>
				Advanced Settings
			</button>
		</div>

		{#if showPhotometryPrompt}
			<div class="photometry-prompt">
				{#if lamp_type === 'krcl_222'}
					Select a lamp preset or upload an IES file to access lamp info and advanced settings.
				{:else}
					Upload an IES file to access lamp info and advanced settings.
				{/if}
				<button type="button" class="dismiss-prompt" onclick={() => showPhotometryPrompt = false}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M18 6L6 18M6 6l12 12"/>
					</svg>
				</button>
			</div>
		{/if}

		<div class="form-group">
			<label>Placement</label>
			<div class="placement-buttons">
				<button type="button" class="secondary small" onclick={applyDownlightPlacement} title="Place lamp facing down, centered away from walls and other lamps">
					Downlight
				</button>
				<button type="button" class="secondary small" onclick={applyCornerPlacement} title="Place lamp in corner, aiming at opposite corner. Click again to cycle corners.">
					Corner
				</button>
				<button type="button" class="secondary small" onclick={applyEdgePlacement} title="Place lamp along ceiling edge, aiming at opposite floor edge. Click again to cycle edges.">
					Edge
				</button>
			</div>
		</div>

		<div class="form-group">
			<label>Position ({room.units})</label>
			<div class="form-row">
				<div>
					<span class="input-label">X</span>
					<input type="text" inputmode="decimal" value={x.toFixed(room.precision)} onchange={(e) => x = parseFloat((e.target as HTMLInputElement).value) || 0} />
				</div>
				<div>
					<span class="input-label">Y</span>
					<input type="text" inputmode="decimal" value={y.toFixed(room.precision)} onchange={(e) => y = parseFloat((e.target as HTMLInputElement).value) || 0} />
				</div>
				<div>
					<span class="input-label">Z</span>
					<input type="text" inputmode="decimal" value={z.toFixed(room.precision)} onchange={(e) => z = parseFloat((e.target as HTMLInputElement).value) || 0} />
				</div>
			</div>
		</div>

		<div class="form-group">
			<label>Aim Point ({room.units})</label>
			<div class="form-row">
				<div>
					<span class="input-label">X</span>
					<input type="text" inputmode="decimal" value={aimx.toFixed(room.precision)} onchange={(e) => aimx = parseFloat((e.target as HTMLInputElement).value) || 0} />
				</div>
				<div>
					<span class="input-label">Y</span>
					<input type="text" inputmode="decimal" value={aimy.toFixed(room.precision)} onchange={(e) => aimy = parseFloat((e.target as HTMLInputElement).value) || 0} />
				</div>
				<div>
					<span class="input-label">Z</span>
					<input type="text" inputmode="decimal" value={aimz.toFixed(room.precision)} onchange={(e) => aimz = parseFloat((e.target as HTMLInputElement).value) || 0} />
				</div>
			</div>
			<div class="aim-presets">
				<button type="button" class="secondary small" onclick={aimDown}>Down</button>
				<button type="button" class="secondary small" onclick={aimCorner}>Corner</button>
				<button type="button" class="secondary small" onclick={aimHorizontal}>Horizontal</button>
			</div>
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

{#if showInfoModal && hasPhotometry}
	<LampInfoModal
		presetId={isPresetLamp ? preset_id : undefined}
		lampId={!isPresetLamp ? lamp.id : undefined}
		lampName={lamp.name || preset_id || 'Custom Lamp'}
		onClose={() => showInfoModal = false}
	/>
{/if}

{#if showAdvancedModal && hasPhotometry}
	<AdvancedLampSettingsModal
		{lamp}
		{room}
		onClose={() => showAdvancedModal = false}
		onUpdate={() => {
			// Refresh lamp data from store (the scaling_factor may have changed)
			// No additional action needed - the store will update via sync
		}}
	/>
{/if}

<style>
	.lamp-editor {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.input-label {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-bottom: 2px;
	}

	.placement-buttons {
		display: flex;
		gap: var(--spacing-xs);
	}

	.placement-buttons button {
		flex: 1;
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
		color: var(--color-error);
		border: 1px solid var(--color-error);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		cursor: pointer;
	}

	.delete-btn:hover {
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
	}

	.loading,
	.error {
		padding: var(--spacing-md);
		text-align: center;
	}

	.error {
		color: var(--color-error);
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
		color: var(--color-error);
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

	.lamp-action-buttons {
		display: flex;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-sm);
	}

	.lamp-action-buttons button {
		flex: 1;
	}

	.photometry-prompt {
		display: flex;
		align-items: flex-start;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm);
		background: var(--color-warning-bg, #fef3c7);
		border: 1px solid var(--color-warning-border, #f59e0b);
		border-radius: var(--radius-sm);
		font-size: 0.813rem;
		color: var(--color-warning-text, #92400e);
		margin-bottom: var(--spacing-md);
	}

	.dismiss-prompt {
		flex-shrink: 0;
		background: transparent;
		border: none;
		padding: 2px;
		cursor: pointer;
		color: inherit;
		opacity: 0.7;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-left: auto;
	}

	.dismiss-prompt:hover {
		opacity: 1;
	}

	/* Dark mode warning adjustments */
	:global([data-theme="dark"]) .photometry-prompt {
		background: rgba(245, 158, 11, 0.15);
		border-color: rgba(245, 158, 11, 0.4);
		color: #fcd34d;
	}
</style>
