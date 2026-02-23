<script lang="ts">
	import Modal from './Modal.svelte';
	import { onMount } from 'svelte';
	import { userSettings, SETTINGS_DEFAULTS, type UserSettings } from '$lib/stores/settings';
	import type { PlaneCalcType, ZoneDisplayMode, LampPresetInfo } from '$lib/types/project';
	import { getLampOptionsCached } from '$lib/api/client';
	import type { PlacementMode } from '$lib/utils/lampPlacement';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// Work on a draft copy; only commit on Save
	let draft = $state<UserSettings>({ ...$userSettings });

	type Tab = 'zones' | 'display' | 'room' | 'lamp';
	let activeTab = $state<Tab>('zones');

	// Lamp presets (fetched from API)
	let presets222 = $state<LampPresetInfo[]>([]);
	let presetsLoading = $state(false);

	onMount(async () => {
		presetsLoading = true;
		try {
			const options = await getLampOptionsCached();
			presets222 = options.presets_222nm;
		} catch (e) {
			console.warn('[settings] Failed to load lamp presets:', e);
		} finally {
			presetsLoading = false;
		}
	});

	const colormapOptions = [
		'plasma', 'viridis', 'magma', 'inferno', 'cividis',
		'plasma_r', 'viridis_r', 'magma_r', 'inferno_r', 'cividis_r'
	];

	const calcTypeOptions: { value: PlaneCalcType; label: string }[] = [
		{ value: 'planar_normal', label: 'Planar Normal' },
		{ value: 'planar_max', label: 'Planar Max' },
		{ value: 'fluence_rate', label: 'Fluence Rate' },
		{ value: 'vertical_dir', label: 'Vertical (Directional)' },
		{ value: 'vertical', label: 'Vertical' },
	];

	const displayModeOptions: { value: ZoneDisplayMode; label: string }[] = [
		{ value: 'heatmap', label: 'Heatmap' },
		{ value: 'numeric', label: 'Numeric' },
		{ value: 'markers', label: 'Markers' },
		{ value: 'none', label: 'None' },
	];

	const placementOptions: { value: PlacementMode; label: string }[] = [
		{ value: 'downlight', label: 'Downlight' },
		{ value: 'corner', label: 'Corner' },
		{ value: 'edge', label: 'Edge' },
		{ value: 'horizontal', label: 'Horizontal' },
	];

	const precisionOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

	function save() {
		userSettings.set({ ...draft });
		onClose();
	}

	function resetToDefaults() {
		draft = { ...SETTINGS_DEFAULTS };
	}
</script>

<Modal title="Settings" {onClose} maxWidth="580px">
	{#snippet body()}
		<div class="modal-body">
			<div class="settings-tabs">
				<button class="tab-btn" class:active={activeTab === 'zones'} onclick={() => activeTab = 'zones'}>Zones</button>
				<button class="tab-btn" class:active={activeTab === 'display'} onclick={() => activeTab = 'display'}>Display</button>
				<button class="tab-btn" class:active={activeTab === 'room'} onclick={() => activeTab = 'room'}>Room</button>
				<button class="tab-btn" class:active={activeTab === 'lamp'} onclick={() => activeTab = 'lamp'}>Lamp</button>
			</div>

			<div class="settings-content">
				{#if activeTab === 'zones'}
					<section class="settings-section">
						<h4>New Zone Defaults</h4>
						<div class="section-content">
							<div class="form-group">
								<label for="zone-type">Default zone type</label>
								<select id="zone-type" bind:value={draft.zoneType}>
									<option value="plane">Plane</option>
									<option value="volume">Volume</option>
								</select>
							</div>

							<div class="form-group">
								<label for="plane-display">Plane display mode</label>
								<select id="plane-display" bind:value={draft.planeDisplayMode}>
									{#each displayModeOptions as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>

							<div class="form-group">
								<label for="volume-display">Volume display mode</label>
								<select id="volume-display" bind:value={draft.volumeDisplayMode}>
									{#each displayModeOptions as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>

							<div class="form-group">
								<label for="zone-offset">Boundary offset</label>
								<select id="zone-offset" bind:value={draft.zoneOffset}>
									<option value={true}>On</option>
									<option value={false}>Off</option>
								</select>
							</div>

							<div class="form-group">
								<label for="zone-calc-type">Plane calc type</label>
								<select id="zone-calc-type" bind:value={draft.zoneCalcType}>
									{#each calcTypeOptions as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>

							<div class="form-group">
								<label for="zone-dose">Default dose mode</label>
								<select id="zone-dose" bind:value={draft.zoneDose}>
									<option value={false}>Off</option>
									<option value={true}>On</option>
								</select>
							</div>

							<div class="form-group">
								<label for="zone-hours">Default exposure hours</label>
								<input id="zone-hours" type="number" bind:value={draft.zoneHours} min="0.1" max="24" step="0.1" />
							</div>
						</div>
					</section>

				{:else if activeTab === 'display'}
					<section class="settings-section">
						<h4>Visualization Defaults</h4>
						<div class="section-content">
							<div class="form-group">
								<label for="colormap">Colormap</label>
								<select id="colormap" bind:value={draft.colormap}>
									{#each colormapOptions as cm}
										<option value={cm}>{cm}</option>
									{/each}
								</select>
							</div>

							<div class="form-group">
								<label for="precision">Decimal precision</label>
								<select id="precision" bind:value={draft.precision}>
									{#each precisionOptions as p}
										<option value={p}>{p}</option>
									{/each}
								</select>
							</div>

							<div class="form-group">
								<label for="heatmap-norm">Heatmap normalization</label>
								<select id="heatmap-norm" bind:value={draft.globalHeatmapNormalization}>
									<option value={false}>Local</option>
									<option value={true}>Global</option>
								</select>
							</div>

							<div class="checkbox-group">
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.showDimensions} />
									<span>Show dimensions</span>
								</label>
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.showGrid} />
									<span>Show grid</span>
								</label>
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.showPhotometricWebs} />
									<span>Show photometric webs</span>
								</label>
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.showXYZMarker} />
									<span>Show XYZ marker</span>
								</label>
							</div>
						</div>
					</section>

				{:else if activeTab === 'room'}
					<section class="settings-section">
						<h4>New Project Defaults</h4>
						<div class="section-content">
							<div class="form-group">
								<label for="units">Units</label>
								<select id="units" bind:value={draft.units}>
									<option value="meters">Meters</option>
									<option value="feet">Feet</option>
								</select>
							</div>

							<div class="form-group">
								<label for="standard">Safety standard</label>
								<select id="standard" bind:value={draft.standard}>
									<option value="ACGIH">ACGIH</option>
									<option value="ACGIH-UL8802">ACGIH-UL8802</option>
									<option value="ICNIRP">ICNIRP</option>
								</select>
							</div>

							<div class="form-row-3">
								<div class="form-group">
									<label for="room-x">Room X ({draft.units === 'meters' ? 'm' : 'ft'})</label>
									<input id="room-x" type="number" bind:value={draft.roomX} min="0.1" step="0.1" />
								</div>
								<div class="form-group">
									<label for="room-y">Room Y ({draft.units === 'meters' ? 'm' : 'ft'})</label>
									<input id="room-y" type="number" bind:value={draft.roomY} min="0.1" step="0.1" />
								</div>
								<div class="form-group">
									<label for="room-z">Room Z ({draft.units === 'meters' ? 'm' : 'ft'})</label>
									<input id="room-z" type="number" bind:value={draft.roomZ} min="0.1" step="0.1" />
								</div>
							</div>

							<div class="form-group">
								<label for="reflectance">Default reflectance</label>
								<div class="input-with-buttons">
									<input id="reflectance" type="number" bind:value={draft.reflectance} min="0" max="1" step="0.001" />
									<button class="secondary small" onclick={() => draft.reflectance = 0.078} title="222nm default">222nm</button>
									<button class="secondary small" onclick={() => draft.reflectance = 0.05} title="254nm default">254nm</button>
								</div>
							</div>

							<div class="form-group">
								<label for="air-changes">Air changes per hour</label>
								<input id="air-changes" type="number" bind:value={draft.airChanges} min="0" step="0.1" />
							</div>

							<div class="checkbox-group">
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.enableReflectance} />
									<span>Enable reflectance by default</span>
								</label>
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.useStandardZones} />
									<span>Auto-create standard zones</span>
								</label>
							</div>
						</div>
					</section>

				{:else if activeTab === 'lamp'}
					<section class="settings-section">
						<h4>New Lamp Defaults</h4>
						<div class="section-content">
							<div class="form-group">
								<label for="lamp-type">Default lamp type</label>
								<select id="lamp-type" bind:value={draft.lampType} onchange={() => {
									// Reset preset when switching away from 222nm
									if (draft.lampType !== 'krcl_222') {
										draft.lampPreset222 = '';
									}
								}}>
									<option value="krcl_222">Krypton chloride (222 nm)</option>
									<option value="lp_254">Low-pressure mercury (254 nm)</option>
									<option value="other">Other (custom wavelength)</option>
								</select>
							</div>

							{#if draft.lampType === 'krcl_222'}
								<div class="form-group">
									<label for="lamp-preset">Default 222nm preset</label>
									{#if presetsLoading}
										<select id="lamp-preset" disabled>
											<option>Loading...</option>
										</select>
									{:else}
										<select id="lamp-preset" bind:value={draft.lampPreset222}>
											<option value="">None (select each time)</option>
											{#each presets222 as preset}
												<option value={preset.id}>{preset.name}</option>
											{/each}
											<option value="custom">Custom (file upload)</option>
										</select>
									{/if}
								</div>
							{/if}

							<div class="form-group">
								<label for="lamp-placement">Default placement</label>
								<select id="lamp-placement" bind:value={draft.lampPlacement}>
									{#each placementOptions as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>
						</div>
					</section>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="modal-footer">
			<button class="secondary" onclick={resetToDefaults}>Reset to Defaults</button>
			<div class="footer-right">
				<button class="secondary" onclick={onClose}>Cancel</button>
				<button class="primary" onclick={save}>Save</button>
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	.modal-body {
		padding: var(--spacing-lg);
	}

	.modal-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-lg);
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.footer-right {
		display: flex;
		gap: var(--spacing-sm);
	}

	.modal-footer button.primary {
		background: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
	}

	.modal-footer button.primary:hover {
		background: var(--color-accent-hover);
	}

	/* Tab bar */
	.settings-tabs {
		display: flex;
		gap: var(--spacing-xs);
		border-bottom: 1px solid var(--color-border);
		margin-bottom: var(--spacing-lg);
	}

	.tab-btn {
		padding: var(--spacing-sm) var(--spacing-md);
		border: none;
		background: none;
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
		cursor: pointer;
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
		border-bottom: 2px solid transparent;
		transition: color 0.15s, border-color 0.15s;
	}

	.tab-btn:hover {
		color: var(--color-text);
	}

	.tab-btn.active {
		color: var(--color-text);
		border-bottom-color: var(--color-accent);
		font-weight: 500;
	}

	/* Tab content area */
	.settings-content {
		min-height: 320px;
	}

	/* Section heading + card pattern (matches AdvancedLampTab) */
	.settings-section h4 {
		margin: 0 0 var(--spacing-sm) 0;
		font-size: var(--font-size-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.section-content {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-lg);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	/* Form group (label above input) */
	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.form-group label {
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-text-muted);
		margin-bottom: 0;
	}

	.form-group select,
	.form-group input[type="number"] {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-base);
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	/* 3-column grid (matches AdvancedLampTab .form-row-3) */
	.form-row-3 {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: var(--spacing-md);
	}

	/* Checkbox group */
	.checkbox-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-xs);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-base);
		color: var(--color-text);
		cursor: pointer;
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
	}

	/* Input with inline quick-set buttons */
	.input-with-buttons {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.input-with-buttons input {
		flex: 1;
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-base);
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.input-with-buttons button.small {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-xs);
		white-space: nowrap;
	}
</style>
