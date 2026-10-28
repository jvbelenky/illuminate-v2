<script lang="ts">
	import { project, lamps, fetchStateHashesDebounced, lampHasPhotometry } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { getLampOptions, placeSessionLamp } from '$lib/api/client';
	import type { LampInstance, RoomConfig, LampPresetInfo, LampType } from '$lib/types/project';
	import type { CustomLampType } from '$lib/types/lampLibrary';
	import { customLamps } from '$lib/stores/lampLibrary';
	import { fromMeters, unitAbbrev, unitStep } from '$lib/utils/unitConversion';
	import { attachCeiling, attachWall } from '$lib/utils/lampSticking';
	import { roomVertices } from '$lib/utils/roomGeometry';
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import AdvancedLampSettingsModal from './AdvancedLampSettingsModal.svelte';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import { restoreByTitle } from '$lib/stores/modalDock.svelte';
	import { getDownlightPlacement, getCornerPlacement, getEdgePlacement, getNextCornerIndex, getNextEdgeIndex, PLACEMENT_MODES, type PlacementMode } from '$lib/utils/lampPlacement';
	import PlacementPictogram from '$lib/workspace/parts/PlacementPictogram.svelte';
	import '$lib/workspace/parts/parts.css';
	import { rovingTabindex } from '$lib/actions/rovingTabindex';
	import { pickMode, pickResult, activeViewPreset, lockedAxisForView, type PickType } from '$lib/stores/pickMode';
	import { WEB_SIZE_MIN, WEB_SIZE_MAX, webSize } from './photometricWeb';

	interface Props {
		lamp: LampInstance;
		room: RoomConfig;
		onClose: () => void;
		// editDefId: open the manager straight into editing that definition
		// (used by the Other-lamp wavelength row to change the spectrum).
		onOpenLampManager: (type: CustomLampType, lampId: string, editDefId?: string) => void;
		/** Offer the pick buttons (a pick runs in the main view: the 2D plan or the 3D view). */
		pick?: boolean;
	}

	let { lamp, room, onClose, onOpenLampManager, pick = true }: Props = $props();

	// Lamp options from API
	let presets: LampPresetInfo[] = $state([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Position, aim, rotation and type are read from the lamp (the store) and
	// written straight back through project.updateLamp. Nothing is mirrored
	// locally, so an edit made elsewhere (the Plan editor, a placement echo,
	// undo) can never be overwritten by a stale copy here.
	const lamp_type = $derived<LampType>(lamp.lamp_type || 'krcl_222');
	const x = $derived(lamp.x);
	const y = $derived(lamp.y);
	const z = $derived(lamp.z);
	const angle = $derived(lamp.angle ?? 0);
	const aimx = $derived(lamp.aimx);
	const aimy = $derived(lamp.aimy);
	const aimz = $derived(lamp.aimz);

	const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
	function update(partial: Partial<LampInstance>) {
		project.updateLamp(lamp.id, partial);
	}
	/** Move the lamp, carrying the aim point along so tilt and orientation stay put. */
	function moveTo(nx: number, ny: number, nz: number) {
		const dx = nx - lamp.x;
		const dy = ny - lamp.y;
		const dz = nz - lamp.z;
		if (dx === 0 && dy === 0 && dz === 0) return;
		update({ x: nx, y: ny, z: nz, aimx: round6(lamp.aimx + dx), aimy: round6(lamp.aimy + dy), aimz: round6(lamp.aimz + dz) });
	}
	// An aim point on the lamp itself has no direction (the backend rejects it).
	// It is held back here, shown in the fields as invalid, and the next
	// coordinate typed builds on it, so the aim can be typed X, Y, Z in any order.
	let aimDraft = $state<{ x: number; y: number; z: number } | null>(null);
	const aimShown = $derived(aimDraft ?? { x: lamp.aimx, y: lamp.aimy, z: lamp.aimz });
	// A change to the lamp from anywhere (a move, a placement, undo) drops the held-back aim
	$effect(() => {
		void [lamp.x, lamp.y, lamp.z, lamp.aimx, lamp.aimy, lamp.aimz];
		untrack(() => (aimDraft = null));
	});
	function setAim(ax: number, ay: number, az: number) {
		if (round6(ax) === round6(lamp.x) && round6(ay) === round6(lamp.y) && round6(az) === round6(lamp.z)) {
			aimDraft = { x: ax, y: ay, z: az };
			return;
		}
		aimDraft = null;
		update({ aimx: ax, aimy: ay, aimz: az });
	}

	// Stick to ceiling / Stick to wall. Checking a box puts the lamp on that
	// surface (a set distance below the ceiling unless it is already near it;
	// on the nearest wall where it stands); the store keeps it there as the room changes.
	function setStickCeiling(on: boolean) {
		update(on ? attachCeiling(lamp, room.z, fromMeters(0.1, $userSettings.units)) : { stick_ceiling: false });
	}
	function setStickWall(on: boolean) {
		update(on ? attachWall(lamp, roomVertices(room)) : { stick_wall: false });
	}
	/** Turn the lamp a quarter turn about its own aim axis (its rotation angle). */
	function rotate90() {
		update({ angle: round6((((angle + 90) % 360) + 360) % 360) });
	}

	// Fold-outs, collapsed whenever the editor opens
	let geometryOpen = $state(false);
	let displayOpen = $state(false);

	// Dimmer: scaling_factor shown as a percentage. The slider previews while
	// dragging and commits once on release, so a drag is one undo step. The
	// slider spans 0-200%; the number box takes up to 1000%.
	const DIM_SLIDER_MAX = 200;
	const DIM_MAX = 1000;
	const dimPercent = $derived(Math.round((lamp.scaling_factor ?? 1) * 100));
	let dimDrag = $state<number | null>(null);
	const dimShown = $derived(dimDrag ?? dimPercent);
	function commitDimmer(input: HTMLInputElement) {
		dimDrag = null;
		const v = parseFloat(input.value);
		if (!Number.isFinite(v)) {
			input.value = String(dimPercent);
			return;
		}
		const pct = Math.min(DIM_MAX, Math.max(0, v));
		input.value = String(pct);
		const factor = round6(pct / 100);
		if (factor !== lamp.scaling_factor) update({ scaling_factor: factor });
	}

	// Web size sliders (2D and 3D): preview while dragging, commit once on release
	let webDrag = $state<{ key: 'web_size_2d' | 'web_size_3d'; v: number } | null>(null);
	const webShown = (key: 'web_size_2d' | 'web_size_3d') => (webDrag?.key === key ? webDrag.v : webSize(lamp[key]));
	/** 1 -> "1.0×", 1.5 -> "1.5×", 2.25 -> "2.25×" */
	const webLabel = (v: number) => `${v.toFixed(2).replace(/(\.\d)0$/, '$1')}×`;
	function commitWebSize(key: 'web_size_2d' | 'web_size_3d', raw: string) {
		webDrag = null;
		const v = parseFloat(raw);
		if (!Number.isFinite(v)) return;
		const size = round6(webSize(v));
		if (size !== webSize(lamp[key])) update({ [key]: size });
	}

	// Lamp selection state. `effectivePresetId` is the established local-state
	// exception (initialized once from the lamp, then driven by the dropdown
	// handler — never mirrored from a background store emit). It may hold a
	// built-in preset id, 'custom' (legacy uploaded file), or 'custom_lamp:{id}'.
	let effectivePresetId = $state(lamp.custom_lamp_id ? `custom_lamp:${lamp.custom_lamp_id}` : (lamp.preset_id || ''));
	// Mirrors the last committed dropdown selection so the non-destructive
	// "Add custom lamp..." option can restore the select without touching the
	// lamp's photometry (see handleLampSelect).
	let lastSelectedPresetId = effectivePresetId;

	// Position, aim and rotation only appear once the lamp has photometry, so
	// a new lamp asks one question at a time.
	const showPlacement = $derived(lampHasPhotometry(lamp));

	// Re-derive the dropdown selection when the lamp's photometry identity
	// changes EXTERNALLY (applyCustomLamp's echo after the "Add custom lamp..."
	// auto-apply, a propagated definition edit, or a direct store write). Track
	// ONLY the lamp's canonical identity fields via the reads below - never
	// effectivePresetId itself (written under untrack) - so this can't fight the
	// transient __add_custom__ -> tick-restore sequence or a mid-flight user
	// selection; neither of those changes the lamp's fields. Only rewrite when the
	// canonical value actually differs, and never resurrect the legacy 'custom'
	// pseudo-selection (a lamp-type change echoes preset_id='custom').
	$effect(() => {
		const canonical = lamp.custom_lamp_id
			? `custom_lamp:${lamp.custom_lamp_id}`
			: (lamp.preset_id || '');
		untrack(() => {
			if (canonical !== effectivePresetId && canonical !== 'custom') {
				effectivePresetId = canonical;
				lastSelectedPresetId = canonical;
			}
		});
	});

	// Custom lamp definitions matching the current lamp type.
	let matchingCustomLamps = $derived($customLamps.filter((d) => d.lampType === lamp_type));

	// Modal states
	let showDetailsModal = $state(false);
	let detailsInitialTab = $state<'info' | 'scaling' | 'opening' | 'fixture'>('info');

	// Placement mode state
	let cornerIndex = $state(-1);
	let edgeIndex = $state(-1);
	let placingMode = $state<PlacementMode | null>(null);

	// Get other lamps (excluding current lamp)
	const otherLamps = $derived($lamps.filter(l => l.id !== lamp.id));

	const PLACEMENT_TITLES: Record<PlacementMode, string> = {
		downlight: 'Place lamp facing down, centered away from walls and other lamps',
		corner: 'Place lamp in corner, aiming at opposite corner. Click again to cycle corners.',
		edge: 'Place lamp along ceiling edge, aiming at opposite floor edge. Click again to cycle edges.',
		horizontal: 'Place lamp on wall, aiming level across the room for upper-room use. Click again to cycle walls.',
	};

	async function applyPlacement(mode: PlacementMode) {
		placingMode = mode;
		try {
			// Determine position_index for strict cycling, skipping occupied positions
			let positionIndex: number | undefined;
			if (mode === 'corner') {
				positionIndex = getNextCornerIndex(room, otherLamps, cornerIndex, $userSettings.units);
			} else if (mode === 'edge' || mode === 'horizontal') {
				positionIndex = getNextEdgeIndex(room, otherLamps, edgeIndex, $userSettings.units);
			}
			// downlight: no positionIndex → legacy best-available

			const result = await placeSessionLamp(lamp.id, mode, positionIndex);
			// Round placement coordinates to room precision so UI doesn't show long decimals
			const p = room.precision;
			const r = (v: number) => parseFloat(v.toFixed(p));
			project.applyPlacement(lamp.id, mode, {
				x: r(result.x), y: r(result.y), z: r(result.z),
				angle: result.angle ?? 0,
				aimx: r(result.aimx), aimy: r(result.aimy), aimz: r(result.aimz),
			});

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
				placement = getCornerPlacement(room, otherLamps, cornerIndex, $userSettings.units);
				cornerIndex = placement.nextIndex;
				edgeIndex = -1;
				break;
			case 'edge':
				placement = getEdgePlacement(room, otherLamps, edgeIndex, $userSettings.units);
				edgeIndex = placement.nextIndex;
				cornerIndex = -1;
				break;
			case 'horizontal':
				// Horizontal fallback: use edge placement but aim at lamp height
				placement = getEdgePlacement(room, otherLamps, edgeIndex, $userSettings.units);
				placement.aimz = placement.z;
				edgeIndex = placement.nextIndex;
				cornerIndex = -1;
				break;
			case 'downlight':
			default:
				placement = getDownlightPlacement(room, otherLamps, $userSettings.units);
				cornerIndex = -1;
				edgeIndex = -1;
				break;
		}
		// Round placement coordinates to room precision so UI doesn't show long decimals
		const p = room.precision;
		const r = (v: number) => parseFloat(v.toFixed(p));
		project.applyPlacement(lamp.id, mode, {
			x: r(placement.x), y: r(placement.y), z: r(placement.z),
			aimx: r(placement.aimx), aimy: r(placement.aimy), aimz: r(placement.aimz),
		});
	}

	onDestroy(() => {
		unsubPickResult();
	});

	// Helper to start a pick with view-axis locking
	function startPick(type: PickType, lockedValue?: number) {
		const axis = lockedAxisForView($activeViewPreset);
		pickResult.set(null);
		pickMode.set({
			type,
			lockedAxis: axis,
			lockedValue: axis && lockedValue != null ? lockedValue : undefined,
			lampId: lamp.id,
		});
	}

	// Watch for pick results from the 3D scene
	const unsubPickResult = pickResult.subscribe((result) => {
		if (!result) return;
		if (result.type === 'lamp_position') {
			moveTo(round6(result.value[0]), round6(result.value[1]), round6(result.value[2]));
		} else if (result.type === 'lamp_aim') {
			setAim(round6(result.value[0]), round6(result.value[1]), round6(result.value[2]));
		}
		pickResult.set(null);
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

	// --- Lamp selection ---

	async function handleLampSelect(value: string) {
		if (value === '__add_custom__') {
			// Non-destructive: opening the manager must touch NOTHING on this lamp —
			// no updateLamp, no unload. Restore the select's bound value to the
			// previously-selected option (bind:value already moved it to
			// '__add_custom__'). Only effectivePresetId is touched — never preset_id
			// or any field the debounced auto-save reads — so cancelling the manager
			// leaves the lamp exactly as it was. Saving a new definition auto-applies
			// it via onOpenLampManager -> onCreated -> applyCustomLamp.
			//
			// await tick() first: bind:value has already set effectivePresetId to
			// '__add_custom__' for THIS flush. If we reassigned synchronously to
			// lastSelectedPresetId (the pre-event value), the reactive value would end
			// the flush equal to where it started — Svelte sees no net change and never
			// rewrites the <select>, which keeps showing 'Add custom lamp...'. Letting
			// the flush complete first makes the restore a real state change
			// ('__add_custom__' -> previous) that Svelte writes back to the DOM.
			await tick();
			effectivePresetId = lastSelectedPresetId;
			onOpenLampManager(lamp_type, lamp.id);
			return;
		}
		if (value.startsWith('custom_lamp:')) {
			const defId = value.substring('custom_lamp:'.length);
			effectivePresetId = value;
			lastSelectedPresetId = value;
			await project.applyCustomLamp(lamp.id, defId);
			return;
		}
		// Built-in preset (only krcl_222 reaches here — other types have no presets)
		effectivePresetId = value;
		lastSelectedPresetId = value;
		update({ preset_id: value, custom_lamp_id: undefined });
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

	// Tilt and orientation as the aim point implies them
	let derivedTiltOrientation = $derived(computeTiltOrientation(x, y, z, aimx, aimy, aimz));
	const round1 = (v: number) => Math.round(v * 10) / 10;

	/** Aim along a tilt/orientation; both angles go to the backend too (they win over the aim point there). */
	function setTiltOrientation(newTilt: number, newOrientation: number) {
		const result = computeAimFromTiltOrientation(x, y, z, newTilt, newOrientation, room.x, room.y, room.z);
		update({ aimx: round6(result.aimx), aimy: round6(result.aimy), aimz: round6(result.aimz), tilt: newTilt, orientation: newOrientation });
	}
	function handleTiltChange(newTilt: number) {
		setTiltOrientation(newTilt, derivedTiltOrientation.orientation);
	}
	function handleOrientationChange(newOrientation: number) {
		setTiltOrientation(derivedTiltOrientation.tilt, newOrientation);
	}

	// Other-lamp wavelength: read from the store, write straight back (no local
	// mirror). Disabled in the template while the spectrum peak defines it.
	function commitWavelength(raw: string) {
		const v = parseFloat(raw);
		if (!Number.isFinite(v) || v <= 0 || v === lamp.wavelength) return;
		project.updateLamp(lamp.id, { wavelength: v });
	}

	// The spectrum lives on the lamp's library definition: open it for editing
	// when the lamp is linked to one, otherwise start a new definition for it.
	function openSpectrumEditor() {
		onOpenLampManager(lamp_type, lamp.id, lamp.custom_lamp_id);
	}

	function handleLampTypeChange(newType: LampType) {
		if (newType === lamp_type) return;
		// 254 nm and custom-wavelength lamps have no presets; a 222 nm lamp keeps
		// a built-in preset but must pick again after an uploaded file
		const current = lamp.preset_id;
		const preset_id = newType === 'krcl_222' ? (current && current !== 'custom' ? current : '') : 'custom';
		// Reset the dropdown selection: a lamp previously chosen for another type
		// is no longer a valid option for the new type.
		effectivePresetId = '';
		lastSelectedPresetId = '';
		// A custom lamp reference from the old type is no longer valid for the
		// new type; clear it in the same update so a later edit to that definition
		// in the Lamp Manager cannot silently revert this lamp to it (see applyCustomLamp).
		// A built-in preset's photometry goes with the preset: leaving 'has_ies_file'
		// set would send the web and info panels after IES data the lamp no longer has.
		const droppedPreset = newType !== 'krcl_222' && !!current && current !== 'custom' && !lamp.custom_lamp_id;
		update({
			lamp_type: newType,
			preset_id,
			custom_lamp_id: undefined,
			...(droppedPreset ? { has_ies_file: false, ies_filename: undefined } : {}),
		});
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
			<select id="lamp-type" value={lamp_type} onchange={(e) => handleLampTypeChange(e.currentTarget.value as LampType)}>
				<option value="krcl_222">Krypton chloride (222 nm)</option>
				<option value="lp_254">Low-pressure mercury (254 nm)</option>
				<option value="other">Other (custom wavelength)</option>
			</select>
		</div>

		<div class="form-group">
			<label for="preset">Select Lamp</label>
			<div class="select-with-button">
				<select id="preset" bind:value={effectivePresetId} onchange={(e) => handleLampSelect(e.currentTarget.value)}>
					<option value="" disabled>-- Select a lamp --</option>
					{#if lamp_type === 'krcl_222'}
						{#each presets as preset}
							<option value={preset.id}>{preset.name}</option>
						{/each}
					{/if}
					{#if effectivePresetId === 'custom'}
						<option value="custom">Custom lamp (uploaded file)</option>
					{/if}
					{#if matchingCustomLamps.length > 0}
						<option disabled>──────────</option>
						{#each matchingCustomLamps as def}
							<option value={'custom_lamp:' + def.id}>{def.name}</option>
						{/each}
					{/if}
					<option disabled>──────────</option>
					<option value="__add_custom__">Add custom lamp...</option>
				</select>
				<button type="button" class="secondary" onclick={() => { if (!restoreByTitle('Advanced Lamp Settings')) { detailsInitialTab = 'info'; showDetailsModal = true; } }}>
					Details...
				</button>
			</div>
		</div>

		{#if lamp_type === 'other'}
		<div class="form-group">
			<label for="lamp-wavelength">
				Wavelength (nm)
				{#if lamp.wavelength_from_spectrum}
					<span class="label-hint">from spectrum peak{#if lamp.spectrum_filename}&nbsp;({lamp.spectrum_filename}){/if}</span>
				{/if}
			</label>
			<div class="select-with-button">
				<input
					id="lamp-wavelength"
					type="number"
					step="any"
					min="100"
					max="1000"
					placeholder="not set"
					value={lamp.wavelength ?? ''}
					disabled={lamp.wavelength_from_spectrum}
					title={lamp.wavelength_from_spectrum ? 'Defined by the spectrum peak; change the spectrum to change it' : 'Nominal wavelength used when no spectrum is attached'}
					onchange={(e) => commitWavelength(e.currentTarget.value)}
				/>
				<button type="button" class="secondary" onclick={openSpectrumEditor} title="Attach or change the spectrum file in the lamp library">
					Spectrum...
				</button>
			</div>
		</div>
		{/if}

		{#if showPlacement}
		<div class="dimmer">
			<span class="field-label">Dimmer</span>
			<span class="dimrow">
				<input type="range" min="0" max={DIM_SLIDER_MAX} step="1" value={Math.min(DIM_SLIDER_MAX, dimShown)} aria-label="Dimmer" oninput={(e) => (dimDrag = parseFloat(e.currentTarget.value))} onchange={(e) => commitDimmer(e.currentTarget)} />
				<input type="number" min="0" max={DIM_MAX} step="1" value={dimShown} aria-label="Dimmer percent" onchange={(e) => commitDimmer(e.currentTarget)} />
				<b>%</b>
			</span>
		</div>

		<div class="ep-grid ep-addbtns placements" use:rovingTabindex={{ orientation: 'horizontal', selector: 'button' }}>
			{#each PLACEMENT_MODES as pl (pl.mode)}
				<button type="button" class="secondary placement" data-mode={pl.mode} disabled={placingMode !== null} aria-busy={placingMode === pl.mode} title={PLACEMENT_TITLES[pl.mode]} onclick={() => applyPlacement(pl.mode)}>
					<PlacementPictogram mode={pl.mode} />
					<span>{pl.label}</span>
				</button>
			{/each}
		</div>

		<div class="sticks">
			<label class="ep-check">
				<input type="checkbox" checked={lamp.stick_ceiling ?? false} onchange={(e) => setStickCeiling(e.currentTarget.checked)} />
				<span>Stick to ceiling</span>
			</label>
			<label class="ep-check">
				<input type="checkbox" checked={lamp.stick_wall ?? false} onchange={(e) => setStickWall(e.currentTarget.checked)} />
				<span>Stick to wall</span>
			</label>
			<button type="button" class="secondary rotate90" title="Rotate 90° about its axis" onclick={rotate90}><span aria-hidden="true">⟳</span> 90°</button>
		</div>

		<button type="button" class="ep-disc" aria-expanded={geometryOpen} onclick={() => (geometryOpen = !geometryOpen)}>
			<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
			Geometry
		</button>
		{#if geometryOpen}
			<div class="fold-body">
				<div class="xyz">
					<span class="field-label">Position ({unitAbbrev($userSettings.units)})</span>
					<div class="vector-row">
						<label class="dim"><span>X</span><ValidatedNumberInput value={x} precision={room.precision} oncommit={(v) => moveTo(v, y, z)} min={0} max={room.x} step={unitStep($userSettings.units)} /></label>
						<label class="dim"><span>Y</span><ValidatedNumberInput value={y} precision={room.precision} oncommit={(v) => moveTo(x, v, z)} min={0} max={room.y} step={unitStep($userSettings.units)} /></label>
						<label class="dim"><span>Z</span><ValidatedNumberInput value={z} precision={room.precision} oncommit={(v) => moveTo(x, y, v)} min={0} max={room.z} step={unitStep($userSettings.units)} /></label>
						{#if pick}
						<span class="pick-cell"><span class="pick-gap" aria-hidden="true">&nbsp;</span>
						<button
							type="button"
							class="pick-btn pick-position"
							class:pick-active={$pickMode?.type === 'lamp_position'}
							title={$pickMode?.type === 'lamp_position' ? 'Press Escape to cancel' : 'Click in the view to set position'}
							aria-label="Pick position"
							onclick={() => {
								if ($pickMode?.type === 'lamp_position') { pickMode.set(null); }
								else {
									const axis = lockedAxisForView($activeViewPreset);
									startPick('lamp_position', axis === 'x' ? x : axis === 'y' ? y : axis === 'z' ? z : undefined);
								}
							}}
						>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
								<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
								<circle cx="8" cy="8" r="2" fill="currentColor"/>
								<path d="M8 1v2m0 10v2M1 8h2m10 0h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
							</svg>
						</button>
						</span>
						{/if}
					</div>
					{#if $pickMode?.type === 'lamp_position'}
						<span class="pick-hint">Click a point in the view. Press Escape to cancel.</span>
					{/if}
				</div>

				<div class="xyz">
					<span class="field-label">Aim point ({unitAbbrev($userSettings.units)})</span>
					<div class="vector-row" class:invalid={aimDraft !== null}>
						<label class="dim"><span>X</span><ValidatedNumberInput value={aimShown.x} precision={room.precision} oncommit={(v) => setAim(v, aimShown.y, aimShown.z)} step={unitStep($userSettings.units)} /></label>
						<label class="dim"><span>Y</span><ValidatedNumberInput value={aimShown.y} precision={room.precision} oncommit={(v) => setAim(aimShown.x, v, aimShown.z)} step={unitStep($userSettings.units)} /></label>
						<label class="dim"><span>Z</span><ValidatedNumberInput value={aimShown.z} precision={room.precision} oncommit={(v) => setAim(aimShown.x, aimShown.y, v)} step={unitStep($userSettings.units)} /></label>
						{#if pick}
						<span class="pick-cell"><span class="pick-gap" aria-hidden="true">&nbsp;</span>
						<button
							type="button"
							class="pick-btn pick-aim"
							class:pick-active={$pickMode?.type === 'lamp_aim'}
							title={$pickMode?.type === 'lamp_aim' ? 'Press Escape to cancel' : 'Click in the view to set aim point'}
							aria-label="Pick aim point"
							onclick={() => {
								if ($pickMode?.type === 'lamp_aim') { pickMode.set(null); }
								else {
									const axis = lockedAxisForView($activeViewPreset);
									startPick('lamp_aim', axis === 'x' ? aimx : axis === 'y' ? aimy : axis === 'z' ? aimz : undefined);
								}
							}}
						>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
								<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
								<circle cx="8" cy="8" r="2" fill="currentColor"/>
								<path d="M8 1v2m0 10v2M1 8h2m10 0h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
							</svg>
						</button>
						</span>
						{/if}
					</div>
					{#if $pickMode?.type === 'lamp_aim'}
						<span class="pick-hint">Click a point in the view. Press Escape to cancel.</span>
					{/if}
				</div>

				<div class="angles">
					<label class="dim"><span>Tilt °</span><ValidatedNumberInput value={round1(derivedTiltOrientation.tilt)} precision={1} min={0} max={180} step={1} oncommit={handleTiltChange} /></label>
					<label class="dim"><span>Orientation °</span><ValidatedNumberInput value={round1(derivedTiltOrientation.orientation)} precision={1} step={1} oncommit={handleOrientationChange} /></label>
					<label class="dim"><span>Rotation °</span><ValidatedNumberInput value={round1(angle)} precision={1} step={1} oncommit={(v) => update({ angle: v })} /></label>
				</div>
			</div>
		{/if}

		<button type="button" class="ep-disc" aria-expanded={displayOpen} onclick={() => (displayOpen = !displayOpen)}>
			<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
			Display
		</button>
		{#if displayOpen}
			<div class="fold-body">
				<div class="display-section">
					<span class="display-head">2D</span>
					<label class="ep-check">
						<input type="checkbox" aria-label="Show photometric web in 2D" checked={lamp.show_photometric_web_2d ?? true} onchange={(e) => update({ show_photometric_web_2d: e.currentTarget.checked })} />
						<span>Show photometric web</span>
					</label>
					{@render webSizeRow('web_size_2d', '2D web size')}
				</div>
				<div class="display-section">
					<span class="display-head">3D</span>
					<label class="ep-check">
						<input type="checkbox" checked={lamp.show_label ?? false} onchange={(e) => update({ show_label: e.currentTarget.checked })} />
						<span>Show label</span>
					</label>
					<label class="ep-check">
						<input type="checkbox" aria-label="Show photometric web in 3D" checked={lamp.show_photometric_web ?? true} onchange={(e) => update({ show_photometric_web: e.currentTarget.checked })} />
						<span>Show photometric web</span>
					</label>
					{@render webSizeRow('web_size_3d', '3D web size')}
				</div>
			</div>
		{/if}

		{/if}
	{/if}
</div>

{#snippet webSizeRow(key: 'web_size_2d' | 'web_size_3d', aria: string)}
	<div class="websize">
		<span class="field-label">Web size</span>
		<input type="range" min={WEB_SIZE_MIN} max={WEB_SIZE_MAX} step="0.05" value={webShown(key)} aria-label={aria} oninput={(e) => (webDrag = { key, v: parseFloat(e.currentTarget.value) })} onchange={(e) => commitWebSize(key, e.currentTarget.value)} />
		<b>{webLabel(webShown(key))}</b>
	</div>
{/snippet}

{#if showDetailsModal}
	<AdvancedLampSettingsModal
		initialLampId={lamp.id}
		initialTab={detailsInitialTab}
		{room}
		onClose={() => showDetailsModal = false}
		onUpdate={(updatedSettings) => {
			// Update store with advanced settings so UI reflects changes
			if (updatedSettings) {
				project.updateLampFromAdvanced(lamp.id, {
					scaling_factor: updatedSettings.scaling_factor,
					source_width: updatedSettings.source_width ?? undefined,
					source_length: updatedSettings.source_length ?? undefined,
					source_density: updatedSettings.source_density,
					intensity_units: updatedSettings.intensity_units,
					photometric_axis: updatedSettings.photometric_axis,
					photometric_depth: undefined,
					mount_face: updatedSettings.mount_face,
					housing_roll: updatedSettings.housing_roll,
					emitter_offset: updatedSettings.emitter_offset,
				});
			}
			// Refresh state hashes so calc button turns red
			fetchStateHashesDebounced();
		}}
	/>
{/if}

<style>
	/* The row around it already frames the panel, so it spends no width on a card of its own. */
	.lamp-editor {
		position: relative;
		min-width: 0;
	}

	.close-x {
		position: absolute;
		top: 0;
		right: 0;
		background: none;
		border: none;
		font-size: 1.1rem;
		line-height: 1;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0 4px;
		border-radius: var(--radius-sm);
	}

	.close-x:hover {
		color: var(--color-text);
		background: var(--color-bg-tertiary);
	}

	.loading,
	.error {
		padding: var(--spacing-md);
		text-align: center;
	}

	.error {
		color: var(--color-error);
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

	.label-hint {
		margin-left: var(--spacing-xs);
		font-weight: normal;
		font-style: italic;
		color: var(--color-text-muted);
	}

	.field-label,
	.dim > span,
	.pick-gap {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.dimmer {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: var(--spacing-sm);
	}

	.dimrow {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.dimrow input[type='range'] {
		flex: 1;
		min-width: 0;
		padding: 0;
		accent-color: var(--color-primary);
	}

	.dimrow input[type='number'] {
		flex: none;
		width: 56px;
	}

	.dimrow b {
		font-weight: 400;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.sticks {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px;
		margin-top: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}
	.sticks .ep-check {
		font-size: 0.82rem;
	}
	.sticks input {
		accent-color: var(--color-primary);
	}
	.rotate90 {
		margin-left: auto;
		padding: 2px 10px;
		font-size: 0.82rem;
		white-space: nowrap;
	}

	.display-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.display-section + .display-section {
		margin-top: 4px;
	}
	.display-head {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.websize {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 3.2em;
		align-items: center;
		gap: var(--spacing-sm);
	}
	.websize input[type='range'] {
		min-width: 0;
		padding: 0;
		accent-color: var(--color-primary);
	}
	.websize b {
		font-weight: 400;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.placements {
		grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
		gap: 6px;
		margin-top: var(--spacing-md);
	}

	.fold-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 6px;
	}

	.xyz {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.vector-row {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr)) 30px;
		gap: 4px;
		align-items: end;
	}

	.vector-row.invalid :global(input) {
		border-color: var(--color-error);
	}

	.angles {
		display: grid;
		/* A little wider in the middle, so Orientation ° is not clipped */
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr);
		gap: 4px;
	}

	.dim {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		margin: 0;
	}

	.dim :global(input) {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	.pick-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	/* The pick button fills the height of the inputs beside it, below a label-high gap, so it is centred on them */
	.pick-cell {
		display: flex;
		flex-direction: column;
		gap: 3px;
		align-self: stretch;
	}
	.pick-cell .pick-btn {
		flex: 1;
		height: auto;
		min-height: 0;
	}

	.pick-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-primary);
	}

	.pick-btn.pick-active {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
	}

	.pick-hint {
		color: var(--color-primary);
		font-size: var(--font-size-sm);
		font-weight: 500;
		animation: pick-pulse 1.5s ease-in-out infinite;
	}

	@keyframes pick-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}
</style>
