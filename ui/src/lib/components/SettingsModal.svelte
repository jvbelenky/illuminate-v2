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

	type Tab = 'room' | 'lamps' | 'zones' | 'display';
	let activeTab = $state<Tab>('room');

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
		{ value: 'vertical_dir', label: 'Vertical (Dir.)' },
		{ value: 'vertical', label: 'Vertical' },
	];

	const planeDisplayModeOptions: { value: ZoneDisplayMode; label: string }[] = [
		{ value: 'heatmap', label: 'Heatmap' },
		{ value: 'numeric', label: 'Numeric' },
		{ value: 'markers', label: 'Markers' },
		{ value: 'none', label: 'None' },
	];

	const volumeDisplayModeOptions: { value: ZoneDisplayMode; label: string }[] = [
		{ value: 'heatmap', label: 'Isosurface' },
		{ value: 'markers', label: 'Markers' },
		{ value: 'none', label: 'None' },
	];

	const placementOptions: { value: PlacementMode; label: string }[] = [
		{ value: 'downlight', label: 'Downlight' },
		{ value: 'corner', label: 'Corner' },
		{ value: 'edge', label: 'Edge' },
		{ value: 'horizontal', label: 'Horizontal' },
	];

	function save() {
		userSettings.set({ ...draft });
		onClose();
	}

	function resetToDefaults() {
		draft = { ...SETTINGS_DEFAULTS };
	}
</script>

<Modal title="Settings" {onClose} maxWidth="560px">
	{#snippet body()}
		<div class="modal-body">
			<div class="settings-tabs">
				<button class="tab-btn" class:active={activeTab === 'room'} onclick={() => activeTab = 'room'}>Room</button>
				<button class="tab-btn" class:active={activeTab === 'lamps'} onclick={() => activeTab = 'lamps'}>Lamps</button>
				<button class="tab-btn" class:active={activeTab === 'zones'} onclick={() => activeTab = 'zones'}>Zones</button>
				<button class="tab-btn" class:active={activeTab === 'display'} onclick={() => activeTab = 'display'}>Display</button>
			</div>

			<div class="settings-content">
				{#if activeTab === 'room'}
					<!-- Units & Dimensions -->
					<section class="settings-section">
						<h4>Units & Dimensions</h4>
						<div class="section-content">
							<div class="form-inline">
								<label for="units">Units</label>
								<select id="units" class="compact" bind:value={draft.units}>
									<option value="meters">Meters</option>
									<option value="feet">Feet</option>
								</select>
							</div>
							<div class="form-row-3">
								<div class="form-group">
									<label for="room-x">X ({draft.units === 'meters' ? 'm' : 'ft'})</label>
									<input id="room-x" type="number" bind:value={draft.roomX} min="0.1" step="0.1" />
								</div>
								<div class="form-group">
									<label for="room-y">Y ({draft.units === 'meters' ? 'm' : 'ft'})</label>
									<input id="room-y" type="number" bind:value={draft.roomY} min="0.1" step="0.1" />
								</div>
								<div class="form-group">
									<label for="room-z">Z ({draft.units === 'meters' ? 'm' : 'ft'})</label>
									<input id="room-z" type="number" bind:value={draft.roomZ} min="0.1" step="0.1" />
								</div>
							</div>
						</div>
					</section>

					<!-- Safety & Environment -->
					<section class="settings-section">
						<h4>Safety & Environment</h4>
						<div class="section-content">
							<div class="form-inline">
								<label for="standard">Safety standard</label>
								<select id="standard" class="compact" bind:value={draft.standard}>
									<option value="ACGIH">ACGIH</option>
									<option value="ACGIH-UL8802">ACGIH-UL8802</option>
									<option value="ICNIRP">ICNIRP</option>
								</select>
							</div>
							<div class="form-inline">
								<label for="air-changes">Air changes / hr</label>
								<input id="air-changes" type="number" class="compact-input" bind:value={draft.airChanges} min="0" step="0.1" />
							</div>
							<label class="checkbox-label">
								<input type="checkbox" bind:checked={draft.useStandardZones} />
								<span>Auto-create standard zones</span>
							</label>
						</div>
					</section>

					<!-- Reflectance -->
					<section class="settings-section">
						<h4>Reflectance</h4>
						<div class="section-content">
							<div class="form-inline">
								<label for="reflectance">Value</label>
								<div class="input-with-buttons">
									<input id="reflectance" type="number" bind:value={draft.reflectance} min="0" max="1" step="0.001" />
									<button class="secondary small" onclick={() => draft.reflectance = 0.078} title="222nm default">222nm</button>
									<button class="secondary small" onclick={() => draft.reflectance = 0.05} title="254nm default">254nm</button>
								</div>
							</div>
							<label class="checkbox-label">
								<input type="checkbox" bind:checked={draft.enableReflectance} />
								<span>Enable by default</span>
							</label>
						</div>
					</section>

				{:else if activeTab === 'lamps'}
					<section class="settings-section">
						<h4>New Lamp Defaults</h4>
						<div class="section-content">
							<div class="form-inline">
								<label for="lamp-type">Lamp type</label>
								<select id="lamp-type" class="compact" bind:value={draft.lampType} onchange={() => {
									if (draft.lampType !== 'krcl_222') {
										draft.lampPreset222 = '';
									}
								}}>
									<option value="krcl_222">222 nm (KrCl)</option>
									<option value="lp_254">254 nm (LP Hg)</option>
									<option value="other">Other (custom)</option>
								</select>
							</div>

							{#if draft.lampType === 'krcl_222'}
								<div class="form-inline">
									<label for="lamp-preset">222nm preset</label>
									{#if presetsLoading}
										<select id="lamp-preset" class="compact" disabled>
											<option>Loading...</option>
										</select>
									{:else}
										<select id="lamp-preset" class="compact" bind:value={draft.lampPreset222}>
											<option value="">None</option>
											{#each presets222 as preset}
												<option value={preset.id}>{preset.name}</option>
											{/each}
											<option value="custom">Custom (upload)</option>
										</select>
									{/if}
								</div>
							{/if}

							<div class="form-inline">
								<label for="lamp-placement">Placement</label>
								<select id="lamp-placement" class="compact" bind:value={draft.lampPlacement}>
									{#each placementOptions as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>
						</div>
					</section>

				{:else if activeTab === 'zones'}
					<!-- Shared zone settings -->
					<section class="settings-section">
						<h4>General</h4>
						<div class="section-content">
							<div class="form-row-2">
								<div class="form-inline">
									<label for="zone-type">Default type</label>
									<select id="zone-type" class="compact" bind:value={draft.zoneType}>
										<option value="plane">Plane</option>
										<option value="volume">Volume</option>
									</select>
								</div>
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.zoneOffset} />
									<span>Boundary offset</span>
								</label>
							</div>
							<div class="form-row-2">
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.zoneDose} />
									<span>Dose mode</span>
								</label>
								<div class="form-inline">
									<label for="zone-hours">Hours</label>
									<input id="zone-hours" type="number" class="compact-input" bind:value={draft.zoneHours} min="0.1" max="24" step="0.1" />
								</div>
							</div>
						</div>
					</section>

					<!-- Plane defaults -->
					<section class="settings-section">
						<h4>Plane Defaults</h4>
						<div class="section-content">
							<div class="form-row-2">
								<div class="form-inline">
									<label for="plane-display">Display</label>
									<select id="plane-display" class="compact" bind:value={draft.planeDisplayMode}>
										{#each planeDisplayModeOptions as opt}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								</div>
								<div class="form-inline">
									<label for="zone-calc-type">Calc type</label>
									<select id="zone-calc-type" class="compact" bind:value={draft.zoneCalcType}>
										{#each calcTypeOptions as opt}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								</div>
							</div>
						</div>
					</section>

					<!-- Volume defaults -->
					<section class="settings-section">
						<h4>Volume Defaults</h4>
						<div class="section-content">
							<div class="form-inline">
								<label for="volume-display">Display</label>
								<select id="volume-display" class="compact" bind:value={draft.volumeDisplayMode}>
									{#each volumeDisplayModeOptions as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>
						</div>
					</section>

				{:else if activeTab === 'display'}
					<!-- Zone Heatmap settings -->
					<section class="settings-section">
						<h4>Zone Heatmap</h4>
						<div class="section-content">
							<div class="form-inline">
								<label for="colormap">Colormap</label>
								<select id="colormap" class="compact" bind:value={draft.colormap}>
									{#each colormapOptions as cm}
										<option value={cm}>{cm}</option>
									{/each}
								</select>
							</div>
							<div class="form-inline">
								<label for="heatmap-norm">Normalization</label>
								<select id="heatmap-norm" class="compact" bind:value={draft.globalHeatmapNormalization}>
									<option value={false}>Local (per zone)</option>
									<option value={true}>Global (all zones)</option>
								</select>
							</div>
						</div>
					</section>

					<!-- Numeric display -->
					<section class="settings-section">
						<h4>Numeric Display</h4>
						<div class="section-content">
							<div class="form-inline">
								<label for="precision">Decimal precision</label>
								<select id="precision" class="compact-sm" bind:value={draft.precision}>
									{#each Array(10) as _, p}
										<option value={p}>{p}</option>
									{/each}
								</select>
							</div>
						</div>
					</section>

					<!-- Overlays -->
					<section class="settings-section">
						<h4>Overlays</h4>
						<div class="section-content">
							<div class="checkbox-grid">
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.showDimensions} />
									<span>Dimensions</span>
								</label>
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.showGrid} />
									<span>Grid</span>
								</label>
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.showPhotometricWebs} />
									<span>Photometric webs</span>
								</label>
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.showXYZMarker} />
									<span>XYZ marker</span>
								</label>
							</div>
						</div>
					</section>

					<!-- Behavior -->
					<section class="settings-section">
						<h4>Behavior</h4>
						<div class="section-content">
							<label class="checkbox-label">
								<input type="checkbox" bind:checked={draft.autoRecalculate} />
								<span>Auto-recalculate on changes</span>
							</label>
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
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		min-height: 280px;
	}

	/* Section heading + card pattern */
	.settings-section h4 {
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

	/* Inline form row: label left, control right */
	.form-inline {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.form-inline > label {
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-text-muted);
		white-space: nowrap;
		min-width: fit-content;
	}

	/* Compact select (auto-width, not full-width) */
	select.compact {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm);
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		flex: 1;
		min-width: 0;
	}

	select.compact-sm {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm);
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		width: 60px;
	}

	/* Compact number input */
	.compact-input {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm);
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		width: 70px;
	}

	/* Stacked form group (label above input) — for dimension inputs */
	.form-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.form-group label {
		font-size: var(--font-size-xs);
		font-weight: 500;
		color: var(--color-text-muted);
		margin-bottom: 0;
	}

	.form-group input[type="number"] {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm);
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	/* Grid layouts */
	.form-row-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-sm);
		align-items: center;
	}

	.form-row-3 {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: var(--spacing-sm);
	}

	/* Checkbox styling */
	.checkbox-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.checkbox-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-xs);
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

	/* Input with inline quick-set buttons */
	.input-with-buttons {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		flex: 1;
		min-width: 0;
	}

	.input-with-buttons input {
		flex: 1;
		min-width: 0;
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm);
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.input-with-buttons button.small {
		padding: 2px var(--spacing-xs);
		font-size: var(--font-size-xs);
		white-space: nowrap;
	}
</style>
