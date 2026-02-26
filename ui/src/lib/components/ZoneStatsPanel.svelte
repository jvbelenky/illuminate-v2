<script lang="ts">
	import { zones, results, room, lamps, project, stateHashes, lampsStale, roomStale, isZoneStale } from '$lib/stores/project';
	import type { StateHashes } from '$lib/types/project';
	import { ROOM_DEFAULTS, type CalcZone, type ZoneResult, type CheckLampsResult, type LampComplianceResult, type SafetyWarning } from '$lib/types/project';
	import { TLV_LIMITS, OZONE_WARNING_THRESHOLD_PPB } from '$lib/constants/safety';
	import { formatValue } from '$lib/utils/formatting';
	import { calculateHoursToTLV, doseConversionFactor } from '$lib/utils/calculations';
	import { getSessionReport, getSessionZoneExport, getSessionExportZip, checkLampsSession, updateSessionRoom, getEfficacyExploreData, type EfficacyExploreResponse } from '$lib/api/client';
	import { userSettings } from '$lib/stores/settings';
	import { parseTableResponse } from '$lib/utils/efficacy-filters';
	import { averageKineticsBySpecies, logReductionTime, DEFAULT_TARGET_SPECIES, type SpeciesKinetics } from '$lib/utils/survival-math';
	import CalcVolPlotModal, { type IsoSettings, type IsoSettingsInput } from './CalcVolPlotModal.svelte';
	import CalcPlanePlotModal from './CalcPlanePlotModal.svelte';
	import ExploreDataModal from './ExploreDataModal.svelte';
	import SurvivalPlot from './SurvivalPlot.svelte';
	import AlertDialog from './AlertDialog.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';

	interface Props {
		onShowAudit?: () => void;
		onLampHover?: (lampId: string | null) => void;
		onOpenAdvancedSettings?: (lampId: string) => void;
		onSelectSpecies?: () => void;
		isoSettingsMap?: Record<string, IsoSettings>;
		onIsoSettingsChange?: (zoneId: string, settings: IsoSettingsInput) => void;
	}

	let { onShowAudit, onLampHover, onOpenAdvancedSettings, onSelectSpecies, isoSettingsMap = {}, onIsoSettingsChange }: Props = $props();

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

	// Get WholeRoomFluence result
	const wholeRoomResult = $derived(getZoneResult('WholeRoomFluence'));
	const avgFluence = $derived(wholeRoomResult?.statistics?.mean);

	// Get safety zone results
	const skinResult = $derived(getZoneResult('SkinLimits'));
	const eyeResult = $derived(getZoneResult('EyeLimits'));

	// Get TLV limits: prefer spectrum-specific values from checkLamps, fall back to
	// hardcoded monochromatic limits (which are only correct for pure 222nm lamps).
	const monochromaticLimits = $derived(TLV_LIMITS[$room.standard] || TLV_LIMITS['ACGIH']);
	const effectiveLimits = $derived.by(() => {
		if (!$results?.checkLamps?.lamp_results) return monochromaticLimits;
		const lampResults = Object.values($results.checkLamps.lamp_results) as LampComplianceResult[];
		if (lampResults.length === 0) return monochromaticLimits;
		// Use the most restrictive (lowest) TLV across all lamps
		const minSkin = Math.min(...lampResults.map(lr => lr.skin_tlv));
		const minEye = Math.min(...lampResults.map(lr => lr.eye_tlv));
		return { skin: minSkin, eye: minEye };
	});

	// Calculate compliance - dose must be under TLV
	const skinMax = $derived(skinResult?.statistics?.max);
	const eyeMax = $derived(eyeResult?.statistics?.max);

	// Get check_lamps result for comprehensive safety analysis
	const checkLampsResult = $derived($results?.checkLamps);

	// Per-lamp flags from check_lamps
	const anyLampSkinNonCompliant = $derived.by(() => {
		if (!checkLampsResult?.lamp_results) return false;
		return Object.values(checkLampsResult.lamp_results).some(
			(lamp: LampComplianceResult) => !lamp.is_skin_compliant
		);
	});
	const anyLampSkinNearLimit = $derived.by(() => {
		if (!checkLampsResult?.lamp_results) return false;
		return Object.values(checkLampsResult.lamp_results).some(
			(lamp: LampComplianceResult) => lamp.skin_near_limit
		);
	});
	const anyLampEyeNonCompliant = $derived.by(() => {
		if (!checkLampsResult?.lamp_results) return false;
		return Object.values(checkLampsResult.lamp_results).some(
			(lamp: LampComplianceResult) => !lamp.is_eye_compliant
		);
	});
	const anyLampEyeNearLimit = $derived.by(() => {
		if (!checkLampsResult?.lamp_results) return false;
		return Object.values(checkLampsResult.lamp_results).some(
			(lamp: LampComplianceResult) => lamp.eye_near_limit
		);
	});

	// Non-compliant if any individual lamp OR combined dose exceeds TLV
	const skinShowNonCompliant = $derived(
		anyLampSkinNonCompliant || checkLampsResult?.is_skin_compliant === false
	);
	const skinShowNearLimit = $derived(
		!skinShowNonCompliant && (anyLampSkinNearLimit || (checkLampsResult?.skin_near_limit ?? false))
	);
	const eyeShowNonCompliant = $derived(
		anyLampEyeNonCompliant || checkLampsResult?.is_eye_compliant === false
	);
	const eyeShowNearLimit = $derived(
		!eyeShowNonCompliant && (anyLampEyeNearLimit || (checkLampsResult?.eye_near_limit ?? false))
	);

	// Overall compliance for banner
	const anyNonCompliant = $derived(skinShowNonCompliant || eyeShowNonCompliant);
	const anyNearLimit = $derived(!anyNonCompliant && (skinShowNearLimit || eyeShowNearLimit));

	// Calculate hours to TLV using spectrum-aware limits
	const skinHoursToLimit = $derived(calculateHoursToTLV(skinMax, effectiveLimits.skin));
	const eyeHoursToLimit = $derived(calculateHoursToTLV(eyeMax, effectiveLimits.eye));

	// Handle standard change - update room and re-fetch checkLamps
	let isRefetchingCompliance = $state(false);
	async function handleStandardChange(newStandard: 'ANSI IES RP 27.1-22 (ACGIH Limits)' | 'UL8802 (ACGIH Limits)' | 'IEC 62471-6:2022 (ICNIRP Limits)') {
		// Update the local store
		project.updateRoom({ standard: newStandard });

		// Re-fetch checkLamps with new standard
		if ($results) {
			isRefetchingCompliance = true;
			try {
				// Directly update backend (bypassing debounce) to ensure sync before checkLamps
				await updateSessionRoom({ standard: newStandard });
				const checkLampsResult = await checkLampsSession();
				// Update results with new checkLamps data, preserving existing zone results
				project.setResults({
					...$results,
					checkLamps: checkLampsResult
				});
			} catch (e) {
				console.warn('Failed to re-fetch compliance data:', e);
			} finally {
				isRefetchingCompliance = false;
			}
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
				meanFluence: $results!.zones[z.id].statistics.mean!
			}));
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

	// Determine lamp wavelength for filtering efficacy data
	const lampWavelength = $derived.by(() => {
		const lampList = $lamps;
		if (lampList.length === 0) return 222;
		const wavelengths = new Set(lampList.map(l => {
			if (l.wavelength != null) return l.wavelength;
			if (l.lamp_type === 'krcl_222') return 222;
			if (l.lamp_type === 'lp_254') return 254;
			return undefined;
		}).filter((w): w is number => w != null));
		return wavelengths.size === 1 ? [...wavelengths][0] : 222;
	});

	// Parse explore data into typed rows
	const efficacyRows = $derived.by(() => {
		const data = prefetchedExploreData;
		if (!data?.table) return [];
		return parseTableResponse(data.table.columns, data.table.rows);
	});

	// Compute averaged kinetics per species (client-side, replaces backend disinfection table)
	const speciesKinetics = $derived.by((): SpeciesKinetics[] => {
		if (efficacyRows.length === 0 || !avgFluence) return [];
		const species = $userSettings.resultSpecies;
		const speciesList = species.length > 0 ? species : DEFAULT_TARGET_SPECIES;
		return averageKineticsBySpecies(efficacyRows, speciesList, lampWavelength);
	});

	// Compute disinfection table rows client-side
	const disinfectionRows = $derived.by(() => {
		if (speciesKinetics.length === 0 || !avgFluence) return [];
		return speciesKinetics.map(sp => {
			const s90 = logReductionTime(1, avgFluence!, sp.k1, sp.k2, sp.f);
			const s99 = logReductionTime(2, avgFluence!, sp.k1, sp.k2, sp.f);
			const s999 = logReductionTime(3, avgFluence!, sp.k1, sp.k2, sp.f);
			return {
				species: sp.species,
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
	const hasOnly222nmLamps = $derived(
		$lamps.length > 0 && $lamps.every(l => l.lamp_type === 'krcl_222')
	);

	// Compute ozone client-side so it updates reactively when air_changes or decay_constant change
	const ozoneValue = $derived.by(() => {
		if (!avgFluence) return null;
		const airChanges = $room.air_changes ?? ROOM_DEFAULTS.air_changes;
		const decayConstant = $room.ozone_decay_constant ?? ROOM_DEFAULTS.ozone_decay_constant;
		const denominator = airChanges + decayConstant;
		if (denominator <= 0) return null;
		return avgFluence * OZONE_GENERATION_CONSTANT / denominator;
	});

	// Quick audit warning count (for icon coloring)
	const hasAuditWarnings = $derived.by(() => {
		// Check for safety warnings from backend (includes fixture bounds, compliance, etc.)
		if ($results?.checkLamps?.warnings && $results.checkLamps.warnings.length > 0) {
			// Filter out "zone not found" warnings when standard zones are intentionally disabled
			const relevant = $room.useStandardZones
				? $results.checkLamps.warnings
				: $results.checkLamps.warnings.filter((w: SafetyWarning) => !w.message.includes('zone not found'));
			if (relevant.length > 0) return true;
		}
		// Check for missing spectrum
		if ($results?.checkLamps?.lamp_results) {
			if (Object.values($results.checkLamps.lamp_results).some((l: LampComplianceResult) => l.missing_spectrum)) return true;
		}
		// Check for non-compliance
		if (anyNonCompliant) return true;
		// No lamps
		if ($lamps.length === 0) return true;
		return false;
	});

	// Alert dialog state
	let alertDialog = $state<{ title: string; message: string } | null>(null);

	// Export zone data as CSV using backend
	let exportingZoneId = $state<string | null>(null);

	// Plane plot modal state (for planes - uses frontend 3D heatmap)
	let planePlotModalZone = $state<{ id: string; name: string; zone: CalcZone; values: number[][]; valueFactor: number } | null>(null);

	// Volume plot modal state (for volumes - uses frontend 3D isosurface)
	let volumePlotModalZone = $state<{ id: string; name: string; zone: CalcZone; values: number[][][]; valueFactor: number } | null>(null);

	// Explore data modal state
	let showExploreDataModal = $state(false);

	function openPlanePlotModal(zoneId: string, zoneName: string) {
		const zone = $zones.find(z => z.id === zoneId);
		const result = getZoneResult(zoneId);
		if (!zone || !result?.values) return;
		const factor = doseConversionFactor(zone.dose ?? false, zone.hours ?? 8, result.doseAtCalcTime, result.hoursAtCalcTime);
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
		const zone = $zones.find(z => z.id === zoneId);
		const result = getZoneResult(zoneId);
		if (!zone || !result?.values) return;
		const factor = doseConversionFactor(zone.dose ?? false, zone.hours ?? 8, result.doseAtCalcTime, result.hoursAtCalcTime);
		volumePlotModalZone = {
			id: zoneId,
			name: zoneName,
			zone: zone,
			values: result.values as number[][][],
			valueFactor: factor
		};
	}

	function closeVolumePlotModal() {
		volumePlotModalZone = null;
	}

	// Generic handler that routes to the appropriate modal based on zone type
	function handleShowPlot(zone: CalcZone, zoneName: string) {
		if (zone.type === 'volume') {
			openVolumePlotModal(zone.id, zoneName);
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
			<p class="hint">Click Calculate to run simulation</p>
		</div>
	{:else}
		<!-- Custom Calculation Zones Section (fluence-dependent) -->
		{#if customZones.length > 0}
			<section class="results-section stale-wrapper">
				{#if fluenceResultsStale}<div class="stale-overlay"></div>{/if}
				<h4 class="section-title">Custom Calculation Zones</h4>

				{#each customZones as zone (zone.id)}
					{@const result = getZoneResult(zone.id)}
					{@const factor = result ? doseConversionFactor(zone.dose ?? false, zone.hours ?? 8, result.doseAtCalcTime, result.hoursAtCalcTime) : 1}
					<div class="zone-card" class:calculated={hasResults(zone.id)}>
						<div class="zone-header">
							<span class="zone-name">{getZoneName(zone)}</span>
							<span class="zone-type">{zone.type}</span>
						</div>

						{#if result?.statistics}
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
							<div class="zone-footer">
								<span class="units-label">
									{zone.dose ? `mJ/cm² (${zone.hours || 8}hr dose)` : 'µW/cm²'}
								</span>
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

				<!-- Average Fluence (fluence-dependent) -->
				{#if avgFluence !== null && avgFluence !== undefined}
					<div class="summary-fluence stale-wrapper">
						{#if fluenceResultsStale}<div class="stale-overlay"></div>{/if}
						<div class="summary-row">
							<span class="summary-label">Average Fluence</span>
							<span class="summary-value highlight">{formatValue(avgFluence, 3)} µW/cm²</span>
							{#if wholeRoomResult?.values}
								{@const zone = $zones.find(z => z.id === 'WholeRoomFluence')}
								{#if zone}
									<button class="export-btn small" onclick={() => handleShowPlot(zone, 'WholeRoomFluence')}>Show Plot</button>
								{/if}
							{/if}
						</div>
					</div>
				{/if}

				<!-- Safety results (per-zone staleness) -->
				{#if skinMax !== null && skinMax !== undefined}
					<div class="stale-wrapper">
						{#if skinResultsStale}<div class="stale-overlay"></div>{/if}
						<div class="summary-row">
							<span class="summary-label">Max Skin Dose (8hr)</span>
							<span class="summary-value"
								class:compliant={!skinShowNonCompliant && !skinShowNearLimit}
								class:near-limit={skinShowNearLimit}
								class:non-compliant={skinShowNonCompliant}>
								{formatValue(skinMax, 1)} mJ/cm²
							</span>
							{#if skinResult?.values}
								{@const zone = $zones.find(z => z.id === 'SkinLimits')}
								{#if zone}
									<button class="export-btn small" onclick={() => handleShowPlot(zone, 'SkinLimits')}>Show Plot</button>
								{/if}
							{/if}
						</div>
					</div>
				{/if}

				{#if eyeMax !== null && eyeMax !== undefined}
					<div class="stale-wrapper">
						{#if eyeResultsStale}<div class="stale-overlay"></div>{/if}
						<div class="summary-row">
							<span class="summary-label">Max Eye Dose (8hr)</span>
							<span class="summary-value"
								class:compliant={!eyeShowNonCompliant && !eyeShowNearLimit}
								class:near-limit={eyeShowNearLimit}
								class:non-compliant={eyeShowNonCompliant}>
								{formatValue(eyeMax, 1)} mJ/cm²
							</span>
							{#if eyeResult?.values}
								{@const zone = $zones.find(z => z.id === 'EyeLimits')}
								{#if zone}
									<button class="export-btn small" onclick={() => handleShowPlot(zone, 'EyeLimits')}>Show Plot</button>
								{/if}
							{/if}
						</div>
					</div>
				{/if}

				<div class="stale-wrapper">
					{#if safetyResultsStale}<div class="stale-overlay"></div>{/if}
					{#if checkLampsResult && skinMax != null && eyeMax != null}
						<div class="compliance-banner" class:compliant={!anyNonCompliant && !anyNearLimit} class:near-limit={anyNearLimit} class:non-compliant={anyNonCompliant}>
							{#if anyNonCompliant}
								Does not comply with TLVs
							{:else if anyNearLimit}
								Within 10% of TLV limits
							{:else}
								Installation complies with TLVs
							{/if}
						</div>
					{/if}
				</div>

				<button class="export-btn" onclick={generateReport} disabled={isGeneratingReport}>
					{isGeneratingReport ? 'Generating...' : 'Generate Report'}
				</button>
			</section>
		{:else}
			<section class="results-section">
				<button class="export-btn" onclick={generateReport} disabled={isGeneratingReport}>
					{isGeneratingReport ? 'Generating...' : 'Generate Report'}
				</button>
			</section>
		{/if}

		<!-- Photobiological Safety Section (per-zone staleness) -->
		{#if (skinMax !== undefined || eyeMax !== undefined)}
			<section class="results-section">
				<h4 class="section-title">Photobiological Safety</h4>

				<div class="standard-selector">
					<label for="standard">Standard</label>
					<select id="standard" value={$room.standard} onchange={(e) => handleStandardChange((e.target as HTMLSelectElement).value as 'ANSI IES RP 27.1-22 (ACGIH Limits)' | 'UL8802 (ACGIH Limits)' | 'IEC 62471-6:2022 (ICNIRP Limits)')} disabled={isRefetchingCompliance}>
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
								class:compliant={!skinShowNonCompliant && !skinShowNearLimit}
								class:near-limit={skinShowNearLimit}
								class:non-compliant={skinShowNonCompliant}>
								{#if skinHoursToLimit && skinHoursToLimit >= 8 && !skinShowNonCompliant}
									Indefinite
								{:else if skinHoursToLimit}
									{formatValue(skinHoursToLimit, 1)} hrs
								{:else}
									—
								{/if}
							</td>
							<td class:stale-cell={eyeResultsStale}
								class:compliant={!eyeShowNonCompliant && !eyeShowNearLimit}
								class:near-limit={eyeShowNearLimit}
								class:non-compliant={eyeShowNonCompliant}>
								{#if eyeHoursToLimit && eyeHoursToLimit >= 8 && !eyeShowNonCompliant}
									Indefinite
								{:else if eyeHoursToLimit}
									{formatValue(eyeHoursToLimit, 1)} hrs
								{:else}
									—
								{/if}
							</td>
						</tr>
						<tr>
							<td class="row-label">Max 8hr Dose</td>
							<td class:stale-cell={skinResultsStale}>{formatValue(skinMax, 1)} mJ/cm²</td>
							<td class:stale-cell={eyeResultsStale}>{formatValue(eyeMax, 1)} mJ/cm²</td>
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
			</section>
		{/if}

		<!-- Pathogen Reduction Section (fluence-dependent) -->
		{#if avgFluence !== null && avgFluence !== undefined}
			<section class="results-section stale-wrapper">
				{#if fluenceResultsStale}<div class="stale-overlay"></div>{/if}
				<div class="section-title-row">
					<h4 class="section-title">Pathogen Reduction in Air</h4>
					{#if onSelectSpecies}
						<button class="select-species-btn" onclick={onSelectSpecies} title="Select species">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
								<circle cx="12" cy="12" r="3"/>
							</svg>
						</button>
					{/if}
				</div>

								{#if disinfectionRows.length > 0}
					<!-- Disinfection Time Table -->
					<div class="disinfection-table">
						<div class="table-header">
							<span class="col-species">Pathogen</span>
							<span class="col-time">90%</span>
							<span class="col-time">99%</span>
							<span class="col-time">99.9%</span>
						</div>
						{#each disinfectionRows as row}
							<div class="table-row">
								<span class="col-species">{row.species}</span>
								<span class="col-time">{formatTime(row.seconds_to_90)}</span>
								<span class="col-time">{formatTime(row.seconds_to_99)}</span>
								<span class="col-time">{formatTime(row.seconds_to_99_9)}</span>
							</div>
						{/each}
					</div>

					<!-- Survival Plot (client-side SVG) -->
					{#if speciesKinetics.length > 0 && avgFluence}
						<SurvivalPlot speciesData={speciesKinetics} fluence={avgFluence} />
					{/if}

					<!-- Explore Data Button -->
					<button class="export-btn explore-data-btn" onclick={() => showExploreDataModal = true}>
						Explore Data
					</button>
				{:else}
					<div class="summary-row">
						<span class="summary-label">Average Fluence</span>
						<span class="summary-value highlight">{formatValue(avgFluence, 3)} µW/cm²</span>
					</div>
				{/if}
			</section>
		{/if}

		<!-- Ozone Generation Section (222nm only, fluence-dependent) -->
		{#if hasOnly222nmLamps && avgFluence}
			<section class="results-section stale-wrapper">
				{#if fluenceResultsStale}<div class="stale-overlay"></div>{/if}
				<h4 class="section-title">Ozone Generation</h4>

				<div class="ozone-inputs">
					<div class="input-row">
						<label for="air-changes">Air changes/hr</label>
						<input
							id="air-changes"
							type="number"
							value={$room.air_changes || ROOM_DEFAULTS.air_changes}
							onchange={(e) => project.updateRoom({ air_changes: parseFloat((e.target as HTMLInputElement).value) || ROOM_DEFAULTS.air_changes })}
							min="0"
							step="0.1"
						/>
					</div>
					<div class="input-row">
						<label for="ozone-decay">Decay constant</label>
						<input
							id="ozone-decay"
							type="number"
							value={$room.ozone_decay_constant || ROOM_DEFAULTS.ozone_decay_constant}
							onchange={(e) => project.updateRoom({ ozone_decay_constant: parseFloat((e.target as HTMLInputElement).value) || ROOM_DEFAULTS.ozone_decay_constant })}
							min="0"
							step="0.1"
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
					{#if ozoneValue > OZONE_WARNING_THRESHOLD_PPB}
						<p class="warning-text">Ozone increase exceeds {OZONE_WARNING_THRESHOLD_PPB} ppb threshold</p>
					{/if}
				{/if}
			</section>
		{/if}

		<!-- Export Results Dropdown -->
		{#if $results?.zones && Object.keys($results.zones).length > 0}
			<section class="results-section export-section">
			<button class="toggle-btn" onclick={() => showSaveDropdown = !showSaveDropdown}>
				{showSaveDropdown ? '▼' : '▶'} Export Results
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
								{#if result?.values}
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
		onIsoSettingsChange={(s) => { onIsoSettingsChange?.(volumePlotModalZone!.id, s); }}
		onclose={closeVolumePlotModal}
	/>
{/if}

<!-- Explore Data Modal -->
{#if showExploreDataModal}
	<ExploreDataModal
		fluence={avgFluence}
		roomX={$room.x}
		roomY={$room.y}
		roomZ={$room.z}
		roomUnits={$room.units}
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

	.empty-state .hint {
		font-size: var(--font-size-sm);
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

	.select-species-btn {
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

	.select-species-btn:hover {
		opacity: 1;
		background: var(--color-bg-tertiary);
		color: var(--color-accent);
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

	.input-row input {
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
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
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
		grid-template-columns: 1fr repeat(3, 50px);
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
		grid-template-columns: 1fr repeat(3, 50px);
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) 0;
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-base);
	}

	.table-row:last-child {
		border-bottom: none;
	}

	.col-species {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	.survival-plot {
		margin-top: var(--spacing-sm);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.survival-plot img {
		width: 100%;
		height: auto;
		display: block;
	}

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

	/* Zone actions in footer */
	.zone-actions {
		display: flex;
		gap: var(--spacing-xs);
	}

	/* Explore data button */
	.explore-data-btn {
		margin-top: var(--spacing-md);
		background: var(--color-bg-secondary);
		border-color: var(--color-highlight);
		color: var(--color-highlight);
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
