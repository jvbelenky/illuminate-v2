<script lang="ts">
	import Modal from './Modal.svelte';
	import { userSettings, SETTINGS_DEFAULTS, type UserSettings } from '$lib/stores/settings';
	import type { PlaneCalcType, ZoneDisplayMode } from '$lib/types/project';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// Work on a draft copy; only commit on Save
	let draft = $state<UserSettings>({ ...$userSettings });

	type Tab = 'zones' | 'display' | 'room';
	let activeTab = $state<Tab>('zones');

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

	const precisionOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

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
		<div class="settings-tabs">
			<button class="tab-btn" class:active={activeTab === 'zones'} onclick={() => activeTab = 'zones'}>Zones</button>
			<button class="tab-btn" class:active={activeTab === 'display'} onclick={() => activeTab = 'display'}>Display</button>
			<button class="tab-btn" class:active={activeTab === 'room'} onclick={() => activeTab = 'room'}>Room</button>
		</div>

		<div class="settings-content">
			{#if activeTab === 'zones'}
				<div class="settings-form">
					<div class="form-row">
						<label for="zone-type">Default zone type</label>
						<select id="zone-type" bind:value={draft.zoneType}>
							<option value="plane">Plane</option>
							<option value="volume">Volume</option>
						</select>
					</div>

					<div class="form-row">
						<label for="zone-display">Default display mode</label>
						<select id="zone-display" bind:value={draft.zoneDisplayMode}>
							{#each displayModeOptions as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>

					<div class="form-row">
						<label for="zone-offset">Boundary offset</label>
						<select id="zone-offset" bind:value={draft.zoneOffset}>
							<option value={true}>On</option>
							<option value={false}>Off</option>
						</select>
					</div>

					<div class="form-row">
						<label for="zone-calc-type">Default calc type</label>
						<select id="zone-calc-type" bind:value={draft.zoneCalcType}>
							{#each calcTypeOptions as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>

					<div class="form-row">
						<label for="zone-dose">Default dose mode</label>
						<select id="zone-dose" bind:value={draft.zoneDose}>
							<option value={false}>Off</option>
							<option value={true}>On</option>
						</select>
					</div>

					{#if draft.zoneDose}
						<div class="form-row">
							<label for="zone-hours">Default exposure hours</label>
							<input id="zone-hours" type="number" bind:value={draft.zoneHours} min="0.1" max="24" step="0.1" />
						</div>
					{/if}
				</div>

			{:else if activeTab === 'display'}
				<div class="settings-form">
					<div class="form-row">
						<label for="colormap">Default colormap</label>
						<select id="colormap" bind:value={draft.colormap}>
							{#each colormapOptions as cm}
								<option value={cm}>{cm}</option>
							{/each}
						</select>
					</div>

					<div class="form-row">
						<label for="precision">Decimal precision</label>
						<select id="precision" bind:value={draft.precision}>
							{#each precisionOptions as p}
								<option value={p}>{p}</option>
							{/each}
						</select>
					</div>

					<div class="form-row">
						<label for="heatmap-norm">Heatmap normalization</label>
						<select id="heatmap-norm" bind:value={draft.globalHeatmapNormalization}>
							<option value={false}>Local</option>
							<option value={true}>Global</option>
						</select>
					</div>

					<div class="form-row checkbox-row">
						<label>
							<input type="checkbox" bind:checked={draft.showDimensions} />
							Show dimensions
						</label>
					</div>

					<div class="form-row checkbox-row">
						<label>
							<input type="checkbox" bind:checked={draft.showGrid} />
							Show grid
						</label>
					</div>

					<div class="form-row checkbox-row">
						<label>
							<input type="checkbox" bind:checked={draft.showPhotometricWebs} />
							Show photometric webs
						</label>
					</div>

					<div class="form-row checkbox-row">
						<label>
							<input type="checkbox" bind:checked={draft.showXYZMarker} />
							Show XYZ marker
						</label>
					</div>
				</div>

			{:else if activeTab === 'room'}
				<div class="settings-form">
					<div class="form-row">
						<label for="units">Default units</label>
						<select id="units" bind:value={draft.units}>
							<option value="meters">Meters</option>
							<option value="feet">Feet</option>
						</select>
					</div>

					<div class="form-row">
						<label for="standard">Default safety standard</label>
						<select id="standard" bind:value={draft.standard}>
							<option value="ACGIH">ACGIH</option>
							<option value="ACGIH-UL8802">ACGIH-UL8802</option>
							<option value="ICNIRP">ICNIRP</option>
						</select>
					</div>

					<div class="form-row">
						<label for="room-x">Room X ({draft.units === 'meters' ? 'm' : 'ft'})</label>
						<input id="room-x" type="number" bind:value={draft.roomX} min="0.1" step="0.1" />
					</div>

					<div class="form-row">
						<label for="room-y">Room Y ({draft.units === 'meters' ? 'm' : 'ft'})</label>
						<input id="room-y" type="number" bind:value={draft.roomY} min="0.1" step="0.1" />
					</div>

					<div class="form-row">
						<label for="room-z">Room Z ({draft.units === 'meters' ? 'm' : 'ft'})</label>
						<input id="room-z" type="number" bind:value={draft.roomZ} min="0.1" step="0.1" />
					</div>

					<div class="form-row">
						<label for="reflectance">Default reflectance</label>
						<div class="input-with-buttons">
							<input id="reflectance" type="number" bind:value={draft.reflectance} min="0" max="1" step="0.001" />
							<button class="quick-set-btn" onclick={() => draft.reflectance = 0.078} title="222nm default">222nm</button>
							<button class="quick-set-btn" onclick={() => draft.reflectance = 0.05} title="254nm default">254nm</button>
						</div>
					</div>

					<div class="form-row">
						<label for="air-changes">Air changes per hour</label>
						<input id="air-changes" type="number" bind:value={draft.airChanges} min="0" step="0.1" />
					</div>

					<div class="form-row checkbox-row">
						<label>
							<input type="checkbox" bind:checked={draft.useStandardZones} />
							Auto-create standard zones
						</label>
					</div>
				</div>
			{/if}
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="settings-footer">
			<button class="secondary" onclick={resetToDefaults}>Reset to Defaults</button>
			<div class="footer-right">
				<button class="secondary" onclick={onClose}>Cancel</button>
				<button class="primary" onclick={save}>Save</button>
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	.settings-tabs {
		display: flex;
		gap: var(--spacing-xs);
		border-bottom: 1px solid var(--color-border);
		padding-bottom: var(--spacing-xs);
		margin-bottom: var(--spacing-md);
	}

	.tab-btn {
		padding: var(--spacing-xs) var(--spacing-sm);
		border: none;
		background: none;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
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
		border-bottom-color: var(--color-accent, #6c8bd5);
		font-weight: 500;
	}

	.settings-content {
		min-height: 260px;
	}

	.settings-form {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.form-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.form-row > label:first-child {
		flex: 0 0 180px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.form-row select,
	.form-row input[type="number"] {
		flex: 1;
		padding: 4px 6px;
		font-size: var(--font-size-sm);
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.checkbox-row {
		justify-content: flex-start;
	}

	.checkbox-row label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		cursor: pointer;
	}

	.input-with-buttons {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.input-with-buttons input {
		flex: 1;
		padding: 4px 6px;
		font-size: var(--font-size-sm);
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.quick-set-btn {
		padding: 3px 8px;
		font-size: var(--font-size-xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		cursor: pointer;
		white-space: nowrap;
	}

	.quick-set-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.settings-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
	}

	.footer-right {
		display: flex;
		gap: var(--spacing-xs);
	}

	.settings-footer button {
		padding: 6px 16px;
		font-size: var(--font-size-sm);
		border-radius: var(--radius-sm);
		cursor: pointer;
		border: 1px solid var(--color-border);
	}

	.settings-footer button.primary {
		background: var(--color-accent, #6c8bd5);
		color: white;
		border-color: var(--color-accent, #6c8bd5);
	}

	.settings-footer button.primary:hover {
		opacity: 0.9;
	}

	.settings-footer button.secondary {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.settings-footer button.secondary:hover {
		background: var(--color-bg-tertiary);
	}
</style>
