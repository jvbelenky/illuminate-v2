<script lang="ts">
	import { project, lamps, fetchStateHashesDebounced } from '$lib/stores/project';
	import { getLampOptions, placeSessionLamp, removeSessionLampSpectrum, removeSessionLampIes } from '$lib/api/client';
	import type { LampInstance, RoomConfig, LampPresetInfo, LampType } from '$lib/types/project';
	import { displayDimension } from '$lib/utils/formatting';
	import { onMount, onDestroy } from 'svelte';
	import LampInfoModal from './LampInfoModal.svelte';
	import AdvancedLampSettingsModal from './AdvancedLampSettingsModal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { getDownlightPlacement, getCornerPlacement, getEdgePlacement, getNextCornerIndex, getNextEdgeIndex, type PlacementMode } from '$lib/utils/lampPlacement';
	import { rovingTabindex } from '$lib/actions/rovingTabindex';

	interface Props {
		lamp: LampInstance;
		room: RoomConfig;
		onClose: () => void;
		onCopy?: (newId: string) => void;
	}

	let { lamp, room, onClose, onCopy }: Props = $props();

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
	let angle = $state(lamp.angle ?? 0);
	let aimx = $state(lamp.aimx);
	let aimy = $state(lamp.aimy);
	let aimz = $state(lamp.aimz);

	// Track previous position to detect user-driven position changes.
	// During placement, update prevX/prevY/prevZ BEFORE x/y/z so the
	// aim-translation $effect sees dx=0 and skips the translation.
	let prevX = $state(lamp.x);
	let prevY = $state(lamp.y);
	let prevZ = $state(lamp.z);

	// Tilt/orientation mode state
	let useTiltMode = $state(false);
	let tilt = $state(lamp.tilt ?? 0);
	let orientation = $state(lamp.orientation ?? 0);
	// True when tilt/orientation changed via direct user edit (not placement or aim recomputation)
	let tiltOrientationEdited = false;

	// "Other" lamp type state
	let wavelength = $state(lamp.wavelength ?? 280);
	let wavelengthFromSpectrum = $state(lamp.wavelength_from_spectrum ?? false);

	// File uploads for custom lamps
	let iesFile: File | null = $state(null);
	let spectrumFile: File | null = $state(null);
	let iesFileInput: HTMLInputElement;
	let spectrumFileInput: HTMLInputElement;

	// Modal states
	let showInfoModal = $state(false);
	let showAdvancedModal = $state(false);
	let showDeleteConfirm = $state(false);

	// Placement mode state
	let cornerIndex = $state(-1);
	let edgeIndex = $state(-1);
	let placingMode = $state<PlacementMode | null>(null);

	// Get other lamps (excluding current lamp)
	const otherLamps = $derived($lamps.filter(l => l.id !== lamp.id));

	const showHorizontalButton = true;

	async function applyPlacement(mode: PlacementMode) {
		placingMode = mode;
		try {
			// Determine position_index for strict cycling, skipping occupied positions
			let positionIndex: number | undefined;
			if (mode === 'corner') {
				positionIndex = getNextCornerIndex(room, otherLamps, cornerIndex);
			} else if (mode === 'edge' || mode === 'horizontal') {
				positionIndex = getNextEdgeIndex(room, otherLamps, edgeIndex);
			}
			// downlight: no positionIndex → legacy best-available

			const result = await placeSessionLamp(lamp.id, mode, positionIndex);
			// Round placement coordinates to room precision so UI doesn't show long decimals
			const p = room.precision;
			const r = (v: number) => parseFloat(v.toFixed(p));
			// Set prev values first so the aim-translation effect sees dx=0
			prevX = r(result.x);
			prevY = r(result.y);
			prevZ = r(result.z);
			x = r(result.x);
			y = r(result.y);
			z = r(result.z);
			angle = result.angle ?? 0;
			aimx = r(result.aimx);
			aimy = r(result.aimy);
			aimz = r(result.aimz);
			// Update tilt/orientation from placement result
			if (useTiltMode) {
				tilt = result.tilt;
				orientation = result.orientation;
			}

			// Update cycling index from server response
			if (mode === 'corner') {
				cornerIndex = result.position_index;
				edgeIndex = -1;
			} else if (mode === 'edge' || mode === 'horizontal') {
				edgeIndex = result.position_index;
				cornerIndex = -1;
			} else {
				cornerIndex = -1;
				edgeIndex = -1;
			}
		} catch {
			// Fall back to local TS placement functions
			applyLocalPlacement(mode);
		} finally {
			placingMode = null;
		}
	}

	function applyLocalPlacement(mode: PlacementMode) {
		let placement;
		switch (mode) {
			case 'corner':
				placement = getCornerPlacement(room, otherLamps, cornerIndex);
				cornerIndex = placement.nextIndex;
				edgeIndex = -1;
				break;
			case 'edge':
				placement = getEdgePlacement(room, otherLamps, edgeIndex);
				edgeIndex = placement.nextIndex;
				cornerIndex = -1;
				break;
			case 'horizontal':
				// Horizontal fallback: use edge placement but aim at lamp height
				placement = getEdgePlacement(room, otherLamps, edgeIndex);
				placement.aimz = placement.z;
				edgeIndex = placement.nextIndex;
				cornerIndex = -1;
				break;
			case 'downlight':
			default:
				placement = getDownlightPlacement(room, otherLamps);
				cornerIndex = -1;
				edgeIndex = -1;
				break;
		}
		// Round placement coordinates to room precision so UI doesn't show long decimals
		const p = room.precision;
		const r = (v: number) => parseFloat(v.toFixed(p));
		// Set prev values first so the aim-translation effect sees dx=0
		prevX = r(placement.x);
		prevY = r(placement.y);
		prevZ = r(placement.z);
		x = r(placement.x);
		y = r(placement.y);
		z = r(placement.z);
		aimx = r(placement.aimx);
		aimy = r(placement.aimy);
		aimz = r(placement.aimz);
		// Recompute tilt/orientation if in tilt mode
		if (useTiltMode) {
			const result = computeTiltOrientation(x, y, z, aimx, aimy, aimz);
			tilt = result.tilt;
			orientation = result.orientation;
		}
	}

	// Derived state
	let isCustomLamp = $derived(preset_id === 'custom' || lamp_type === 'lp_254' || lamp_type === 'other');
	let isPresetLamp = $derived(preset_id !== '' && preset_id !== 'custom');
	let needsIesFile = $derived(
		(lamp_type === 'lp_254' || lamp_type === 'other' || preset_id === 'custom') && !lamp.has_ies_file
	);
	let canUploadSpectrum = $derived((lamp_type === 'krcl_222' && preset_id === 'custom') || lamp_type === 'other');
	// Lamp has photometric data (preset selected or IES uploaded)
	let hasPhotometry = $derived(
		(preset_id !== '' && preset_id !== 'custom' && lamp_type === 'krcl_222') ||
		lamp.has_ies_file ||
		lamp.has_spectrum_file
	);
	// Get the display name for the current preset
	let presetDisplayName = $derived(
		presets.find(p => p.id === preset_id)?.name
	);

	// Auto-save when any field changes (debounced to prevent cascading updates)
	let saveTimeout: ReturnType<typeof setTimeout>;
	let isInitialized = false;

	// Watch for store updates from spectrum upload (peak_wavelength)
	$effect(() => {
		if (lamp.wavelength != null && lamp_type === 'other') wavelength = lamp.wavelength;
		if (lamp.wavelength_from_spectrum != null) wavelengthFromSpectrum = lamp.wavelength_from_spectrum;
	});

	$effect(() => {
		// Read all values to track them
		const updates: Record<string, unknown> = {
			lamp_type,
			preset_id: (lamp_type === 'lp_254' || lamp_type === 'other') ? 'custom' : preset_id,
			x,
			y,
			z,
			angle,
			aimx,
			aimy,
			aimz,
			pending_ies_file: iesFile || undefined,
			pending_spectrum_file: spectrumFile || undefined
		};

		// Include wavelength for "other" type
		if (lamp_type === 'other') {
			updates.wavelength = wavelength;
		}

		// Only include tilt/orientation when the user directly edited them,
		// not after placement or aim-point changes that recompute them as a side effect.
		// This prevents set_tilt/set_orientation from overriding the aim point on the backend.
		if (useTiltMode && tiltOrientationEdited) {
			updates.tilt = tilt;
			updates.orientation = orientation;
		}

		// Skip the initial run
		if (!isInitialized) {
			isInitialized = true;
			return;
		}

		// Debounce updates to prevent cascading re-renders
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			tiltOrientationEdited = false;
			// Always sync position/aim updates - these are independent of photometry
			project.updateLamp(lamp.id, updates);
		}, 100);
	});

	// Translate aim point when position changes (preserves tilt/orientation).
	// During placement, prevX/prevY/prevZ are set to the new values BEFORE
	// x/y/z, so dx=0 and the translation is skipped automatically.
	$effect(() => {
		const dx = x - prevX;
		const dy = y - prevY;
		const dz = z - prevZ;
		if (dx !== 0 || dy !== 0 || dz !== 0) {
			aimx += dx;
			aimy += dy;
			aimz += dz;
			prevX = x;
			prevY = y;
			prevZ = z;
		}
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
		showDeleteConfirm = true;
	}

	async function copy() {
		try {
			const newId = await project.copyLamp(lamp.id);
			onClose();
			onCopy?.(newId);
		} catch (e) {
			console.error('Failed to copy lamp:', e);
		}
	}

	// Quick aim presets (aim point, not direction)
	function aimDown() {
		aimx = x;
		aimy = y;
		aimz = 0;
		if (useTiltMode) {
			const result = computeTiltOrientation(x, y, z, aimx, aimy, aimz);
			tilt = result.tilt;
			orientation = result.orientation;
		}
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
		if (useTiltMode) {
			const result = computeTiltOrientation(x, y, z, aimx, aimy, aimz);
			tilt = result.tilt;
			orientation = result.orientation;
		}
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
		if (useTiltMode) {
			const result = computeTiltOrientation(x, y, z, aimx, aimy, aimz);
			tilt = result.tilt;
			orientation = result.orientation;
		}
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

	// Compute tilt (bank) and orientation (heading) from lamp position and aim point
	// Mirrors guv_calcs LampOrientation.heading / .bank
	function computeTiltOrientation(
		lx: number, ly: number, lz: number,
		ax: number, ay: number, az: number
	): { tilt: number; orientation: number } {
		const dx = ax - lx;
		const dy = ay - ly;
		const dz = az - lz;
		const horizontalDist = Math.sqrt(dx * dx + dy * dy);

		// Bank: angle from straight down (0°=down, 90°=horizontal, 180°=up)
		// atan2(horizontal_distance, -dz) gives angle from downward axis
		let bankDeg = Math.atan2(horizontalDist, -dz) * (180 / Math.PI);
		bankDeg = Math.max(0, Math.min(180, bankDeg));

		// Heading: math convention (0°=+X, 90°=+Y, 180°=-X, 270°=-Y)
		// Matches guv_calcs atan2(dy, dx)
		let headingDeg = Math.atan2(dy, dx) * (180 / Math.PI);
		if (headingDeg < 0) headingDeg += 360;

		return { tilt: bankDeg, orientation: headingDeg };
	}

	// Compute aim point from tilt/orientation and lamp position
	// Mirrors guv_calcs LampOrientation.recalculate_aim_point with dimensions
	function computeAimFromTiltOrientation(
		lx: number, ly: number, lz: number,
		tiltDeg: number, orientDeg: number,
		roomX: number, roomY: number, roomZ: number
	): { aimx: number; aimy: number; aimz: number } {
		const tiltRad = tiltDeg * (Math.PI / 180);
		const orientRad = orientDeg * (Math.PI / 180);

		// Direction vector: tilt from down, orientation as math heading
		// Matches guv_calcs recalculate_aim_point: x = cos(orient), y = sin(orient)
		const dirX = Math.sin(tiltRad) * Math.cos(orientRad);
		const dirY = Math.sin(tiltRad) * Math.sin(orientRad);
		const dirZ = -Math.cos(tiltRad);

		// Use room dimensions to project to a meaningful aim point
		// Find intersection with room boundary in the aim direction
		const dims = [roomX, roomY, roomZ];
		const pos = [lx, ly, lz];
		const dir = [dirX, dirY, dirZ];

		let minT = Infinity;
		for (let i = 0; i < 3; i++) {
			if (dir[i] > 1e-10) {
				const t = (dims[i] - pos[i]) / dir[i];
				if (t > 0 && t < minT) minT = t;
			} else if (dir[i] < -1e-10) {
				const t = -pos[i] / dir[i];
				if (t > 0 && t < minT) minT = t;
			}
		}

		if (!isFinite(minT) || minT <= 0) {
			// Fallback: aim straight down
			return { aimx: lx, aimy: ly, aimz: 0 };
		}

		return {
			aimx: lx + dirX * minT,
			aimy: ly + dirY * minT,
			aimz: lz + dirZ * minT,
		};
	}

	function switchToTiltMode() {
		// Compute tilt/orientation from current aim point
		const result = computeTiltOrientation(x, y, z, aimx, aimy, aimz);
		tilt = result.tilt;
		orientation = result.orientation;
		useTiltMode = true;
	}

	function switchToAimMode() {
		useTiltMode = false;
	}

	function handleTiltChange(newTilt: number) {
		tilt = newTilt;
		tiltOrientationEdited = true;
		// Update aim point from tilt/orientation
		const result = computeAimFromTiltOrientation(x, y, z, tilt, orientation, room.x, room.y, room.z);
		aimx = result.aimx;
		aimy = result.aimy;
		aimz = result.aimz;
	}

	function handleOrientationChange(newOrientation: number) {
		orientation = newOrientation;
		tiltOrientationEdited = true;
		// Update aim point from tilt/orientation
		const result = computeAimFromTiltOrientation(x, y, z, tilt, orientation, room.x, room.y, room.z);
		aimx = result.aimx;
		aimy = result.aimy;
		aimz = result.aimz;
	}

	// Derived tilt/orientation for read-only display when in aim point mode
	let derivedTiltOrientation = $derived(computeTiltOrientation(x, y, z, aimx, aimy, aimz));

	function handleLampTypeChange() {
		if (lamp_type === 'lp_254') {
			preset_id = 'custom';
		} else if (lamp_type === 'other') {
			preset_id = 'custom';
			wavelengthFromSpectrum = false;
		} else if (preset_id === 'custom' || !preset_id) {
			preset_id = '';
		}
	}

	async function handleRemoveSpectrum() {
		try {
			await removeSessionLampSpectrum(lamp.id);
			project.updateLamp(lamp.id, {
				has_spectrum_file: false,
				wavelength_from_spectrum: false,
			});
			wavelengthFromSpectrum = false;
		} catch (e) {
			console.error('Failed to remove spectrum:', e);
		}
	}

	async function handleRemoveIes() {
		try {
			await removeSessionLampIes(lamp.id);
			project.updateLamp(lamp.id, {
				has_ies_file: false,
				ies_filename: undefined,
			});
			iesFile = null;
		} catch (e) {
			console.error('Failed to remove IES file:', e);
		}
	}
</script>

<div class="lamp-editor">
	<button class="close-x" onclick={onClose} title="Close">&times;</button>
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
				<option value="other">Other (custom wavelength)</option>
			</select>
		</div>

		{#if lamp_type === 'krcl_222'}
			<div class="form-group">
				<label for="preset">Select Lamp</label>
				<div class="select-with-button">
					<select id="preset" bind:value={preset_id}>
						<option value="" disabled>-- Select a lamp --</option>
						{#each presets as preset}
							<option value={preset.id}>{preset.name}</option>
						{/each}
					</select>
					<button type="button" class="secondary" onclick={() => showInfoModal = true}>
						Lamp Info
					</button>
				</div>
			</div>
		{:else if lamp_type === 'other'}
			<!-- Wavelength and Lamp Info are shown inline with their respective file sections below -->
		{:else}
			<!-- For LP 254, show Lamp Info button after lamp type -->
			<button type="button" class="secondary lamp-info-btn" onclick={() => showInfoModal = true}>
				Lamp Info
			</button>
		{/if}

		{#if isCustomLamp}
			<div class="file-upload-section">
				<div class="form-group">
					<label>
						IES Photometric File
						{#if lamp_type === 'lp_254' || lamp_type === 'other'}
							<span class="required">(required)</span>
						{:else}
							<span class="required">(required for custom)</span>
						{/if}
					</label>
					<input
						type="file"
						accept=".ies"
						bind:this={iesFileInput}
						onchange={handleIesFileChange}
						style="display: none"
					/>
					{#if lamp.has_ies_file}
						<div class="file-status success">
							{lamp.ies_filename ? (lamp.ies_filename.endsWith('.ies') ? lamp.ies_filename : `${lamp.ies_filename}.ies`) : 'IES file uploaded'}
							<span class="file-status-actions">
								<button type="button" class="file-icon-btn" onclick={() => iesFileInput.click()} title="Replace IES file">&#x21c6;</button>
								<button type="button" class="file-icon-btn danger" onclick={handleRemoveIes} title="Remove IES file">&times;</button>
							</span>
						</div>
					{:else if iesFile}
						<div class="file-status pending">Selected: {iesFile.name}</div>
					{:else}
						<button type="button" class="secondary" onclick={() => iesFileInput.click()}>
							Select IES File
						</button>
					{/if}
				</div>
			</div>

			{#if canUploadSpectrum}
				{#if lamp_type === 'other'}
					<div class="form-group wavelength-group">
						<label for="wavelength">
							Wavelength (nm)
							{#if wavelengthFromSpectrum}
								<span class="spectrum-badge">from spectrum</span>
							{/if}
						</label>
						<input
							id="wavelength"
							type="number"
							step="any"
							class:locked={wavelengthFromSpectrum}
							value={wavelength}
							disabled={wavelengthFromSpectrum}
							onchange={(e) => wavelength = parseFloat((e.target as HTMLInputElement).value) || 280}
						/>
					</div>
				{/if}
				<div class="file-upload-section">
					<div class="form-group">
						<label>
							Spectrum CSV File
							<span class="optional">(optional)</span>
						</label>
						<input
							type="file"
							accept=".csv,.xls,.xlsx"
							bind:this={spectrumFileInput}
							onchange={handleSpectrumFileChange}
							style="display: none"
						/>
						{#if lamp.has_spectrum_file}
							<div class="file-status success">
								Spectrum file uploaded
								<span class="file-status-actions">
									<button type="button" class="file-icon-btn" onclick={() => spectrumFileInput.click()} title="Replace spectrum file">&#x21c6;</button>
									{#if lamp_type === 'other'}
										<button type="button" class="file-icon-btn danger" onclick={handleRemoveSpectrum} title="Remove spectrum file">&times;</button>
									{/if}
								</span>
							</div>
						{:else if spectrumFile}
							<div class="file-status pending">Selected: {spectrumFile.name}</div>
						{:else}
							<button type="button" class="secondary" onclick={() => spectrumFileInput.click()}>
								Select Spectrum File
							</button>
						{/if}
					</div>
					{#if lamp_type === 'lp_254'}
						<p class="info-text">
							254nm lamps are assumed to be monochromatic. No spectrum file is needed.
						</p>
					{:else if lamp_type === 'other'}
						<p class="info-text">
							Upload a spectrum CSV for accurate TLV calculations. Without one, the lamp is treated as monochromatic at the specified wavelength.
						</p>
					{/if}
				</div>
			{/if}

			{#if lamp_type === 'other'}
				<button type="button" class="secondary lamp-info-btn" onclick={() => showInfoModal = true}>
					Lamp Info
				</button>
			{/if}
		{/if}

		<div class="form-group">
			<label>Placement</label>
			<div class="placement-buttons" use:rovingTabindex={{ orientation: 'horizontal', selector: 'button' }}>
				<button type="button" class="secondary small" onclick={() => applyPlacement('downlight')} disabled={placingMode !== null} title="Place lamp facing down, centered away from walls and other lamps">
					{placingMode === 'downlight' ? 'Placing...' : 'Downlight'}
				</button>
				<button type="button" class="secondary small" onclick={() => applyPlacement('corner')} disabled={placingMode !== null} title="Place lamp in corner, aiming at opposite corner. Click again to cycle corners.">
					{placingMode === 'corner' ? 'Placing...' : 'Corner'}
				</button>
				<button type="button" class="secondary small" onclick={() => applyPlacement('edge')} disabled={placingMode !== null} title="Place lamp along ceiling edge, aiming at opposite floor edge. Click again to cycle edges.">
					{placingMode === 'edge' ? 'Placing...' : 'Edge'}
				</button>
				{#if showHorizontalButton}
					<button type="button" class="secondary small" onclick={() => applyPlacement('horizontal')} disabled={placingMode !== null} title="Place lamp on wall, aiming horizontally across room.">
						{placingMode === 'horizontal' ? 'Placing...' : 'Horizontal'}
					</button>
				{/if}
			</div>
		</div>

		<div class="form-group">
			<label>Position ({room.units})</label>
			<div class="form-row">
				<div>
					<span class="input-label">X</span>
					<input type="text" inputmode="decimal" value={displayDimension(x, room.precision)} onchange={(e) => x = parseFloat((e.target as HTMLInputElement).value) || 0} />
				</div>
				<div>
					<span class="input-label">Y</span>
					<input type="text" inputmode="decimal" value={displayDimension(y, room.precision)} onchange={(e) => y = parseFloat((e.target as HTMLInputElement).value) || 0} />
				</div>
				<div>
					<span class="input-label">Z</span>
					<input type="text" inputmode="decimal" value={displayDimension(z, room.precision)} onchange={(e) => z = parseFloat((e.target as HTMLInputElement).value) || 0} />
				</div>
			</div>
		</div>

		{#if !useTiltMode}
			<div class="form-group">
				<div class="label-row">
					<label>Aim Point ({room.units})</label>
					<button type="button" class="secondary small" onclick={switchToTiltMode}>Set Tilt/Orientation</button>
				</div>
				<div class="form-row">
					<div>
						<span class="input-label">X</span>
						<input type="text" inputmode="decimal" value={displayDimension(aimx, room.precision)} onchange={(e) => aimx = parseFloat((e.target as HTMLInputElement).value) || 0} />
					</div>
					<div>
						<span class="input-label">Y</span>
						<input type="text" inputmode="decimal" value={displayDimension(aimy, room.precision)} onchange={(e) => aimy = parseFloat((e.target as HTMLInputElement).value) || 0} />
					</div>
					<div>
						<span class="input-label">Z</span>
						<input type="text" inputmode="decimal" value={displayDimension(aimz, room.precision)} onchange={(e) => aimz = parseFloat((e.target as HTMLInputElement).value) || 0} />
					</div>
				</div>
				<div class="aim-presets" use:rovingTabindex={{ orientation: 'horizontal', selector: 'button' }}>
					<button type="button" class="secondary small" onclick={aimDown}>Down</button>
					<button type="button" class="secondary small" onclick={aimCorner}>Corner</button>
					<button type="button" class="secondary small" onclick={aimHorizontal}>Horizontal</button>
				</div>
				<div class="tilt-readout">
					<span class="readout-text">Tilt: {derivedTiltOrientation.tilt.toFixed(1)}&deg; &nbsp; Orientation: {derivedTiltOrientation.orientation.toFixed(1)}&deg;</span>
				</div>
			</div>
		{:else}
			<div class="form-group">
				<div class="label-row">
					<label>Tilt / Orientation (degrees)</label>
					<button type="button" class="secondary small" onclick={switchToAimMode}>Set Aim Point</button>
				</div>
				<div class="form-row">
					<div>
						<span class="input-label">Tilt</span>
						<input type="text" inputmode="decimal" data-scroll-step="1" value={tilt.toFixed(1)} onchange={(e) => handleTiltChange(parseFloat((e.target as HTMLInputElement).value) || 0)} />
					</div>
					<div>
						<span class="input-label">Orientation</span>
						<input type="text" inputmode="decimal" data-scroll-step="1" value={orientation.toFixed(1)} onchange={(e) => handleOrientationChange(parseFloat((e.target as HTMLInputElement).value) || 0)} />
					</div>
				</div>
				<div class="aim-presets" use:rovingTabindex={{ orientation: 'horizontal', selector: 'button' }}>
					<button type="button" class="secondary small" onclick={aimDown}>Down</button>
					<button type="button" class="secondary small" onclick={aimCorner}>Corner</button>
					<button type="button" class="secondary small" onclick={aimHorizontal}>Horizontal</button>
				</div>
				<div class="tilt-readout">
					<span class="readout-text">Aim: ({aimx.toFixed(room.precision)}, {aimy.toFixed(room.precision)}, {aimz.toFixed(room.precision)})</span>
				</div>
			</div>
		{/if}

		<div class="form-group">
			<label>Rotation (degrees)</label>
			<div class="form-row">
				<div>
					<input type="text" inputmode="decimal" data-scroll-step="1" value={angle.toFixed(1)} onchange={(e) => angle = parseFloat((e.target as HTMLInputElement).value) || 0} />
				</div>
			</div>
		</div>

		<button type="button" class="secondary advanced-btn" onclick={() => showAdvancedModal = true}>
			Advanced Settings
		</button>

		<div class="editor-actions">
			<button class="delete-btn" onclick={remove}>Delete</button>
			<button class="secondary" onclick={copy}>Copy</button>
			<button class="secondary" onclick={onClose}>Close</button>
		</div>
	{/if}
</div>

{#if showInfoModal}
	<LampInfoModal
		presetId={isPresetLamp ? preset_id : undefined}
		lampId={!isPresetLamp ? lamp.id : undefined}
		lampName={lamp.name || preset_id || 'Custom Lamp'}
		{hasPhotometry}
		hasIes={lamp.has_ies_file || isPresetLamp}
		lampType={lamp_type}
		onClose={() => showInfoModal = false}
	/>
{/if}

{#if showAdvancedModal}
	<AdvancedLampSettingsModal
		initialLampId={lamp.id}
		{room}
		onClose={() => showAdvancedModal = false}
		onUpdate={(updatedSettings) => {
			// Update store with advanced settings so UI reflects changes
			if (updatedSettings) {
				project.updateLampFromAdvanced(lamp.id, {
					scaling_factor: updatedSettings.scaling_factor,
					source_width: updatedSettings.source_width ?? undefined,
					source_length: updatedSettings.source_length ?? undefined,
					source_density: updatedSettings.source_density,
				});
			}
			// Refresh state hashes so calc button turns red
			fetchStateHashesDebounced();
		}}
	/>
{/if}

{#if showDeleteConfirm}
	<ConfirmDialog
		title="Delete Lamp"
		message="Delete this lamp? This action cannot be undone."
		confirmLabel="Delete"
		variant="danger"
		onConfirm={() => { showDeleteConfirm = false; project.removeLamp(lamp.id); onClose(); }}
		onCancel={() => showDeleteConfirm = false}
	/>
{/if}

<style>
	.lamp-editor {
		position: relative;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.close-x {
		position: absolute;
		top: var(--spacing-xs);
		right: var(--spacing-xs);
		background: none;
		border: none;
		font-size: 1.25rem;
		line-height: 1;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.close-x:hover {
		color: var(--color-text);
		background: var(--color-bg-tertiary);
	}

	.input-label {
		display: block;
		font-size: var(--font-size-sm);
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

	.label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
	}

	.tilt-readout {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-sm);
	}

	.readout-text {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		flex: 1;
	}

	.small {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm);
	}

	.editor-actions {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin-top: var(--spacing-lg);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border);
		gap: var(--spacing-sm);
	}

	.editor-actions button {
		border-radius: var(--radius-lg, 8px);
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
		padding: var(--spacing-sm) var(--spacing-md);
		margin: var(--spacing-sm) 0;
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

	.file-status.pending {
		background: color-mix(in srgb, var(--color-info) 15%, transparent);
		color: var(--color-info);
	}

	.file-status.muted {
		background: color-mix(in srgb, var(--color-text-muted) 10%, transparent);
		color: var(--color-text-muted);
	}

	.required {
		color: var(--color-error);
		font-size: var(--font-size-sm);
	}

	.optional {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.info-text {
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
		margin-top: var(--spacing-sm);
		font-style: italic;
	}

	.select-with-button {
		display: flex;
		gap: var(--spacing-xs);
	}

	.select-with-button select,
	.select-with-button input {
		flex: 1;
		min-width: 0;
	}

	.lamp-info-btn {
		width: 100%;
		margin-bottom: var(--spacing-md);
	}

	.advanced-btn {
		width: 100%;
		margin-bottom: var(--spacing-md);
	}

	.spectrum-badge {
		display: inline-block;
		font-size: var(--font-size-sm);
		color: var(--color-info);
		background: color-mix(in srgb, var(--color-info) 15%, transparent);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		margin-left: var(--spacing-xs);
	}

	.wavelength-group {
		max-width: 16em;
	}

	input.locked {
		opacity: 0.5;
		background: var(--color-bg-tertiary, #e8e8e8);
		cursor: not-allowed;
		border-style: dashed;
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
</style>
