<script lang="ts">
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import SpectrumFileField from './SpectrumFileField.svelte';
	import type { SpectrumFileFieldValue } from './SpectrumFileField.svelte';
	import { lampLibrary, customLamps, fileToEmbedded } from '$lib/stores/lampLibrary';
	import { lamps, project } from '$lib/stores/project';
	import { getLampContentHash } from '$lib/api/client';
	import type { CustomLampDef, CustomLampType, EmbeddedFile } from '$lib/types/lampLibrary';

	interface Props {
		onClose: () => void;
		initialLampType?: CustomLampType;
	}

	let { onClose, initialLampType }: Props = $props();

	// Captured once — this prop only ever sets the initial view/type; it is
	// not meant to be reactive across the modal's lifetime.
	const initialType = initialLampType;

	type View = 'list' | 'form';

	let view = $state<View>(initialType ? 'form' : 'list');
	let editingId = $state<string | null>(null);

	// --- Draft form state (a copy, never a store mirror — see startAdd/startEdit) ---
	let name = $state('');
	let formLampType = $state<CustomLampType>(initialType ?? 'krcl_222');
	let wavelength = $state<number | undefined>(undefined);

	let iesFile = $state<File | null>(null);
	let currentIesFilename = $state<string | undefined>(undefined);
	let iesInput: HTMLInputElement;

	let spectrumValue = $state<SpectrumFileFieldValue | null>(null);
	let currentSpectrumFilename = $state<string | undefined>(undefined);
	let spectrumCleared = $state(false);

	let scalingFactor = $state<number | undefined>(undefined);
	let intensityUnits = $state<'mw/sr' | 'uw/cm2' | undefined>(undefined);
	let surfaceWidth = $state<number | undefined>(undefined);
	let surfaceLength = $state<number | undefined>(undefined);
	let surfaceHeight = $state<number | undefined>(undefined);
	let surfaceUnits = $state<'meters' | 'feet'>('meters');
	let housingWidth = $state<number | undefined>(undefined);
	let housingLength = $state<number | undefined>(undefined);
	let housingHeight = $state<number | undefined>(undefined);
	let sourceDensity = $state<number | undefined>(undefined);
	let intensityMapFile = $state<File | null>(null);
	let currentIntensityMapFilename = $state<string | undefined>(undefined);
	let intensityMapCleared = $state(false);
	let intensityMapInput: HTMLInputElement;

	let saveToBrowser = $state(true);
	let formError = $state<string | null>(null);
	let saving = $state(false);

	let deleteConfirm = $state<{ id: string; name: string; usedBy: { id: string; name: string }[] } | null>(null);
	let removeFromBrowserConfirm = $state<{ id: string; name: string } | null>(null);

	let browserLamps = $derived($customLamps.filter((d) => d.scope === 'browser'));
	let projectLamps = $derived($customLamps.filter((d) => d.scope === 'project'));

	let spectrumAttached = $derived(
		spectrumValue !== null ||
			(editingId !== null && currentSpectrumFilename !== undefined && !spectrumCleared)
	);

	// A freshly-picked spectrum file supersedes an earlier clear.
	$effect(() => {
		if (spectrumValue !== null) spectrumCleared = false;
	});

	function typeBadge(t: CustomLampType): string {
		if (t === 'krcl_222') return '222 nm';
		if (t === 'lp_254') return '254 nm';
		return 'Other';
	}

	function resetDraft() {
		name = '';
		formLampType = initialType ?? 'krcl_222';
		wavelength = undefined;
		iesFile = null;
		currentIesFilename = undefined;
		spectrumValue = null;
		currentSpectrumFilename = undefined;
		spectrumCleared = false;
		scalingFactor = undefined;
		intensityUnits = undefined;
		surfaceWidth = undefined;
		surfaceLength = undefined;
		surfaceHeight = undefined;
		surfaceUnits = 'meters';
		housingWidth = undefined;
		housingLength = undefined;
		housingHeight = undefined;
		sourceDensity = undefined;
		intensityMapFile = null;
		currentIntensityMapFilename = undefined;
		intensityMapCleared = false;
		saveToBrowser = true;
		formError = null;
	}

	function startAdd() {
		editingId = null;
		resetDraft();
		view = 'form';
	}

	function startEdit(def: CustomLampDef) {
		editingId = def.id;
		name = def.name;
		formLampType = def.lampType;
		wavelength = def.wavelength;
		iesFile = null;
		currentIesFilename = def.ies.filename;
		spectrumValue = null;
		currentSpectrumFilename = def.spectrum?.filename;
		spectrumCleared = false;
		scalingFactor = def.scalingFactor;
		intensityUnits = def.intensityUnits;
		surfaceWidth = def.surface?.width;
		surfaceLength = def.surface?.length;
		surfaceHeight = def.surface?.height;
		surfaceUnits = def.surface?.units ?? 'meters';
		housingWidth = def.housing?.width;
		housingLength = def.housing?.length;
		housingHeight = def.housing?.height;
		sourceDensity = def.sourceDensity;
		intensityMapFile = null;
		currentIntensityMapFilename = def.intensityMap?.filename;
		intensityMapCleared = false;
		saveToBrowser = def.scope === 'browser';
		formError = null;
		view = 'form';
	}

	function cancelForm() {
		view = 'list';
		editingId = null;
	}

	function handleIesChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || !input.files[0]) return;
		iesFile = input.files[0];
		formError = null;
		input.value = '';
	}

	function handleIntensityMapChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || !input.files[0]) return;
		intensityMapFile = input.files[0];
		intensityMapCleared = false;
		input.value = '';
	}

	function handleIntensityMapClear() {
		intensityMapFile = null;
		currentIntensityMapFilename = undefined;
		intensityMapCleared = true;
	}

	function buildSurface() {
		if (surfaceWidth == null && surfaceLength == null && surfaceHeight == null) return undefined;
		return { width: surfaceWidth, length: surfaceLength, height: surfaceHeight, units: surfaceUnits };
	}

	function buildHousing() {
		if (housingWidth == null && housingLength == null && housingHeight == null) return undefined;
		return { width: housingWidth, length: housingLength, height: housingHeight };
	}

	async function save() {
		formError = null;

		const trimmedName = name.trim();
		if (!trimmedName) {
			formError = 'Name is required';
			return;
		}
		const hasExistingIes = editingId !== null && currentIesFilename !== undefined;
		if (!iesFile && !hasExistingIes) {
			formError = 'An IES file is required';
			return;
		}
		if (formLampType === 'other' && wavelength == null && !spectrumAttached) {
			formError = 'Provide a spectrum file or a wavelength for a custom-wavelength lamp';
			return;
		}

		saving = true;
		try {
			const iesForHash = iesFile ?? (editingId ? lampLibrary.toIesFile(editingId) : null);
			if (!iesForHash) {
				formError = 'An IES file is required';
				return;
			}
			const spectrumForHash = spectrumValue
				? spectrumValue.file
				: spectrumCleared
					? undefined
					: editingId
						? (lampLibrary.toSpectrumFile(editingId) ?? undefined)
						: undefined;
			const columnIndexForHash = spectrumValue
				? spectrumValue.columnIndex
				: spectrumCleared
					? undefined
					: editingId
						? lampLibrary.get(editingId)?.spectrum?.columnIndex
						: undefined;

			let hash: string;
			try {
				const result = await getLampContentHash(iesForHash, spectrumForHash, columnIndexForHash);
				hash = result.content_hash;
			} catch (err: any) {
				formError = err?.message || 'Failed to validate IES file';
				return;
			}

			let iesEmbedded: EmbeddedFile;
			if (iesFile) {
				iesEmbedded = await fileToEmbedded(iesFile);
			} else {
				// Reuse the existing definition's IES. If it vanished (deleted in
				// another tab/view since this modal opened), abort cleanly.
				const existing = editingId ? lampLibrary.get(editingId) : undefined;
				if (!existing) {
					formError = "This lamp was deleted in another view";
					return;
				}
				iesEmbedded = existing.ies;
			}

			let spectrumEmbedded: (EmbeddedFile & { columnIndex?: number }) | undefined;
			if (spectrumValue) {
				spectrumEmbedded = { ...(await fileToEmbedded(spectrumValue.file)), columnIndex: spectrumValue.columnIndex };
			} else if (spectrumCleared) {
				spectrumEmbedded = undefined;
			} else if (editingId) {
				spectrumEmbedded = lampLibrary.get(editingId)?.spectrum;
			}

			let intensityMapEmbedded: EmbeddedFile | undefined;
			if (intensityMapFile) {
				intensityMapEmbedded = await fileToEmbedded(intensityMapFile);
			} else if (intensityMapCleared) {
				intensityMapEmbedded = undefined;
			} else if (editingId) {
				intensityMapEmbedded = lampLibrary.get(editingId)?.intensityMap;
			}

			const fields = {
				name: trimmedName,
				lampType: formLampType,
				wavelength: formLampType === 'other' ? wavelength : undefined,
				ies: iesEmbedded,
				spectrum: spectrumEmbedded,
				scalingFactor,
				intensityUnits,
				surface: buildSurface(),
				housing: buildHousing(),
				sourceDensity,
				intensityMap: intensityMapEmbedded,
				scope: (saveToBrowser ? 'browser' : 'project') as CustomLampDef['scope'],
				contentHash: hash,
			};

			if (editingId) {
				await lampLibrary.update(editingId, fields);
				await project.propagateCustomLampEdit(editingId);
			} else {
				await lampLibrary.add(fields);
			}

			view = 'list';
			editingId = null;
		} finally {
			saving = false;
		}
	}

	function handleRemoveFromBrowser(def: CustomLampDef) {
		const inUse = $lamps.some((l) => l.custom_lamp_id === def.id);
		if (inUse) {
			lampLibrary.setScope(def.id, 'project');
		} else {
			removeFromBrowserConfirm = { id: def.id, name: def.name };
		}
	}

	function confirmRemoveFromBrowser() {
		if (!removeFromBrowserConfirm) return;
		lampLibrary.remove(removeFromBrowserConfirm.id);
		removeFromBrowserConfirm = null;
	}

	function requestDelete(def: CustomLampDef) {
		const usedBy = $lamps.filter((l) => l.custom_lamp_id === def.id);
		if (usedBy.length > 0) {
			deleteConfirm = {
				id: def.id,
				name: def.name,
				usedBy: usedBy.map((l) => ({ id: l.id, name: l.name || 'Unnamed Lamp' })),
			};
		} else {
			lampLibrary.remove(def.id);
		}
	}

	async function confirmDelete() {
		if (!deleteConfirm) return;
		const { id, usedBy } = deleteConfirm;
		for (const l of usedBy) {
			await project.detachCustomLamp(l.id);
		}
		await lampLibrary.remove(id);
		deleteConfirm = null;
	}
</script>

<Modal title="Manage Custom Lamps" {onClose} width="600px" maxWidth="95vw" dockId="lamp-manager">
	{#snippet body()}
		<div class="lamp-manager">
			{#if view === 'list'}
				<div class="list-header">
					<button type="button" class="primary" onclick={startAdd}>Add custom lamp</button>
				</div>

				<div class="lamp-section">
					<h3>Saved in browser</h3>
					{#if browserLamps.length === 0}
						<div class="empty-state">No custom lamps saved to the browser</div>
					{:else}
						{#each browserLamps as def (def.id)}
							<div class="lamp-row">
								<span class="lamp-name">{def.name}</span>
								<span class="type-badge">{typeBadge(def.lampType)}</span>
								{#if def.spectrum}
									<span class="spectrum-dot" title="Has spectrum"></span>
								{/if}
								<div class="row-actions">
									<button type="button" class="secondary" onclick={() => startEdit(def)}>Edit</button>
									<button type="button" class="secondary" onclick={() => handleRemoveFromBrowser(def)}>Remove from browser</button>
									<button type="button" class="danger" onclick={() => requestDelete(def)}>Delete</button>
								</div>
							</div>
						{/each}
					{/if}
				</div>

				<div class="lamp-section">
					<h3>This project only</h3>
					{#if projectLamps.length === 0}
						<div class="empty-state">No project-only custom lamps</div>
					{:else}
						{#each projectLamps as def (def.id)}
							<div class="lamp-row">
								<span class="lamp-name">{def.name}</span>
								<span class="type-badge">{typeBadge(def.lampType)}</span>
								{#if def.spectrum}
									<span class="spectrum-dot" title="Has spectrum"></span>
								{/if}
								<div class="row-actions">
									<button type="button" class="secondary" onclick={() => startEdit(def)}>Edit</button>
									<button type="button" class="secondary" onclick={() => lampLibrary.setScope(def.id, 'browser')}>Save to browser</button>
									<button type="button" class="danger" onclick={() => requestDelete(def)}>Delete</button>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			{:else}
				<div class="lamp-form">
					{#if formError}
						<div class="file-status warning">{formError}</div>
					{/if}

					<div class="form-group">
						<label for="lamp-name">Name</label>
						<input id="lamp-name" type="text" bind:value={name} />
					</div>

					<div class="form-group">
						<label for="lamp-type-select">Lamp Type</label>
						<select id="lamp-type-select" bind:value={formLampType}>
							<option value="krcl_222">Krypton chloride (222 nm)</option>
							<option value="lp_254">Low-pressure mercury (254 nm)</option>
							<option value="other">Other (custom wavelength)</option>
						</select>
					</div>

					{#if formLampType === 'other'}
						<div class="form-group">
							<label for="wavelength">
								Wavelength (nm)
								{#if spectrumAttached}
									<span class="hint">derived from spectrum peak</span>
								{/if}
							</label>
							<input id="wavelength" type="number" step="any" bind:value={wavelength} disabled={spectrumAttached} />
						</div>
					{/if}

					<div class="form-group">
						<label for="ies-file-input">IES File</label>
						{#if iesFile}
							<div class="file-status success">
								{iesFile.name}
								<button type="button" class="file-icon-btn" onclick={() => iesInput.click()} title="Replace IES file">&#x21c6;</button>
							</div>
						{:else if currentIesFilename}
							<div class="file-status success">
								{currentIesFilename}
								<button type="button" class="file-icon-btn" onclick={() => iesInput.click()} title="Replace IES file">&#x21c6;</button>
							</div>
						{:else}
							<button type="button" class="secondary" onclick={() => iesInput.click()}>Select IES File</button>
						{/if}
						<input
							id="ies-file-input"
							type="file"
							accept=".ies"
							bind:this={iesInput}
							onchange={handleIesChange}
							style="display: none"
						/>
					</div>

					<SpectrumFileField
						bind:value={spectrumValue}
						currentFilename={spectrumCleared ? undefined : currentSpectrumFilename}
						recommended={formLampType === 'krcl_222' || formLampType === 'other'}
						onerror={(msg) => (formError = msg)}
						oncleared={() => (spectrumCleared = true)}
					/>

					<details class="advanced-section">
						<summary>Advanced</summary>

						<div class="form-group">
							<label for="scaling-factor">Scaling Factor</label>
							<input id="scaling-factor" type="number" step="any" bind:value={scalingFactor} />
						</div>

						<div class="form-group">
							<label for="intensity-units">Intensity Units</label>
							<select id="intensity-units" bind:value={intensityUnits}>
								<option value={undefined}>(default)</option>
								<option value="mw/sr">mW/sr</option>
								<option value="uw/cm2">&micro;W/cm&sup2;</option>
							</select>
						</div>

						<div class="form-row">
							<div class="form-group">
								<label for="surface-width">Surface Width</label>
								<input id="surface-width" type="number" step="any" bind:value={surfaceWidth} />
							</div>
							<div class="form-group">
								<label for="surface-length">Surface Length</label>
								<input id="surface-length" type="number" step="any" bind:value={surfaceLength} />
							</div>
							<div class="form-group">
								<label for="surface-height">Surface Height</label>
								<input id="surface-height" type="number" step="any" bind:value={surfaceHeight} />
							</div>
						</div>
						<div class="form-group">
							<label for="surface-units">Surface Units</label>
							<select id="surface-units" bind:value={surfaceUnits}>
								<option value="meters">meters</option>
								<option value="feet">feet</option>
							</select>
						</div>

						<div class="form-row">
							<div class="form-group">
								<label for="housing-width">Housing Width</label>
								<input id="housing-width" type="number" step="any" bind:value={housingWidth} />
							</div>
							<div class="form-group">
								<label for="housing-length">Housing Length</label>
								<input id="housing-length" type="number" step="any" bind:value={housingLength} />
							</div>
							<div class="form-group">
								<label for="housing-height">Housing Height</label>
								<input id="housing-height" type="number" step="any" bind:value={housingHeight} />
							</div>
						</div>

						<div class="form-group">
							<label for="source-density">Source Density</label>
							<input id="source-density" type="number" step="any" bind:value={sourceDensity} />
						</div>

						<div class="form-group">
							<label for="intensity-map-input">Intensity Map File</label>
							{#if intensityMapFile}
								<div class="file-status success">
									{intensityMapFile.name}
									<span class="file-status-actions">
										<button type="button" class="file-icon-btn" onclick={() => intensityMapInput.click()} title="Replace intensity map file">&#x21c6;</button>
										<button type="button" class="file-icon-btn danger" onclick={handleIntensityMapClear} title="Remove intensity map file">&times;</button>
									</span>
								</div>
							{:else if currentIntensityMapFilename}
								<div class="file-status success">
									{currentIntensityMapFilename}
									<span class="file-status-actions">
										<button type="button" class="file-icon-btn" onclick={() => intensityMapInput.click()} title="Replace intensity map file">&#x21c6;</button>
										<button type="button" class="file-icon-btn danger" onclick={handleIntensityMapClear} title="Remove intensity map file">&times;</button>
									</span>
								</div>
							{:else}
								<button type="button" class="secondary" onclick={() => intensityMapInput.click()}>Select Intensity Map File</button>
							{/if}
							<input
								id="intensity-map-input"
								type="file"
								bind:this={intensityMapInput}
								onchange={handleIntensityMapChange}
								style="display: none"
							/>
						</div>
					</details>

					<div class="form-group">
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={saveToBrowser} />
							Save to browser for future sessions
						</label>
					</div>

					<div class="form-actions">
						<button type="button" class="secondary" onclick={cancelForm} disabled={saving}>Cancel</button>
						<button type="button" class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
					</div>
				</div>
			{/if}
		</div>
	{/snippet}
</Modal>

{#if deleteConfirm}
	<ConfirmDialog
		title="Delete Custom Lamp"
		message="&quot;{deleteConfirm.name}&quot; is used by: {deleteConfirm.usedBy.map((l) => l.name).join(', ')}. These lamps will lose their photometry."
		confirmLabel="Delete"
		variant="danger"
		onConfirm={confirmDelete}
		onCancel={() => (deleteConfirm = null)}
	/>
{/if}

{#if removeFromBrowserConfirm}
	<ConfirmDialog
		title="Remove from Browser"
		message="&quot;{removeFromBrowserConfirm.name}&quot; is not saved anywhere else and will be deleted. Continue?"
		confirmLabel="Remove"
		variant="danger"
		onConfirm={confirmRemoveFromBrowser}
		onCancel={() => (removeFromBrowserConfirm = null)}
	/>
{/if}

<style>
	.lamp-manager {
		padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.list-header {
		display: flex;
		justify-content: flex-end;
	}

	.lamp-section h3 {
		margin: 0 0 var(--spacing-xs);
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.lamp-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		margin-bottom: var(--spacing-xs);
	}

	.lamp-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.type-badge {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		background: var(--color-bg-tertiary);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.spectrum-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-success);
		flex-shrink: 0;
	}

	.row-actions {
		display: flex;
		gap: var(--spacing-xs);
		flex-shrink: 0;
	}

	.empty-state {
		padding: var(--spacing-md);
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		font-style: italic;
	}

	button.primary {
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		padding: 6px 14px;
		font-size: 0.8rem;
		cursor: pointer;
		font-weight: 500;
	}

	button.primary:hover {
		background: color-mix(in srgb, var(--color-primary) 85%, black);
	}

	button.danger {
		background: none;
		border: 1px solid var(--color-error);
		color: var(--color-error);
		border-radius: var(--radius-sm);
		padding: 5px 10px;
		font-size: 0.75rem;
		cursor: pointer;
	}

	button.danger:hover {
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
	}

	.lamp-form .secondary {
		width: 100%;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: normal;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 0.85rem;
		color: var(--color-text);
		cursor: pointer;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-sm);
	}

	.advanced-section {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
	}

	.advanced-section summary {
		cursor: pointer;
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.advanced-section .form-group:first-of-type {
		margin-top: var(--spacing-sm);
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

	.file-status.warning {
		background: color-mix(in srgb, var(--color-warning) 15%, transparent);
		color: var(--color-warning);
	}

	.file-icon-btn {
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		font-size: 1.1em;
		line-height: 1;
		padding: 2px 5px;
		border-radius: var(--radius-sm);
	}

	.file-icon-btn:hover {
		background: color-mix(in srgb, var(--color-text-muted) 15%, transparent);
	}

	.file-icon-btn.danger:hover {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
	}

	.file-status-actions {
		display: flex;
		gap: 2px;
		margin-left: auto;
		flex-shrink: 0;
	}
</style>
