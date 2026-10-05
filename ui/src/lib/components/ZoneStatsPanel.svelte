<script lang="ts">
	import { zones, results, room, lamps, project, stateHashes, lampsStale, roomStale, isZoneStale, fetchStateHashesDebounced } from '$lib/stores/project';
	import { ROOM_DEFAULTS, type CalcZone, type ZoneResult, type CheckLampsResult, type LampComplianceResult, type SafetyWarning } from '$lib/types/project';
	import { TLV_LIMITS, OZONE_WARNING_THRESHOLD_PPB, standardFamily } from '$lib/constants/safety';
	import { formatValue } from '$lib/utils/formatting';
	import { doseConversionFactor, formatDoseTime, parseDoseTime, totalHours } from '$lib/utils/calculations';
	import { getSessionReport, getSessionZoneExport, getSessionExportZip, checkLampsSession, updateSessionRoom, getEfficacyExploreData, type EfficacyExploreResponse } from '$lib/api/client';
	import type { GuvStandard } from '$lib/api/contract';
	import { userSettings } from '$lib/stores/settings';
	import { compliance } from '$lib/stores/compliance';
	import { auditProblems } from '$lib/stores/audit';
	import { nextStep } from '$lib/stores/nextStep';
	import { parseTableResponse } from '$lib/utils/efficacy-filters';
	import { averageKineticsBySpecies, logReductionTime, eachUV, DEFAULT_TARGET_SPECIES, type SpeciesKinetics } from '$lib/utils/survival-math';
	import CalcVolPlotModal, { type IsoSettings, type IsoSettingsInput } from './CalcVolPlotModal.svelte';
	import type { IsosurfaceData } from '$lib/utils/isosurface';
	import CalcPlanePlotModal from './CalcPlanePlotModal.svelte';
	import CalcPointPlotModal from './CalcPointPlotModal.svelte';
	import ExploreDataModal from './ExploreDataModal.svelte';
	import { restoreByTitle, restoreById } from '$lib/stores/modalDock.svelte';
	import PathogenMultiSelect from './PathogenMultiSelect.svelte';
	import SurvivalPlot from './SurvivalPlot.svelte';
	import AlertDialog from './AlertDialog.svelte';
	import Modal from './Modal.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import PathogenSummary from './PathogenSummary.svelte';
	import OccupancyBanner from './OccupancyBanner.svelte';
	import { roomVolumeM3 } from '$lib/utils/unitConversion';
	import { irradianceFromDose, speciesWithDataAt, fractionOfLimit, hoursFromFraction, doseAtLimit, type TlvFraction } from '$lib/utils/resultsSummary';

	interface Props {
		onShowAudit?: () => void;
		onLampHover?: (lampId: string | null) => void;
		onOpenAdvancedSettings?: (lampId: string) => void;
		onSelectSpecies?: () => void;
		isoSettingsMap?: Record<string, IsoSettings>;
		isoGeometryMap?: Record<string, { isosurfaces: IsosurfaceData[]; valueRange: { min: number; max: number; range: number } }>;
		onIsoSettingsChange?: (zoneId: string, settings: IsoSettingsInput) => void;
	}

	let { onShowAudit, onLampHover, onOpenAdvancedSettings, onSelectSpecies, isoSettingsMap = {}, isoGeometryMap = {}, onIsoSettingsChange }: Props = $props();

	// Inline dose-time editing on the zone result cards (null = nothing being edited)
	let editingDoseTimeZoneId = $state<string | null>(null);

	// The sections below the Summary start folded; the Summary carries the headline numbers.
	let sectionOpen = $state({ safety: false, pathogens: false, ozone: false });
	function toggleSection(key: 'safety' | 'pathogens' | 'ozone') {
		sectionOpen = { ...sectionOpen, [key]: !sectionOpen[key] };
	}

	function openExploreData() {
		if (!restoreByTitle('Explore Pathogen Efficacy Data')) showExploreDataModal = true;
	}

	function autoFocus(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function toggleZoneDose(zone: CalcZone) {
		project.updateZone(zone.id, { dose: !(zone.dose ?? false) });
	}

	function startDoseTimeEdit(zoneId: string) {
		editingDoseTimeZoneId = zoneId;
	}

	function cancelDoseTimeEdit() {
		editingDoseTimeZoneId = null;
	}

	function commitDoseTimeEdit(zoneId: string, raw: string) {
		// Escape already closed the editor; the trailing blur must not commit.
		if (editingDoseTimeZoneId !== zoneId) return;
		const parsed = parseDoseTime(raw);
		// Unparseable input silently reverts to the stored value.
		if (parsed) project.updateZone(zoneId, parsed);
		editingDoseTimeZoneId = null;
	}

	function handleDoseTimeKeydown(e: KeyboardEvent, zoneId: string) {
		if (e.key === 'Enter') {
			commitDoseTimeEdit(zoneId, (e.target as HTMLInputElement).value);
		} else if (e.key === 'Escape') {
			cancelDoseTimeEdit();
		}
	}

	// Granular staleness detection using backend state hashes
	const lampStateStale = $derived($lampsStale);
	const roomStateStale = $derived($roomStale);

	// Per-zone staleness from state hashes
	const skinZoneStale = $derived.by(() => {
		const sh = $stateHashes;
		return isZoneStale('SkinLimits', sh.current, sh.lastCalculated);
	});

	const eyeZoneStale = $derived.by(() => {
		const sh = $stateHashes;
		return isZoneStale('EyeLimits', sh.current, sh.lastCalculated);
	});

	// Other zones stale if any non-safety zone hash changed
	const otherZoneStateStale = $derived.by(() => {
		const sh = $stateHashes;
		if (!sh.current || !sh.lastCalculated) return false;
		const safetyIds = new Set(['SkinLimits', 'EyeLimits']);
		for (const [id, hash] of Object.entries(sh.current.calc_state.calc_zones)) {
			if (safetyIds.has(id)) continue;
			if (hash !== sh.lastCalculated.calc_state.calc_zones[id]) return true;
		}
		// Check for zones that existed in lastCalculated but not in current
		for (const id of Object.keys(sh.lastCalculated.calc_state.calc_zones)) {
			if (safetyIds.has(id)) continue;
			if (!(id in sh.current.calc_state.calc_zones)) return true;
		}
		return false;
	});

	// Fluence results stale if lamps, room, or fluence zones changed
	const fluenceResultsStale = $derived(lampStateStale || roomStateStale || otherZoneStateStale);

	// Per-zone safety staleness
	const skinResultsStale = $derived(lampStateStale || roomStateStale || skinZoneStale);
	const eyeResultsStale = $derived(lampStateStale || roomStateStale || eyeZoneStale);

	// Either safety zone stale (for shared elements like compliance banner, checkLamps)
	const safetyResultsStale = $derived(skinResultsStale || eyeResultsStale);

	// Overall staleness (for backward compatibility - used by panel header)
	const isStale = $derived(fluenceResultsStale || safetyResultsStale);

	// Get zone result by ID
	function getZoneResult(zoneId: string): ZoneResult | null {
		if (!$results?.zones) return null;
		return $results.zones[zoneId] || null;
	}

	// Get zone display name
	function getZoneName(zone: CalcZone): string {
		return zone.name || zone.id.slice(0, 8);
	}

	// Check if zone has results
	function hasResults(zoneId: string): boolean {
		const result = getZoneResult(zoneId);
		return result?.statistics?.mean !== null && result?.statistics?.mean !== undefined;
	}

	// Separate standard zones from custom zones
	const standardZones = $derived($zones.filter(z => z.isStandard));
	const customZones = $derived($zones.filter(z => !z.isStandard && z.enabled !== false));

	// Check which standard zones are enabled
	const wholeRoomEnabled = $derived($zones.find(z => z.id === 'WholeRoomFluence')?.enabled !== false);
	const skinEnabled = $derived($zones.find(z => z.id === 'SkinLimits')?.enabled !== false);
	const eyeEnabled = $derived($zones.find(z => z.id === 'EyeLimits')?.enabled !== false);

	// Get WholeRoomFluence result (null if disabled)
	const wholeRoomResult = $derived(wholeRoomEnabled ? getZoneResult('WholeRoomFluence') : null);
	const avgFluence = $derived(wholeRoomResult?.statistics?.mean);

	// Get safety zone results (null if disabled)
	const skinResult = $derived(skinEnabled ? getZoneResult('SkinLimits') : null);
	const eyeResult = $derived(eyeEnabled ? getZoneResult('EyeLimits') : null);

	// Maximum 8-hour doses on the safety planes
	const skinMax = $derived(skinResult?.statistics?.max);
	const eyeMax = $derived(eyeResult?.statistics?.max);

	// Get check_lamps result for comprehensive safety analysis
	const checkLampsResult = $derived($results?.checkLamps);

	// Exposure as a fraction of the TLV under each standard. check-lamps weighs
	// every lamp's dose by that lamp's own TLV (as guv_calcs does), so a weak
	// 254 nm lamp counts for the dose it delivers rather than imposing its TLV
	// on the whole room. Before it has run, the monochromatic 222 nm limits
	// stand in.
	const acgihExposure = $derived.by((): TlvFraction | null =>
		checkLampsResult?.tlv_fraction_by_standard?.ACGIH
			?? fractionOfLimit(TLV_LIMITS['ANSI IES RP 27.1-22 (ACGIH Limits)'], skinMax, eyeMax));
	const icnirpExposure = $derived.by((): TlvFraction | null =>
		checkLampsResult?.tlv_fraction_by_standard?.ICNIRP
			?? fractionOfLimit(TLV_LIMITS['IEC 62471-6:2022 (ICNIRP Limits)'], skinMax, eyeMax));
	// The room's selected standard drives the safety table and the 2D plot's TLV line
	const selectedExposure = $derived(standardFamily($room.standard) === 'ICNIRP' ? icnirpExposure : acgihExposure);
	const skinHoursToLimit = $derived(hoursFromFraction(selectedExposure?.skin));
	const eyeHoursToLimit = $derived(hoursFromFraction(selectedExposure?.eye));
	// Raw dose at which the limit is reached for the lamps' spectral mix (the TLV itself for a single-spectrum room)
	const effectiveLimits = $derived({
		skin: doseAtLimit(skinMax, selectedExposure?.skin),
		eye: doseAtLimit(eyeMax, selectedExposure?.eye),
	});

	// Compliance flags come from the shared store so the results panel, the
	// next-step card and the audit never disagree.
	const skinShowNonCompliant = $derived($compliance.skinNonCompliant);
	const skinShowNearLimit = $derived($compliance.skinNearLimit);
	const eyeShowNonCompliant = $derived($compliance.eyeNonCompliant);
	const eyeShowNearLimit = $derived($compliance.eyeNearLimit);
	const anyNonCompliant = $derived($compliance.anyNonCompliant);
	const anyNearLimit = $derived($compliance.anyNearLimit);

	// Average 8-hour doses and the irradiances behind the 8-hour doses
	const skinMean = $derived(skinResult?.statistics?.mean);
	const eyeMean = $derived(eyeResult?.statistics?.mean);
	const skinIrradMax = $derived(irradianceFromDose(skinMax));
	const skinIrradMean = $derived(irradianceFromDose(skinMean));
	const eyeIrradMax = $derived(irradianceFromDose(eyeMax));
	const eyeIrradMean = $derived(irradianceFromDose(eyeMean));

	const wholeRoomZone = $derived($zones.find(z => z.id === 'WholeRoomFluence'));

	// Room volume for CADR, unit-corrected
	const volumeM3 = $derived(roomVolumeM3($room, $userSettings.units));

	// Handle standard change - update room, refresh compliance, and update staleness
	async function handleStandardChange(newStandard: GuvStandard) {
		// Update the local store (enqueues a room-update + zone refresh for UL8802 switches)
		project.updateRoom({ standard: newStandard });

		try {
			// Sync to backend and refresh state hashes so staleness UI updates
			await updateSessionRoom({ standard: newStandard });
			fetchStateHashesDebounced();

			// Re-fetch compliance data (limits differ between ACGIH and ICNIRP)
			if ($results) {
				const checkLampsResult = await checkLampsSession();
				project.setResults({ ...$results, checkLamps: checkLampsResult });
			}
		} catch (e) {
			console.warn('Failed to update standard:', e);
		}
	}

	// Prefetched explore data for instant modal opening — prefer store, fall back to local fetch
	let localExploreData = $state<EfficacyExploreResponse | null>(null);
	let prefetchedExploreData = $derived($results?.exploreData ?? localExploreData);

	// Zone options for the explore data modal zone selector
	const zoneOptions = $derived.by(() => {
		if (!$results?.zones) return [];
		return $zones
			.filter(z => {
				if (z.enabled === false) return false;
				// Exclude dose zones (they report mJ/cm² not µW/cm²)
				if (z.dose) return false;
				const result = $results!.zones[z.id];
				return result?.statistics?.mean != null;
			})
			.map(z => ({
				id: z.id,
				name: z.name || z.id,
				meanFluence: $results!.zones[z.id].statistics.mean!,
				zoneType: z.type
			}));
	});

	const singleLampWavelength = $derived.by(() => {
		const lampList = $lamps;
		if (lampList.length === 0) return undefined;
		const wavelengths = new Set(lampList.map(l => {
			if (l.wavelength != null) return l.wavelength;
			if (l.lamp_type === 'krcl_222') return 222;
			if (l.lamp_type === 'lp_254') return 254;
			return undefined;
		}).filter((w): w is number => w != null));
		return wavelengths.size === 1 ? [...wavelengths][0] : undefined;
	});

	async function fetchExploreData() {
		try {
			const data = await getEfficacyExploreData();
			localExploreData = data;
			// Persist into the store so it survives re-renders
			const latest = $results;
			if (latest && !latest.exploreData) {
				project.setResults({ ...latest, exploreData: data });
			}
		} catch (e) {
			console.warn('Failed to prefetch explore data:', e);
			localExploreData = null;
		}
	}

	// Fetch explore data if not already in the store after calculation
	let exploreFetchedForCalc = $state<string | null>(null);
	$effect(() => {
		const calcAt = $results?.calculatedAt;
		if (calcAt && calcAt !== exploreFetchedForCalc && !$results?.exploreData) {
			exploreFetchedForCalc = calcAt;
			fetchExploreData();
		}
	});

	// Build per-wavelength fluence dict for efficacy calculations.
	// Prefer backend-provided fluenceByWavelength; fall back to single-wavelength from lamp type.
	const fluenceDict = $derived.by((): Record<number, number> | null => {
		if (!avgFluence) return null;
		const byWv = $results?.fluenceByWavelength;
		if (byWv && Object.keys(byWv).length > 0) return byWv;
		// Fallback: determine wavelength from lamps
		const lampList = $lamps;
		if (lampList.length === 0) return { 222: avgFluence };
		const wavelengths = new Set(lampList.map(l => {
			if (l.wavelength != null) return l.wavelength;
			if (l.lamp_type === 'krcl_222') return 222;
			if (l.lamp_type === 'lp_254') return 254;
			return undefined;
		}).filter((w): w is number => w != null));
		const wv = wavelengths.size === 1 ? [...wavelengths][0] : 222;
		return { [wv]: avgFluence };
	});

	// Parse explore data into typed rows
	const efficacyRows = $derived.by(() => {
		const data = prefetchedExploreData;
		if (!data?.table) return [];
		return parseTableResponse(data.table.columns, data.table.rows);
	});

	// Check if any fluenceDict wavelengths are missing from the efficacy database
	const missingEfficacyWavelengths = $derived.by((): number[] => {
		if (!fluenceDict) return [];
		const available = new Set(
			(prefetchedExploreData?.wavelengths ?? []).map(w => Math.round(w))
		);
		if (available.size === 0) return []; // No data loaded yet
		return Object.keys(fluenceDict).map(Number).filter(wv => !available.has(wv));
	});

	// Species with aerosol data at every lamp wavelength, and their categories
	const comparableSpecies = $derived(fluenceDict ? speciesWithDataAt(efficacyRows, Object.keys(fluenceDict).map(Number)) : []);
	const speciesCategory = $derived.by(() => {
		const m = new Map<string, string>();
		for (const r of efficacyRows) if (r.medium === 'Aerosol' && !m.has(r.species)) m.set(r.species, r.category);
		return m;
	});
	function setResultSpecies(selected: string[]) {
		userSettings.update(s => ({ ...s, resultSpecies: selected }));
	}

	// Compute averaged kinetics per species (client-side, replaces backend disinfection table)
	const speciesKinetics = $derived.by((): SpeciesKinetics[] => {
		if (efficacyRows.length === 0 || !fluenceDict) return [];
		if (missingEfficacyWavelengths.length > 0) return []; // No valid data
		const species = $userSettings.resultSpecies;
		const speciesList = species.length > 0 ? species : DEFAULT_TARGET_SPECIES;
		return averageKineticsBySpecies(efficacyRows, speciesList, fluenceDict);
	});

	// Compute disinfection table rows client-side
	const disinfectionRows = $derived.by(() => {
		if (speciesKinetics.length === 0) return [];
		return speciesKinetics.map(sp => {
			const s90 = logReductionTime(1, sp.irradList, sp.k1List, sp.k2List, sp.fList);
			const s99 = logReductionTime(2, sp.irradList, sp.k1List, sp.k2List, sp.fList);
			const s999 = logReductionTime(3, sp.irradList, sp.k1List, sp.k2List, sp.fList);
			const each = eachUV(sp.irradList, sp.k1List, sp.k2List, sp.fList);
			return {
				species: sp.species,
				each: Number.isFinite(each) ? each : null,
				seconds_to_90: isFinite(s90) ? s90 : null,
				seconds_to_99: isFinite(s99) ? s99 : null,
				seconds_to_99_9: isFinite(s999) ? s999 : null,
			};
		}).filter(r => r.seconds_to_90 != null || r.seconds_to_99 != null || r.seconds_to_99_9 != null);
	});

	// Format seconds to readable time
	function formatTime(seconds: number | null): string {
		if (seconds === null || seconds === undefined) return '—';
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}

	// Ozone estimation (222nm only)
	const OZONE_GENERATION_CONSTANT = 10.0;
	const hasAny222nmLamps = $derived(
		$lamps.length > 0 && $lamps.some(l => l.lamp_type === 'krcl_222')
	);

	// Get 222nm-specific fluence for ozone calculation
	const fluence222 = $derived.by(() => {
		if (!fluenceDict) return null;
		return fluenceDict[222] ?? null;
	});

	// Compute ozone client-side so it updates reactively when air_changes or decay_constant change
	const ozoneValue = $derived.by(() => {
		if (!fluence222) return null;
		const airChanges = $room.air_changes ?? ROOM_DEFAULTS.air_changes;
		const decayConstant = $room.ozone_decay_constant ?? ROOM_DEFAULTS.ozone_decay_constant;
		const denominator = airChanges + decayConstant;
		if (denominator <= 0) return null;
		return fluence222 * OZONE_GENERATION_CONSTANT / denominator;
	});

	// Quick audit warning count (for icon coloring)
	const hasAuditWarnings = $derived($auditProblems.length > 0);

	// Alert dialog state
	let alertDialog = $state<{ title: string; message: string } | null>(null);

	// Export zone data as CSV using backend
	let exportingZoneId = $state<string | null>(null);

	// Plane plot modal state (for planes - uses frontend 3D heatmap)
	let planePlotModalZone = $state<{ id: string; name: string; zone: CalcZone; values: number[][]; valueFactor: number } | null>(null);

	// Volume plot modal state (for volumes - uses frontend 3D isosurface)
	let volumePlotModalZone = $state<{ id: string; name: string; zone: CalcZone; values: number[][][]; valueFactor: number } | null>(null);
	// Point plot modal state (for points - uses frontend 3D scene)
	let pointPlotModalZone = $state<{ id: string; name: string; zone: CalcZone; value: number; valueUnits: string; valueFactor: number } | null>(null);

	// Explore data modal state
	let showExploreDataModal = $state(false);

	function openPlanePlotModal(zoneId: string, zoneName: string) {
		if (restoreById(`plane-plot-${zoneId}`)) return;
		const zone = $zones.find(z => z.id === zoneId);
		const result = getZoneResult(zoneId);
		if (!zone || !result?.values) return;
		const factor = doseConversionFactor(zone.dose ?? false, totalHours(zone.hours ?? 8, zone.minutes ?? 0, zone.seconds ?? 0), result.doseAtCalcTime, result.hoursAtCalcTime);
		planePlotModalZone = {
			id: zoneId,
			name: zoneName,
			zone: zone,
			values: result.values as number[][],
			valueFactor: factor
		};
	}

	function closePlanePlotModal() {
		planePlotModalZone = null;
	}

	function openVolumePlotModal(zoneId: string, zoneName: string) {
		if (restoreById(`vol-plot-${zoneId}`)) return;
		const zone = $zones.find(z => z.id === zoneId);
		const result = getZoneResult(zoneId);
		if (!zone || !result?.values) return;
		const factor = doseConversionFactor(zone.dose ?? false, totalHours(zone.hours ?? 8, zone.minutes ?? 0, zone.seconds ?? 0), result.doseAtCalcTime, result.hoursAtCalcTime);
		volumePlotModalZone = {
			id: zoneId,
			name: zoneName,
			zone: zone,
			// $state.snapshot() materializes the deep Svelte proxy into a plain
			// array.  Without this, every values[i][j][k] access in the modal's
			// marching-cubes loop goes through Proxy traps (~10x slower).
			values: $state.snapshot(result.values) as number[][][],
			valueFactor: factor
		};
	}

	function closeVolumePlotModal() {
		volumePlotModalZone = null;
	}

	function openPointPlotModal(zoneId: string, zoneName: string) {
		if (restoreById(`point-plot-${zoneId}`)) return;
		const zone = $zones.find(z => z.id === zoneId);
		const result = getZoneResult(zoneId);
		if (!zone || result?.statistics?.mean == null) return;
		const factor = doseConversionFactor(zone.dose ?? false, totalHours(zone.hours ?? 8, zone.minutes ?? 0, zone.seconds ?? 0), result.doseAtCalcTime, result.hoursAtCalcTime);
		pointPlotModalZone = {
			id: zoneId,
			name: zoneName,
			zone: zone,
			value: result.statistics.mean,
			valueUnits: result.value_units ?? '\u00B5W/cm\u00B2',
			valueFactor: factor
		};
	}

	function closePointPlotModal() {
		pointPlotModalZone = null;
	}

	// Generic handler that routes to the appropriate modal based on zone type
	function handleShowPlot(zone: CalcZone, zoneName: string) {
		if (zone.type === 'volume') {
			openVolumePlotModal(zone.id, zoneName);
		} else if (zone.type === 'point') {
			openPointPlotModal(zone.id, zoneName);
		} else {
			openPlanePlotModal(zone.id, zoneName);
		}
	}

	async function exportZoneCSV(zoneId: string) {
		const zone = $zones.find(z => z.id === zoneId);
		if (!zone) return;

		exportingZoneId = zoneId;
		try {
			const blob = await getSessionZoneExport(zoneId);
			const zoneName = zone.name || zoneId;
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${zoneName}.csv`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('Failed to export zone:', error);
			alertDialog = { title: 'Export Failed', message: 'Failed to export zone. Please try again.' };
		} finally {
			exportingZoneId = null;
		}
	}

	// Generate summary report using backend session
	let isGeneratingReport = $state(false);

	async function generateReport() {
		if (isGeneratingReport) return;

		isGeneratingReport = true;
		try {
			// Use session report (uses existing Room, no recalculation)
			const blob = await getSessionReport();

			// Download the CSV file
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${$project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_report.csv`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('Failed to generate report:', error);
			alertDialog = { title: 'Report Failed', message: 'Failed to generate report. Please try again.' };
		} finally {
			isGeneratingReport = false;
		}
	}

	// Export all results as ZIP using backend
	let isExportingAll = $state(false);
	let includePlots = $state(false);
	let showSaveDropdown = $state(false);

	async function exportAllResults() {
		if (isExportingAll) return;

		isExportingAll = true;
		try {
			const blob = await getSessionExportZip({ include_plots: includePlots });

			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'illuminate.zip';
			a.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('Failed to export all results:', error);
			alertDialog = { title: 'Export Failed', message: 'Failed to export results. Please try again.' };
		} finally {
			isExportingAll = false;
		}
	}
</script>

<div class="stats-panel">
	<div class="panel-header">
		<h3>Results</h3>
		<div class="panel-header-right">
			{#if onShowAudit}
				<button
					class="audit-btn"
					class:has-warnings={hasAuditWarnings}
					onclick={onShowAudit}
					title="Design Audit"
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="10"/>
						<line x1="12" y1="8" x2="12" y2="12"/>
						<line x1="12" y1="16" x2="12.01" y2="16"/>
					</svg>
				</button>
			{/if}
			{#if $results}
				<span class="calc-time">
					{new Date($results.calculatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
				</span>
			{/if}
		</div>
	</div>

	{#if !$results}
		<div class="empty-state">
			<p>No results yet</p>
			<div class="next-hint tone-{$nextStep.tone}" data-next-step={$nextStep.id}>
				<p class="next-hint-title">{$nextStep.title}</p>
			</div>
		</div>
	{:else}
		<!-- Custom Calculation Zones Section (fluence-dependent) -->
		{#if customZones.length > 0}
			<section class="results-section stale-wrapper">
				{#if fluenceResultsStale}<div class="stale-overlay"></div>{/if}
				<h4 class="section-title">Custom Calculation Zones</h4>

				{#each customZones as zone (zone.id)}
					{@const result = getZoneResult(zone.id)}
					{@const factor = result ? doseConversionFactor(zone.dose ?? false, totalHours(zone.hours ?? 8, zone.minutes ?? 0, zone.seconds ?? 0), result.doseAtCalcTime, result.hoursAtCalcTime) : 1}
					<div class="zone-card" class:calculated={hasResults(zone.id)}>
						<div class="zone-header">
							<span class="zone-name">{getZoneName(zone)}</span>
							<span class="zone-type">{zone.type}</span>
						</div>

						{#if result?.statistics}
							{#if zone.type === 'point'}
								<div class="stats-grid-small">
									<div class="stat">
										<span class="stat-label">Value</span>
										<span class="stat-value highlight">{formatValue(result.statistics.mean != null ? result.statistics.mean * factor : result.statistics.mean)}</span>
									</div>
								</div>
							{:else}
								<div class="stats-grid-small">
									<div class="stat">
										<span class="stat-label">Mean</span>
										<span class="stat-value highlight">{formatValue(result.statistics.mean != null ? result.statistics.mean * factor : result.statistics.mean)}</span>
									</div>
									<div class="stat">
										<span class="stat-label">Max</span>
										<span class="stat-value">{formatValue(result.statistics.max != null ? result.statistics.max * factor : result.statistics.max)}</span>
									</div>
									<div class="stat">
										<span class="stat-label">Min</span>
										<span class="stat-value">{formatValue(result.statistics.min != null ? result.statistics.min * factor : result.statistics.min)}</span>
									</div>
								</div>
							{/if}
							<div class="zone-footer">
								<div class="units-label">
									<button
										type="button"
										class="units-toggle"
										title={zone.dose ? 'Switch to fluence rate (µW/cm²)' : 'Switch to dose (mJ/cm²)'}
										onclick={() => toggleZoneDose(zone)}
									>
										{zone.dose ? 'mJ/cm²' : 'µW/cm²'}<span class="swap-glyph" aria-hidden="true">⇄</span>
									</button>
									{#if zone.dose}
										{#if editingDoseTimeZoneId === zone.id}
											<!-- svelte-ignore a11y_autofocus -->
											<input
												type="text"
												class="dose-time-input"
												aria-label="Dose exposure time"
												value={formatDoseTime(zone.hours ?? 8, zone.minutes ?? 0, zone.seconds ?? 0)}
												onblur={(e) => commitDoseTimeEdit(zone.id, (e.target as HTMLInputElement).value)}
												onkeydown={(e) => handleDoseTimeKeydown(e, zone.id)}
												use:autoFocus
											/>
										{:else}
											<span
												class="dose-time-btn"
												role="button"
												tabindex="0"
												title="Click to edit the dose exposure time"
												onclick={() => startDoseTimeEdit(zone.id)}
												onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startDoseTimeEdit(zone.id); } }}
											>
												({formatDoseTime(zone.hours ?? 8, zone.minutes ?? 0, zone.seconds ?? 0)} dose)
											</span>
										{/if}
									{/if}
								</div>
								{#if result.values}
									<div class="zone-actions">
										<button
											class="export-btn small"
											onclick={() => handleShowPlot(zone, getZoneName(zone))}
										>
											Show Plot
										</button>
										<button class="export-btn small" onclick={() => exportZoneCSV(zone.id)} disabled={exportingZoneId === zone.id}>
											{exportingZoneId === zone.id ? '...' : 'Export CSV'}
										</button>
									</div>
								{/if}
							</div>
						{:else}
							<div class="no-results">Not calculated</div>
						{/if}
					</div>
				{/each}
			</section>
		{/if}

		<!-- Summary Section -->
		{#if $room.useStandardZones}
			<section class="results-section">
				<h4 class="section-title">Summary</h4>

				<!-- Fluence, selectable pathogen, eACH, CADR and inactivation times -->
				<div class="stale-wrapper">
					{#if fluenceResultsStale}<div class="stale-overlay"></div>{/if}
					<PathogenSummary
						rows={efficacyRows}
						{fluenceDict}
						{avgFluence}
						{volumeM3}
						missingWavelengths={missingEfficacyWavelengths}
						onShowFluencePlot={wholeRoomResult?.values && wholeRoomZone ? () => handleShowPlot(wholeRoomZone, 'WholeRoomFluence') : undefined}
					/>
				</div>

				<!-- Occupancy: hours before the TLV is reached under either standard -->
				<div class="stale-wrapper">
					{#if safetyResultsStale}<div class="stale-overlay"></div>{/if}
					<OccupancyBanner acgih={acgihExposure} icnirp={icnirpExposure} />
				</div>

				<button class="export-btn report-btn" onclick={generateReport} disabled={isGeneratingReport}>
					{isGeneratingReport ? 'Generating...' : 'Generate Report'}
				</button>
			</section>
		{:else}
			<section class="results-section">
				<button class="export-btn report-btn" onclick={generateReport} disabled={isGeneratingReport}>
					{isGeneratingReport ? 'Generating...' : 'Generate Report'}
				</button>
			</section>
		{/if}

		<!-- Photobiological Safety Section (per-zone staleness) -->
		{#if (skinMax !== undefined || eyeMax !== undefined)}
			<section class="results-section">
				<button type="button" class="section-toggle" aria-expanded={sectionOpen.safety} onclick={() => toggleSection('safety')}>
					<span class="chevron">{sectionOpen.safety ? '▼' : '▶'}</span>
					<h4 class="section-title">Photobiological Safety</h4>
				</button>

				{#if sectionOpen.safety}
				<div class="standard-selector">
					<label for="standard">Standard</label>
					<select id="standard" value={$room.standard} onchange={(e) => handleStandardChange((e.target as HTMLSelectElement).value as GuvStandard)} >
						<option value="ANSI IES RP 27.1-22 (ACGIH Limits)">ANSI IES RP 27.1-22 (ACGIH Limits)</option>
						<option value="IEC 62471-6:2022 (ICNIRP Limits)">IEC 62471-6:2022 (ICNIRP Limits)</option>
						<option value="UL8802 (ACGIH Limits)">UL8802 (ACGIH Limits)</option>
					</select>
				</div>

				<table class="safety-table">
					<thead>
						<tr>
							<th></th>
							<th>Skin</th>
							<th>Eye</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td class="row-label">Hours to TLV</td>
							<td class:stale-cell={skinResultsStale}
								class:compliant={skinHoursToLimit != null && skinHoursToLimit >= 8}
								class:near-limit={skinHoursToLimit != null && skinHoursToLimit < 8}>
								{#if skinHoursToLimit && skinHoursToLimit >= 8}
									Indefinite ({formatValue(skinHoursToLimit, 1)} h)
								{:else if skinHoursToLimit}
									{formatValue(skinHoursToLimit, 1)} h
								{:else}
									—
								{/if}
							</td>
							<td class:stale-cell={eyeResultsStale}
								class:compliant={eyeHoursToLimit != null && eyeHoursToLimit >= 8}
								class:near-limit={eyeHoursToLimit != null && eyeHoursToLimit < 8}>
								{#if eyeHoursToLimit && eyeHoursToLimit >= 8}
									Indefinite ({formatValue(eyeHoursToLimit, 1)} h)
								{:else if eyeHoursToLimit}
									{formatValue(eyeHoursToLimit, 1)} h
								{:else}
									—
								{/if}
							</td>
						</tr>
						<tr>
							<td class="row-label">Max 8‑h dose <span class="unit">mJ/cm²</span></td>
							<td class:stale-cell={skinResultsStale}>{formatValue(skinMax, 1)}</td>
							<td class:stale-cell={eyeResultsStale}>{formatValue(eyeMax, 1)}</td>
						</tr>
						<tr>
							<td class="row-label">Average 8‑h dose <span class="unit">mJ/cm²</span></td>
							<td class:stale-cell={skinResultsStale}>{skinMean != null ? formatValue(skinMean, 1) : '—'}</td>
							<td class:stale-cell={eyeResultsStale}>{eyeMean != null ? formatValue(eyeMean, 1) : '—'}</td>
						</tr>
						<tr>
							<td class="row-label">Max irradiance <span class="unit">µW/cm²</span></td>
							<td class:stale-cell={skinResultsStale}>{skinIrradMax != null ? formatValue(skinIrradMax, 3) : '—'}</td>
							<td class:stale-cell={eyeResultsStale}>{eyeIrradMax != null ? formatValue(eyeIrradMax, 3) : '—'}</td>
						</tr>
						<tr>
							<td class="row-label">Average irradiance <span class="unit">µW/cm²</span></td>
							<td class:stale-cell={skinResultsStale}>{skinIrradMean != null ? formatValue(skinIrradMean, 3) : '—'}</td>
							<td class:stale-cell={eyeResultsStale}>{eyeIrradMean != null ? formatValue(eyeIrradMean, 3) : '—'}</td>
						</tr>
						<tr>
							<td class="row-label"></td>
							<td>
								{#if skinResult?.values}
									{@const zone = $zones.find(z => z.id === 'SkinLimits')}
									{#if zone}<button class="export-btn small" onclick={() => handleShowPlot(zone, 'SkinLimits')}>Show Plot</button>{/if}
								{/if}
							</td>
							<td>
								{#if eyeResult?.values}
									{@const zone = $zones.find(z => z.id === 'EyeLimits')}
									{#if zone}<button class="export-btn small" onclick={() => handleShowPlot(zone, 'EyeLimits')}>Show Plot</button>{/if}
								{/if}
							</td>
						</tr>
					</tbody>
				</table>

				<!-- Dimming, warnings, per-lamp details: depend on both zones -->
				<div class="stale-wrapper">
					{#if safetyResultsStale}<div class="stale-overlay"></div>{/if}

					<!-- Dimming recommendation if needed -->
					{#if checkLampsResult}
						{@const lampsNeedingDimming = Object.values(checkLampsResult.lamp_results).filter(
							(lamp: LampComplianceResult) => lamp.skin_dimming_required < 1 || lamp.eye_dimming_required < 1
						)}
						{#if lampsNeedingDimming.length === 1}
							{@const lamp = lampsNeedingDimming[0] as LampComplianceResult}
							{@const dimmingNeeded = Math.min(lamp.skin_dimming_required, lamp.eye_dimming_required)}
							{@const minimum = Math.floor(dimmingNeeded * 100)}
							{@const suggestedRaw = Math.max(Math.floor(dimmingNeeded * 0.9 * 100), 0)}
							{@const suggested = suggestedRaw >= minimum ? minimum - 1 : suggestedRaw}
							<div class="dimming-note">
								Dim to {suggested}% (minimum {minimum}%) for compliance
							</div>
						{:else if lampsNeedingDimming.length > 1}
							<div class="dimming-note">
								{lampsNeedingDimming.length} lamps require dimming for compliance
							</div>
						{/if}
					{/if}

					<!-- General safety warnings (non-lamp-specific) -->
					{#if checkLampsResult && checkLampsResult.warnings && checkLampsResult.warnings.length > 0}
						{@const generalWarnings = checkLampsResult.warnings.filter((w: SafetyWarning) => !w.lamp_id && !w.message.toLowerCase().includes('even after') && !w.message.includes('zone not found'))}
						{#if generalWarnings.length > 0}
							<div class="safety-warnings">
								{#each generalWarnings as warning}
									<div class="warning-item warning-{warning.level}">
										<span class="warning-icon">
											{#if warning.level === 'error'}!{:else if warning.level === 'warning'}!{:else}i{/if}
										</span>
										<span class="warning-message">{warning.message}</span>
									</div>
								{/each}
							</div>
						{/if}
					{/if}

					<!-- Per-lamp compliance details (collapsible) - only show if something is non-compliant -->
					{#if checkLampsResult && Object.keys(checkLampsResult.lamp_results).length > 0 && anyNonCompliant}
						<details class="lamp-compliance-details">
							<summary>Per-lamp compliance details</summary>
							<div class="lamp-compliance-list">
								{#each Object.values(checkLampsResult.lamp_results) as lampResult}
									{@const isCompliant = lampResult.is_skin_compliant && lampResult.is_eye_compliant}
									{@const dimmingRequired = Math.min(lampResult.skin_dimming_required, lampResult.eye_dimming_required)}
									{@const lampWarnings = checkLampsResult.warnings?.filter((w: SafetyWarning) => w.lamp_id === lampResult.lamp_id) || []}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
								{@const lampInstance = $lamps.find(l => l.id === lampResult.lamp_id)}
								<div class="lamp-compliance-item" class:lamp-compliant={isCompliant} class:lamp-non-compliant={!isCompliant}
									onmouseenter={() => onLampHover?.(lampResult.lamp_id)}
									onmouseleave={() => onLampHover?.(null)}>
										<div class="lamp-compliance-header">
											<span class="lamp-name">{lampResult.lamp_name}{#if lampInstance && lampInstance.scaling_factor !== 1} ({(lampInstance.scaling_factor * 100).toFixed(0)}%){/if}</span>
											{#if isCompliant}
												<span class="lamp-status compliant">✓ Compliant</span>
											{:else}
												{@const minimum = Math.floor(dimmingRequired * 100)}
												{@const suggestedRaw = Math.max(Math.floor(dimmingRequired * 0.9 * 100), 0)}
												{@const suggested = suggestedRaw >= minimum ? minimum - 1 : suggestedRaw}
												<span class="lamp-dimming">Dim to {suggested}% (min {minimum}%)</span>
											{/if}
										</div>
										<div class="lamp-compliance-stats">
											<div class="lamp-stat">
												<span class="lamp-stat-label">Skin</span>
												<span class="lamp-stat-value" class:compliant={lampResult.is_skin_compliant} class:non-compliant={!lampResult.is_skin_compliant}>
													{formatValue(lampResult.skin_dose_max, 1)} / {formatValue(lampResult.skin_tlv, 1)} mJ/cm²
												</span>
											</div>
											<div class="lamp-stat">
												<span class="lamp-stat-label">Eye</span>
												<span class="lamp-stat-value" class:compliant={lampResult.is_eye_compliant} class:non-compliant={!lampResult.is_eye_compliant}>
													{formatValue(lampResult.eye_dose_max, 1)} / {formatValue(lampResult.eye_tlv, 1)} mJ/cm²
												</span>
											</div>
										</div>
										{#if lampResult.missing_spectrum}
											<div class="lamp-warning">Missing spectrum data</div>
										{/if}
										{#if lampWarnings.length > 0}
											<div class="lamp-warnings">
												{#each lampWarnings as warning}
													<div class="lamp-warning warning-{warning.level}">{warning.message}</div>
												{/each}
											</div>
										{/if}
										{#if !isCompliant && onOpenAdvancedSettings}
											<button class="dim-settings-btn" onclick={() => onOpenAdvancedSettings(lampResult.lamp_id)}>
												Apply dim settings...
											</button>
										{/if}
									</div>
								{/each}
							</div>
						</details>
					{/if}
				</div>
				{/if}
			</section>
		{/if}

		<!-- Pathogen Reduction Section (fluence-dependent) -->
		{#if avgFluence !== null && avgFluence !== undefined}
			<section class="results-section stale-wrapper">
				{#if fluenceResultsStale}<div class="stale-overlay"></div>{/if}
				<div class="section-title-row">
					<button type="button" class="section-toggle" aria-expanded={sectionOpen.pathogens} onclick={() => toggleSection('pathogens')}>
						<span class="chevron">{sectionOpen.pathogens ? '▼' : '▶'}</span>
						<h4 class="section-title">Pathogen Reduction in Air</h4>
					</button>
				</div>

				{#if sectionOpen.pathogens}
				<button class="export-btn explore-data-btn" onclick={openExploreData}>Explore pathogen data…</button>

				{#if comparableSpecies.length > 0}
					<PathogenMultiSelect
						options={comparableSpecies}
						categoryOf={speciesCategory}
						selected={$userSettings.resultSpecies}
						onChange={setResultSpecies}
					/>
				{/if}

				{#if disinfectionRows.length > 0}
					<!-- Comparison table: one line per chosen pathogen -->
					<div class="disinfection-table">
						<div class="table-header">
							<span class="col-species">Pathogen</span>
							<span class="col-time keep-case" title="Equivalent air changes per hour from UV">eACH</span>
							<span class="col-time keep-case" title="Time to 99% inactivation">Time to 99%</span>
						</div>
						{#each disinfectionRows as row}
							<div class="table-row">
								<span class="col-species" title={row.species}>{row.species}</span>
								<span class="col-time">{row.each != null ? formatValue(row.each, 1) : '—'}</span>
								<span class="col-time">{formatTime(row.seconds_to_99)}</span>
							</div>
						{/each}
					</div>

					<!-- Survival curves for the chosen pathogens -->
					{#if speciesKinetics.length > 0 && avgFluence}
						<div class="survival-plot">
							<SurvivalPlot speciesData={speciesKinetics} totalFluence={avgFluence!} />
						</div>
					{/if}
				{:else}
					{#if missingEfficacyWavelengths.length > 0}
						<div class="wavelength-warning">
							No pathogen inactivation data available for {missingEfficacyWavelengths.join(', ')} nm.
							Data exists for nearby wavelengths — see Explore pathogen data for details.
						</div>
					{:else if comparableSpecies.length > 0}
						<p class="text-muted table-hint">Choose pathogens above to compare them.</p>
					{/if}
				{/if}
				{/if}
			</section>
		{/if}

		<!-- Ozone Generation Section (222nm only, fluence-dependent) -->
		{#if hasAny222nmLamps && fluence222}
			<section class="results-section stale-wrapper">
				{#if fluenceResultsStale}<div class="stale-overlay"></div>{/if}
				<button type="button" class="section-toggle" aria-expanded={sectionOpen.ozone} onclick={() => toggleSection('ozone')}>
					<span class="chevron">{sectionOpen.ozone ? '▼' : '▶'}</span>
					<h4 class="section-title">Ozone Generation</h4>
				</button>

				{#if sectionOpen.ozone}
				<div class="ozone-inputs">
					<div class="input-row">
						<label for="air-changes">Air changes/hr</label>
						<ValidatedNumberInput
							id="air-changes"
							value={$room.air_changes || ROOM_DEFAULTS.air_changes}
							oncommit={(v) => project.updateRoom({ air_changes: v })}
							min={0}
							step={0.1}
						/>
					</div>
					<div class="input-row">
						<label for="ozone-decay">Decay constant</label>
						<ValidatedNumberInput
							id="ozone-decay"
							value={$room.ozone_decay_constant || ROOM_DEFAULTS.ozone_decay_constant}
							oncommit={(v) => project.updateRoom({ ozone_decay_constant: v })}
							min={0}
							step={0.1}
						/>
					</div>
				</div>


				{#if ozoneValue !== null}
					<div class="summary-row">
						<span class="summary-label">Estimated O₃ Increase</span>
						<span class="summary-value" class:warning={ozoneValue > OZONE_WARNING_THRESHOLD_PPB} class:ok={ozoneValue <= OZONE_WARNING_THRESHOLD_PPB}>
							{formatValue(ozoneValue, 2)} ppb
						</span>
					</div>
					{/if}
				{/if}
			</section>
		{/if}

		<!-- Export Results Dropdown -->
		{#if $results?.zones && Object.keys($results.zones).length > 0}
			<section class="results-section export-section">
			<button type="button" class="section-toggle" aria-expanded={showSaveDropdown} onclick={() => showSaveDropdown = !showSaveDropdown}>
				<span class="chevron">{showSaveDropdown ? '▼' : '▶'}</span>
				<h4 class="section-title">Export Results</h4>
			</button>

			{#if showSaveDropdown}
				<div class="dropdown-section">
					<div class="export-row">
						<button class="export-btn" onclick={exportAllResults} disabled={isExportingAll}>
							{isExportingAll ? 'Exporting...' : 'Export All (ZIP)'}
						</button>
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={includePlots} use:enterToggle />
							<span>Include plots</span>
						</label>
					</div>

					<div class="export-divider"></div>

					<table class="export-table">
						<tbody>
							{#each $zones.filter(z => hasResults(z.id)) as zone (zone.id)}
								{@const result = getZoneResult(zone.id)}
								{#if result?.values || zone.type === 'point'}
									<tr>
										<td class="zone-name-cell">{zone.name || zone.id}</td>
										<td class="action-cell">
											<button
												class="export-btn small"
												onclick={() => handleShowPlot(zone, zone.name || zone.id)}
											>
												Show Plot
											</button>
										</td>
										<td class="action-cell">
											<button class="export-btn small" onclick={() => exportZoneCSV(zone.id)} disabled={exportingZoneId === zone.id}>
												{exportingZoneId === zone.id ? '...' : 'Export CSV'}
											</button>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
		{/if}
	{/if}
</div>

<!-- Plane Plot Modal (3D heatmap view) -->
{#if planePlotModalZone}
	<CalcPlanePlotModal
		zone={planePlotModalZone.zone}
		zoneName={planePlotModalZone.name}
		room={$room}
		values={planePlotModalZone.values}
		valueFactor={planePlotModalZone.valueFactor}
		effectiveTlv={planePlotModalZone.zone.id === 'SkinLimits' ? effectiveLimits.skin : planePlotModalZone.zone.id === 'EyeLimits' ? effectiveLimits.eye : undefined}
		onclose={closePlanePlotModal}
		dockId={`plane-plot-${planePlotModalZone.id}`}
	/>
{/if}

<!-- Volume Plot Modal (3D isosurface view) -->
{#if volumePlotModalZone}
	<CalcVolPlotModal
		zone={volumePlotModalZone.zone}
		zoneName={volumePlotModalZone.name}
		room={$room}
		values={volumePlotModalZone.values}
		valueFactor={volumePlotModalZone.valueFactor}
		isoSettings={isoSettingsMap[volumePlotModalZone.id]}
		prebuiltIsosurfaces={isoGeometryMap[volumePlotModalZone.id]?.isosurfaces}
		prebuiltValueRange={isoGeometryMap[volumePlotModalZone.id]?.valueRange}
		onIsoSettingsChange={(s) => { onIsoSettingsChange?.(volumePlotModalZone!.id, s); }}
		onclose={closeVolumePlotModal}
		dockId={`vol-plot-${volumePlotModalZone.id}`}
	/>
{/if}

<!-- Point Plot Modal -->
{#if pointPlotModalZone}
	<CalcPointPlotModal
		zone={pointPlotModalZone.zone}
		zoneName={pointPlotModalZone.name}
		room={$room}
		value={pointPlotModalZone.value}
		valueUnits={pointPlotModalZone.valueUnits}
		valueFactor={pointPlotModalZone.valueFactor}
		onclose={closePointPlotModal}
		dockId={`point-plot-${pointPlotModalZone.id}`}
	/>
{/if}

<!-- Explore Data Modal -->
{#if showExploreDataModal}
	<ExploreDataModal
		fluence={avgFluence}
		wavelength={singleLampWavelength}
		room={$room}
		airChanges={$room.air_changes || ROOM_DEFAULTS.air_changes}
		onclose={() => showExploreDataModal = false}
		prefetchedData={prefetchedExploreData ?? undefined}
		{zoneOptions}
	/>
{/if}

{#if alertDialog}
	<AlertDialog
		title={alertDialog.title}
		message={alertDialog.message}
		onDismiss={() => alertDialog = null}
	/>
{/if}

<style>
	.stats-panel {
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding-right: var(--spacing-md);
	}

	/* Container for per-section staleness overlay */
	.stale-wrapper {
		position: relative;
	}

	.stale-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--color-bg);
		opacity: 0.7;
		z-index: 10;
		pointer-events: none;
		border-radius: var(--radius-sm);
	}

	/* Per-cell staleness for table cells (no overlay needed) */
	.stale-cell {
		opacity: 0.3;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-md);
		padding-bottom: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
		position: sticky;
		top: 0;
		background: var(--color-bg);
		z-index: 1;
	}

	.panel-header h3 {
		margin: 0;
		font-size: 1rem;
	}

	.panel-header-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	/* More specific than .export-btn (declared later) so these sizes win */
	.export-btn.report-btn {
		width: 100%;
		min-height: 40px;
		margin-top: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: var(--font-size-base);
		font-weight: 600;
	}

	.audit-btn {
		background: transparent;
		border: none;
		padding: 2px;
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: all 0.15s;
		opacity: 0.5;
	}

	.audit-btn:hover {
		opacity: 1;
		background: var(--color-bg-tertiary);
	}

	.audit-btn.has-warnings {
		color: var(--color-near-limit);
		opacity: 1;
	}

	.audit-btn.has-warnings:hover {
		background: color-mix(in srgb, var(--color-near-limit) 15%, transparent);
	}

	.calc-time {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.empty-state {
		text-align: center;
		padding: var(--spacing-lg);
		color: var(--color-text-muted);
	}

	.empty-state p {
		margin: 0 0 var(--spacing-sm) 0;
	}

	.next-hint {
		--tone: var(--color-primary);
		margin-top: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		text-align: left;
		border-left: 3px solid var(--tone);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		background: color-mix(in srgb, var(--tone) 9%, var(--color-bg-secondary));
	}
	.next-hint.tone-warning { --tone: var(--color-warning); }
	.next-hint.tone-danger { --tone: var(--color-danger); }
	.next-hint.tone-success { --tone: var(--color-success); }
	.next-hint-title {
		margin: 0;
		font-weight: 600;
		color: var(--color-text);
	}

	/* Sections */
	.results-section {
		margin-bottom: var(--spacing-lg);
		padding-bottom: var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
	}

	.results-section:last-child {
		border-bottom: none;
	}

	.section-title {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--spacing-sm) 0;
	}

	.section-title-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-sm);
	}

	.section-title-row .section-title {
		margin-bottom: 0;
	}

	/* Summary rows */
	.summary-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-xs) 0;
	}

	.summary-label {
		font-size: var(--font-size-base);
		color: var(--color-text);
	}

	.summary-value {
		font-family: var(--font-mono);
		font-size: var(--font-size-base);
		font-weight: 600;
	}

	.summary-value.highlight {
		color: var(--color-highlight);
	}

	.summary-value.compliant {
		color: var(--color-success);
	}

	.summary-value.near-limit {
		color: var(--color-near-limit);
	}

	.summary-value.non-compliant {
		color: var(--color-non-compliant);
	}

	.summary-value.warning {
		color: var(--color-non-compliant);
	}

	.summary-value.ok {
		color: var(--color-success);
	}

	/* Compliance banner */
	.compliance-banner {
		margin: var(--spacing-sm) 0;
		padding: var(--spacing-sm);
		border-radius: var(--radius-sm);
		text-align: center;
		font-size: var(--font-size-base);
		font-weight: 600;
	}

	.compliance-banner.compliant {
		background: rgba(74, 222, 128, 0.1);
		color: var(--color-success);
		border: 1px solid rgba(74, 222, 128, 0.3);
	}

	.compliance-banner.near-limit {
		background: color-mix(in srgb, var(--color-near-limit) 10%, transparent);
		color: var(--color-near-limit);
		border: 1px solid color-mix(in srgb, var(--color-near-limit) 30%, transparent);
	}

	.compliance-banner.non-compliant {
		background: color-mix(in srgb, var(--color-non-compliant) 10%, transparent);
		color: var(--color-non-compliant);
		border: 1px solid color-mix(in srgb, var(--color-non-compliant) 30%, transparent);
	}

	/* Safety table */
	.safety-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-base);
	}

	.safety-table th,
	.safety-table td {
		padding: var(--spacing-xs) var(--spacing-sm);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.safety-table tbody tr:nth-child(odd) td {
		background: color-mix(in srgb, var(--color-bg-secondary) 60%, transparent);
	}

	.safety-table .row-label .unit {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs, 0.72rem);
		margin-left: 4px;
	}

	.safety-table th:first-child,
	.safety-table td:first-child {
		text-align: left;
	}

	.safety-table thead th {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		font-weight: 500;
		border-bottom: 1px solid var(--color-border);
	}

	.safety-table .row-label {
		color: var(--color-text-muted);
	}

	.safety-table td:not(.row-label) {
		font-family: var(--font-mono);
	}

	.safety-table td.compliant {
		color: var(--color-success);
	}

	.safety-table td.near-limit {
		color: var(--color-near-limit);
	}

	.safety-table td.non-compliant {
		color: var(--color-non-compliant);
	}

	.safety-stat .stat-value.non-compliant {
		color: var(--color-non-compliant);
	}

	/* Standard selector */
	.standard-selector {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-sm);
		padding-bottom: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
	}

	.standard-selector label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.standard-selector select {
		flex: 1;
		font-size: var(--font-size-base);
		padding: var(--spacing-xs) var(--spacing-sm);
	}

	/* Help text */
	.help-text {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: var(--spacing-xs) 0 0 0;
		font-style: italic;
	}

	.warning-text {
		font-size: var(--font-size-sm);
		color: var(--color-non-compliant);
		margin: var(--spacing-xs) 0 0 0;
	}

	/* Ozone inputs */
	.ozone-inputs {
		display: flex;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-sm);
	}

	.input-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}

	.input-row label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.input-row :global(input) {
		font-family: var(--font-mono);
		font-size: var(--font-size-base);
		padding: var(--spacing-xs) var(--spacing-sm);
		width: 100%;
	}

	/* Zone cards */
	.zone-card {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
		margin-bottom: var(--spacing-sm);
	}

	.zone-card.calculated {
		border-color: var(--color-highlight);
	}

	.zone-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-xs);
	}

	.zone-name {
		font-weight: 600;
		font-size: var(--font-size-base);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.zone-type {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--color-bg-tertiary);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.stats-grid-small {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--spacing-xs);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs);
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.stat .stat-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		text-transform: uppercase;
	}

	.stat .stat-value {
		font-family: var(--font-mono);
		font-size: var(--font-size-base);
	}

	.stat .stat-value.highlight {
		color: var(--color-highlight);
		font-weight: 600;
	}

	.zone-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: var(--spacing-xs);
	}

	.units-label {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	/* Renders identically to the surrounding muted text at rest; the swap glyph
	   and the hover underline are the only affordances. */
	.units-toggle {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		white-space: nowrap;
	}

	.units-toggle:hover,
	.units-toggle:focus-visible {
		color: var(--color-text);
		text-decoration: underline;
	}

	.swap-glyph {
		margin-left: 3px;
		opacity: 0.7;
	}

	.units-toggle:hover .swap-glyph,
	.units-toggle:focus-visible .swap-glyph {
		opacity: 1;
	}

	.dose-time-btn {
		cursor: text; /* Hint that it is editable */
		white-space: nowrap;
	}

	.dose-time-btn:hover,
	.dose-time-btn:focus-visible {
		color: var(--color-text);
		text-decoration: underline;
	}

	.dose-time-input {
		font-size: inherit;
		font-family: inherit;
		color: var(--color-text);
		padding: 0 3px;
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		/* Roughly the width of "88h 88m 88s" so the footer does not jump */
		width: 10ch;
	}

	.no-results {
		text-align: center;
		padding: var(--spacing-sm);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-style: italic;
	}

	/* Export buttons */
	.export-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
		width: 100%;
		margin-top: var(--spacing-sm);
	}

	.export-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
		color: var(--color-text);
	}

	.export-btn.small {
		width: auto;
		margin-top: 0;
		padding: 2px var(--spacing-xs);
		font-size: var(--font-size-xs);
	}

	.export-btn.primary {
		background: var(--color-success);
		border-color: var(--color-success);
		color: #000000;
		font-weight: 600;
	}

	.export-btn.primary:hover {
		background: var(--color-success-hover);
	}

	.export-section .export-btn {
		margin-top: 0;
	}

	.export-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.export-row .export-btn {
		margin-top: 0;
		flex: 1;
	}

	.export-row .checkbox-label {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-xs);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		white-space: nowrap;
		width: 85px;
		text-align: center;
	}

	.export-row .checkbox-label input[type="checkbox"] {
		width: auto;
		margin: 0;
	}

	.checkbox-placeholder {
		width: 85px;
	}

	.export-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.toggle-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: var(--spacing-xs) 0;
		text-align: left;
		font-size: var(--font-size-base);
	}

	.toggle-btn:hover {
		color: var(--color-text);
	}

	.dropdown-section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) var(--spacing-md);
		border-left: 2px solid var(--color-border);
		margin-left: var(--spacing-xs);
		margin-top: var(--spacing-xs);
	}

	.export-divider {
		height: 1px;
		background: var(--color-border);
		margin: 0;
	}

	.export-table {
		width: 100%;
		border-collapse: collapse;
	}

	.export-table tr {
		border-bottom: 1px solid var(--color-border);
	}

	.export-table tr:last-child {
		border-bottom: none;
	}

	.export-table td {
		padding: var(--spacing-xs) 0;
		vertical-align: middle;
	}

	.zone-name-cell {
		font-size: var(--font-size-base);
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 120px;
	}

	.action-cell {
		text-align: right;
		white-space: nowrap;
		padding-left: var(--spacing-xs);
	}

	.action-cell .export-btn {
		margin-top: 0;
	}

	/* Disinfection table */
	.disinfection-table {
		margin-bottom: var(--spacing-md);
		padding-right: var(--spacing-sm);
	}

	.table-header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 64px 92px;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) 0;
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}

	.table-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 64px 92px;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) 0;
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-base);
	}

	.table-row:last-child {
		border-bottom: none;
	}

	.col-species {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.disinfection-table {
		margin-top: var(--spacing-md);
	}

	.explore-data-btn {
		width: 100%;
		margin-bottom: var(--spacing-md);
		padding: var(--spacing-sm);
		font-size: var(--font-size-base);
		font-weight: 600;
	}

	.survival-plot {
		margin-top: var(--spacing-sm);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.table-hint {
		font-size: var(--font-size-sm);
		margin: var(--spacing-xs) 0 0;
	}

	.table-header .col-time.keep-case {
		text-transform: none;
	}

	.col-time {
		text-align: center;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.table-header .col-time {
		text-align: center;
	}

	/* Survival plot */
	.loading-text {
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
		font-style: italic;
		margin: var(--spacing-sm) 0;
	}

	.inline-error {
		font-size: var(--font-size-base);
		color: var(--color-near-limit);
		font-style: italic;
		margin: var(--spacing-sm) 0;
		padding: var(--spacing-xs) var(--spacing-sm);
		background: color-mix(in srgb, var(--color-near-limit) 10%, transparent);
		border-radius: var(--radius-sm);
	}

	.wavelength-warning {
		font-size: 0.8rem;
		color: var(--text-secondary);
		padding: 6px 8px;
		margin-bottom: 6px;
		border-left: 2px solid var(--warning-color, #f0ad4e);
		background: var(--surface-hover, rgba(255, 255, 255, 0.05));
	}

	/* Zone actions in footer */
	.zone-actions {
		display: flex;
		gap: var(--spacing-xs);
	}

	/* Explore data button */
	.section-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: inherit;
		text-align: left;
	}

	/* Room below a heading only while its section is open; collapsed headings stack evenly */
	.section-toggle[aria-expanded="true"] {
		margin-bottom: var(--spacing-md);
	}

	.section-title-row .section-toggle {
		margin-bottom: 0;
	}

	.section-title-row:has(.section-toggle[aria-expanded="true"]) {
		margin-bottom: var(--spacing-md);
	}

	.section-toggle .section-title {
		margin: 0;
	}

	.section-toggle .chevron {
		font-size: 0.65em;
		color: var(--color-text-muted);
	}

	.explore-data-btn:hover {
		background: var(--color-highlight);
		color: var(--color-bg);
	}

	/* Dimming note */
	.dimming-note {
		margin-top: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: color-mix(in srgb, var(--color-near-limit) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-near-limit) 40%, transparent);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-base);
		color: var(--color-near-limit);
		text-align: center;
	}

	/* Safety warnings */
	.safety-warnings {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		margin: var(--spacing-sm) 0;
	}

	.warning-item {
		display: flex;
		gap: var(--spacing-xs);
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		line-height: 1.4;
	}

	.warning-item.warning-info {
		background: color-mix(in srgb, var(--color-info) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-info) 30%, transparent);
		color: var(--color-info);
	}

	.warning-item.warning-warn {
		background: color-mix(in srgb, var(--color-near-limit) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-near-limit) 30%, transparent);
		color: var(--color-near-limit);
	}

	.warning-item.warning-error {
		background: color-mix(in srgb, var(--color-non-compliant) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-non-compliant) 30%, transparent);
		color: var(--color-non-compliant);
	}

	.warning-icon {
		flex-shrink: 0;
	}

	.warning-message {
		flex: 1;
	}

	/* Per-lamp compliance details */
	.lamp-compliance-details {
		margin-top: var(--spacing-md);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.lamp-compliance-details summary {
		padding: var(--spacing-xs) var(--spacing-sm);
		cursor: pointer;
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
		user-select: none;
	}

	.lamp-compliance-details summary:hover {
		color: var(--color-text);
		background: var(--color-bg-secondary);
	}

	.lamp-compliance-details[open] summary {
		border-bottom: 1px solid var(--color-border);
	}

	.lamp-compliance-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm);
	}

	.lamp-compliance-item {
		padding: var(--spacing-sm);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		border-left: 3px solid var(--color-border);
		cursor: default;
	}

	.lamp-compliance-item:hover {
		background: var(--color-bg-tertiary, var(--color-bg-secondary));
	}

	.lamp-compliance-item.lamp-compliant {
		border-left-color: var(--color-success);
	}

	.lamp-compliance-item.lamp-non-compliant {
		border-left-color: var(--color-non-compliant);
	}

	.lamp-compliance-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-xs);
	}

	.lamp-name {
		font-weight: 600;
		font-size: var(--font-size-base);
	}

	.lamp-status {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}

	.lamp-status.compliant {
		color: var(--color-success);
	}

	.lamp-compliance-stats {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.lamp-stat {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: var(--font-size-sm);
	}

	.lamp-stat-label {
		color: var(--color-text-muted);
		min-width: 35px;
	}

	.lamp-stat-value {
		font-family: var(--font-mono);
	}

	.lamp-stat-value.compliant {
		color: var(--color-success);
	}

	.lamp-stat-value.non-compliant {
		color: var(--color-non-compliant);
	}

	.lamp-dimming {
		font-size: var(--font-size-xs);
		color: var(--color-near-limit);
		padding: 1px 4px;
		background: color-mix(in srgb, var(--color-near-limit) 15%, transparent);
		border-radius: var(--radius-sm);
	}

	.lamp-warning {
		margin-top: var(--spacing-xs);
		font-size: var(--font-size-xs);
		color: var(--color-near-limit);
		font-style: italic;
	}

	.dim-settings-btn {
		margin-top: var(--spacing-xs);
		padding: 2px var(--spacing-sm);
		font-size: var(--font-size-xs);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
		width: 100%;
	}

	.dim-settings-btn:hover {
		border-color: var(--color-text-muted);
		color: var(--color-text);
	}
</style>
