<script lang="ts">
	import { zones, results, room, lamps, project } from '$lib/stores/project';
	import { ROOM_DEFAULTS, type CalcZone, type ZoneResult } from '$lib/types/project';
	import { TLV_LIMITS, OZONE_WARNING_THRESHOLD_PPB } from '$lib/constants/safety';
	import { formatValue } from '$lib/utils/formatting';
	import { calculateHoursToTLV, calculateOzoneIncrease } from '$lib/utils/calculations';
	import { getSessionReport, getSessionZoneExport, getSessionExportZip, getDisinfectionTable, getSurvivalPlot, getZonePlot, type DisinfectionTableResponse } from '$lib/api/client';
	import { theme } from '$lib/stores/theme';

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

	// Get TLV limits for current standard
	const currentLimits = $derived(TLV_LIMITS[$room.standard] || TLV_LIMITS['ACGIH']);

	// Calculate compliance - dose must be under TLV
	const skinMax = $derived(skinResult?.statistics?.max);
	const eyeMax = $derived(eyeResult?.statistics?.max);

	const skinCompliant = $derived(skinMax !== null && skinMax !== undefined && skinMax <= currentLimits.skin);
	const eyeCompliant = $derived(eyeMax !== null && eyeMax !== undefined && eyeMax <= currentLimits.eye);

	// Warning state: within 10% of TLV (over 90% of limit but still under)
	const skinNearLimit = $derived(skinCompliant && skinMax !== null && skinMax !== undefined && skinMax > currentLimits.skin * 0.9);
	const eyeNearLimit = $derived(eyeCompliant && eyeMax !== null && eyeMax !== undefined && eyeMax > currentLimits.eye * 0.9);
	const anyNearLimit = $derived(skinNearLimit || eyeNearLimit);

	const overallCompliant = $derived(skinCompliant && eyeCompliant);

	// Calculate hours to TLV
	const skinHoursToLimit = $derived(calculateHoursToTLV(skinMax, currentLimits.skin));
	const eyeHoursToLimit = $derived(calculateHoursToTLV(eyeMax, currentLimits.eye));

	// Disinfection data state - table and plot load independently
	let disinfectionData = $state<DisinfectionTableResponse | null>(null);
	let survivalPlotBase64 = $state<string | null>(null);
	let loadingTable = $state(false);
	let loadingPlot = $state(false);
	let lastCalculatedAt = $state<string | null>(null);
	let lastPlotTheme = $state<string | null>(null);

	// Fetch disinfection data only when calculation timestamp changes
	$effect(() => {
		const calculatedAt = $results?.calculatedAt;
		const currentTheme = $theme;

		if (!calculatedAt) {
			// No results yet
			disinfectionData = null;
			survivalPlotBase64 = null;
			lastCalculatedAt = null;
			lastPlotTheme = null;
			return;
		}

		const needsTableRefresh = calculatedAt !== lastCalculatedAt;
		const needsPlotRefresh = needsTableRefresh || currentTheme !== lastPlotTheme;

		// Fetch table and plot independently so table appears first
		if (needsTableRefresh) {
			fetchDisinfectionTable();
			lastCalculatedAt = calculatedAt;
		}
		if (needsPlotRefresh) {
			fetchSurvivalPlot();
			lastPlotTheme = currentTheme;
		}
	});

	async function fetchDisinfectionTable() {
		loadingTable = true;
		try {
			disinfectionData = await getDisinfectionTable('WholeRoomFluence');
		} catch (e) {
			console.error('Failed to fetch disinfection table:', e);
		} finally {
			loadingTable = false;
		}
	}

	async function fetchSurvivalPlot() {
		loadingPlot = true;
		try {
			const result = await getSurvivalPlot('WholeRoomFluence', $theme, 150);
			survivalPlotBase64 = result.image_base64;
		} catch (e) {
			console.error('Failed to fetch survival plot:', e);
		} finally {
			loadingPlot = false;
		}
	}

	// Format seconds to readable time
	function formatTime(seconds: number | null): string {
		if (seconds === null || seconds === undefined) return '—';
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}

	// Ozone calculation (only for 222nm lamps)
	const hasOnly222nmLamps = $derived(
		$lamps.length > 0 && $lamps.every(l => l.lamp_type === 'krcl_222')
	);

	const ozoneValue = $derived.by(() => {
		if (!avgFluence || !hasOnly222nmLamps) return null;
		const ach = $room.air_changes || ROOM_DEFAULTS.air_changes;
		const decay = $room.ozone_decay_constant || ROOM_DEFAULTS.ozone_decay_constant;
		return calculateOzoneIncrease(avgFluence, ach, decay);
	});

	// Export zone data as CSV using backend
	let exportingZoneId = $state<string | null>(null);

	// Zone plot modal state
	let plotModalZone = $state<{ id: string; name: string } | null>(null);
	let plotImageLowRes = $state<string | null>(null);
	let plotImageHiRes = $state<string | null>(null);
	let loadingPlotLowRes = $state(false);
	let loadingPlotHiRes = $state(false);
	let showHiRes = $state(false);

	function openPlotModal(zoneId: string, zoneName: string) {
		plotModalZone = { id: zoneId, name: zoneName };
		plotImageLowRes = null;
		plotImageHiRes = null;
		showHiRes = false;
		fetchZonePlotLowRes(zoneId);
	}

	function closePlotModal() {
		plotModalZone = null;
		plotImageLowRes = null;
		plotImageHiRes = null;
		showHiRes = false;
	}

	async function fetchZonePlotLowRes(zoneId: string) {
		loadingPlotLowRes = true;
		try {
			const result = await getZonePlot(zoneId, $theme, 100);
			plotImageLowRes = `data:image/png;base64,${result.image_base64}`;
			// Start prefetching hi-res in background
			fetchZonePlotHiRes(zoneId);
		} catch (e) {
			console.error('Failed to fetch zone plot:', e);
		} finally {
			loadingPlotLowRes = false;
		}
	}

	async function fetchZonePlotHiRes(zoneId: string) {
		loadingPlotHiRes = true;
		try {
			const result = await getZonePlot(zoneId, $theme, 300);
			plotImageHiRes = `data:image/png;base64,${result.image_base64}`;
		} catch (e) {
			console.error('Failed to fetch hi-res zone plot:', e);
		} finally {
			loadingPlotHiRes = false;
		}
	}

	function handlePlotImageClick() {
		if (plotImageHiRes) {
			showHiRes = true;
		}
	}

	// Handle keyboard events for plot modal
	$effect(() => {
		if (plotModalZone) {
			const handler = (e: KeyboardEvent) => {
				if (e.key === 'Escape') {
					if (showHiRes) {
						showHiRes = false;
					} else {
						closePlotModal();
					}
				}
			};
			window.addEventListener('keydown', handler);
			return () => window.removeEventListener('keydown', handler);
		}
	});

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
			alert('Failed to export zone. Please try again.');
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
			a.download = 'guv_report.csv';
			a.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('Failed to generate report:', error);
			alert('Failed to generate report. Please try again.');
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
			alert('Failed to export results. Please try again.');
		} finally {
			isExportingAll = false;
		}
	}
</script>

<div class="stats-panel">
	<div class="panel-header">
		<h3>Results</h3>
		{#if $results}
			<span class="calc-time">
				{new Date($results.calculatedAt).toLocaleTimeString()}
			</span>
		{/if}
	</div>

	{#if !$results}
		<div class="empty-state">
			<p>No results yet</p>
			<p class="hint">Click Calculate to run simulation</p>
		</div>
	{:else}
		<!-- Custom Calculation Zones Section -->
		{#if customZones.length > 0}
			<section class="results-section">
				<h4 class="section-title">Custom Calculation Zones</h4>

				{#each customZones as zone (zone.id)}
					{@const result = getZoneResult(zone.id)}
					<div class="zone-card" class:calculated={hasResults(zone.id)}>
						<div class="zone-header">
							<span class="zone-name">{getZoneName(zone)}</span>
							<span class="zone-type">{zone.type}</span>
						</div>

						{#if result?.statistics}
							<div class="stats-grid-small">
								<div class="stat">
									<span class="stat-label">Mean</span>
									<span class="stat-value highlight">{formatValue(result.statistics.mean)}</span>
								</div>
								<div class="stat">
									<span class="stat-label">Max</span>
									<span class="stat-value">{formatValue(result.statistics.max)}</span>
								</div>
								<div class="stat">
									<span class="stat-label">Min</span>
									<span class="stat-value">{formatValue(result.statistics.min)}</span>
								</div>
							</div>
							<div class="zone-footer">
								<span class="units-label">
									{zone.dose ? `mJ/cm² (${zone.hours || 8}hr dose)` : 'µW/cm²'}
								</span>
								{#if result.values}
									<div class="zone-actions">
										<button class="export-btn small" onclick={() => openPlotModal(zone.id, getZoneName(zone))}>
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
		<section class="results-section">
			<h4 class="section-title">Summary</h4>

			{#if avgFluence !== null && avgFluence !== undefined}
				<div class="summary-row">
					<span class="summary-label">Average Fluence</span>
					<span class="summary-value highlight">{formatValue(avgFluence, 3)} µW/cm²</span>
				</div>
			{/if}

			{#if skinMax !== null && skinMax !== undefined}
				<div class="summary-row">
					<span class="summary-label">Max Skin Dose (8hr)</span>
					<span class="summary-value" class:compliant={skinCompliant && !skinNearLimit} class:near-limit={skinNearLimit} class:non-compliant={!skinCompliant}>
						{formatValue(skinMax, 1)} mJ/cm²
					</span>
				</div>
			{/if}

			{#if eyeMax !== null && eyeMax !== undefined}
				<div class="summary-row">
					<span class="summary-label">Max Eye Dose (8hr)</span>
					<span class="summary-value" class:compliant={eyeCompliant && !eyeNearLimit} class:near-limit={eyeNearLimit} class:non-compliant={!eyeCompliant}>
						{formatValue(eyeMax, 1)} mJ/cm²
					</span>
				</div>
			{/if}

			{#if skinMax !== undefined && eyeMax !== undefined}
				<div class="compliance-banner" class:compliant={overallCompliant && !anyNearLimit} class:near-limit={overallCompliant && anyNearLimit} class:non-compliant={!overallCompliant}>
					{#if !overallCompliant}
						Does not comply with {$room.standard} TLVs
					{:else if anyNearLimit}
						Within 10% of {$room.standard} TLV limits
					{:else}
						Installation complies with {$room.standard} TLVs
					{/if}
				</div>
			{/if}

			<button class="export-btn" onclick={generateReport} disabled={isGeneratingReport}>
				{isGeneratingReport ? 'Generating...' : 'Generate Report'}
			</button>
		</section>

		<!-- Photobiological Safety Section -->
		{#if (skinMax !== undefined || eyeMax !== undefined)}
			<section class="results-section">
				<h4 class="section-title">Photobiological Safety</h4>

				<div class="standard-selector">
					<label for="standard">Standard</label>
					<select id="standard" value={$room.standard} onchange={(e) => project.updateRoom({ standard: (e.target as HTMLSelectElement).value as 'ACGIH' | 'ACGIH-UL8802' | 'ICNIRP' })}>
						<option value="ACGIH">ACGIH</option>
						<option value="ICNIRP">ICNIRP</option>
						<option value="ACGIH-UL8802">ACGIH-UL8802</option>
					</select>
				</div>

				<div class="safety-grid">
					{#if skinMax !== null && skinMax !== undefined}
						<div class="safety-column">
							<h5>Skin</h5>
							<div class="safety-stat">
								<span class="stat-label">Hours to TLV</span>
								<span class="stat-value" class:compliant={skinCompliant && !skinNearLimit} class:near-limit={skinNearLimit} class:non-compliant={!skinCompliant}>
									{#if skinHoursToLimit && skinHoursToLimit >= 8}
										Indefinite
									{:else if skinHoursToLimit}
										{formatValue(skinHoursToLimit, 1)} hrs
									{:else}
										—
									{/if}
								</span>
							</div>
							<div class="safety-stat">
								<span class="stat-label">Max 8hr Dose</span>
								<span class="stat-value">{formatValue(skinMax, 1)} mJ/cm²</span>
							</div>
							<div class="safety-stat">
								<span class="stat-label">TLV ({$room.standard})</span>
								<span class="stat-value muted">{currentLimits.skin} mJ/cm²</span>
							</div>
						</div>
					{/if}

					{#if eyeMax !== null && eyeMax !== undefined}
						<div class="safety-column">
							<h5>Eye</h5>
							<div class="safety-stat">
								<span class="stat-label">Hours to TLV</span>
								<span class="stat-value" class:compliant={eyeCompliant && !eyeNearLimit} class:near-limit={eyeNearLimit} class:non-compliant={!eyeCompliant}>
									{#if eyeHoursToLimit && eyeHoursToLimit >= 8}
										Indefinite
									{:else if eyeHoursToLimit}
										{formatValue(eyeHoursToLimit, 1)} hrs
									{:else}
										—
									{/if}
								</span>
							</div>
							<div class="safety-stat">
								<span class="stat-label">Max 8hr Dose</span>
								<span class="stat-value">{formatValue(eyeMax, 1)} mJ/cm²</span>
							</div>
							<div class="safety-stat">
								<span class="stat-label">TLV ({$room.standard})</span>
								<span class="stat-value muted">{currentLimits.eye} mJ/cm²</span>
							</div>
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<!-- Pathogen Reduction Section -->
		{#if avgFluence !== null && avgFluence !== undefined}
			<section class="results-section">
				<h4 class="section-title">Pathogen Reduction in Air</h4>

				{#if loadingTable}
					<p class="loading-text">Loading disinfection data...</p>
				{:else if disinfectionData}
					<!-- Disinfection Time Table -->
					<div class="disinfection-table">
						<div class="table-header">
							<span class="col-species">Pathogen</span>
							<span class="col-time">90%</span>
							<span class="col-time">99%</span>
							<span class="col-time">99.9%</span>
						</div>
						{#each disinfectionData.rows as row}
							<div class="table-row">
								<span class="col-species">{row.species}</span>
								<span class="col-time">{formatTime(row.seconds_to_90)}</span>
								<span class="col-time">{formatTime(row.seconds_to_99)}</span>
								<span class="col-time">{formatTime(row.seconds_to_99_9)}</span>
							</div>
						{/each}
					</div>

					<!-- Survival Plot (loads independently) -->
					{#if loadingPlot}
						<p class="loading-text">Loading survival plot...</p>
					{:else if survivalPlotBase64}
						<div class="survival-plot">
							<img
								src="data:image/png;base64,{survivalPlotBase64}"
								alt="Pathogen survival over time"
							/>
						</div>
					{/if}
				{:else}
					<div class="summary-row">
						<span class="summary-label">Average Fluence</span>
						<span class="summary-value highlight">{formatValue(avgFluence, 3)} µW/cm²</span>
					</div>
				{/if}
			</section>
		{/if}

		<!-- Ozone Generation Section (222nm only) -->
		{#if hasOnly222nmLamps && avgFluence}
			<section class="results-section">
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

		<!-- Save Results Dropdown -->
		<section class="results-section export-section">
			<button class="toggle-btn" onclick={() => showSaveDropdown = !showSaveDropdown}>
				{showSaveDropdown ? '▼' : '▶'} Save Results
			</button>

			{#if showSaveDropdown}
				<div class="dropdown-section">
					<div class="export-row">
						<button class="export-btn primary" onclick={exportAllResults} disabled={isExportingAll}>
							{isExportingAll ? 'Exporting...' : 'Export All (ZIP)'}
						</button>
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={includePlots} />
							<span>Include plots</span>
						</label>
					</div>

					{#each $zones.filter(z => hasResults(z.id)) as zone (zone.id)}
						{@const result = getZoneResult(zone.id)}
						{#if result?.values}
							<div class="export-row">
								<button class="export-btn" onclick={() => exportZoneCSV(zone.id)} disabled={exportingZoneId === zone.id}>
									{exportingZoneId === zone.id ? 'Exporting...' : (zone.name || zone.id)}
								</button>
								<span class="checkbox-placeholder"></span>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>

<!-- Zone Plot Modal -->
{#if plotModalZone}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="plot-modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) closePlotModal(); }}>
		<div class="plot-modal-content" role="dialog" aria-modal="true">
			<div class="plot-modal-header">
				<h3>{plotModalZone.name}</h3>
				<button type="button" class="close-btn" onclick={closePlotModal} title="Close">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M18 6L6 18M6 6l12 12"/>
					</svg>
				</button>
			</div>

			<div class="plot-modal-body">
				{#if loadingPlotLowRes}
					<div class="plot-loading">
						<div class="spinner"></div>
						<p>Loading plot...</p>
					</div>
				{:else if plotImageLowRes}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
					<img
						src={plotImageLowRes}
						alt="Zone calculation plot"
						class="plot-image"
						class:clickable={plotImageHiRes !== null}
						onclick={handlePlotImageClick}
					/>
					{#if loadingPlotHiRes}
						<p class="loading-hires-hint">Loading hi-res version...</p>
					{:else if plotImageHiRes}
						<p class="click-hint">Click image to view hi-res</p>
					{/if}
				{:else}
					<div class="plot-error">Failed to load plot</div>
				{/if}
			</div>

			<div class="plot-modal-footer">
				<button class="export-btn" onclick={() => exportZoneCSV(plotModalZone!.id)} disabled={exportingZoneId === plotModalZone.id}>
					{exportingZoneId === plotModalZone.id ? 'Exporting...' : 'Export CSV'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Hi-res Lightbox -->
{#if showHiRes && plotImageHiRes}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="lightbox-backdrop" onclick={() => { showHiRes = false; }}>
		<img src={plotImageHiRes} alt="Zone plot hi-res" class="lightbox-image" />
		<button type="button" class="lightbox-close" onclick={() => { showHiRes = false; }} title="Close">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M18 6L6 18M6 6l12 12"/>
			</svg>
		</button>
	</div>
{/if}

<style>
	.stats-panel {
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
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

	.calc-time {
		font-size: 0.7rem;
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
		font-size: 0.75rem;
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
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--spacing-sm) 0;
	}

	/* Summary rows */
	.summary-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-xs) 0;
	}

	.summary-label {
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.summary-value {
		font-family: var(--font-mono);
		font-size: 0.875rem;
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
		font-size: 0.875rem;
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

	/* Safety grid */
	.safety-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
	}

	.safety-column {
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
	}

	.safety-column h5 {
		margin: 0 0 var(--spacing-sm) 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.safety-stat {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		padding: 2px 0;
	}

	.safety-stat .stat-label {
		color: var(--color-text-muted);
	}

	.safety-stat .stat-value {
		font-family: var(--font-mono);
	}

	.safety-stat .stat-value.muted {
		color: var(--color-text-muted);
	}

	.safety-stat .stat-value.compliant {
		color: var(--color-success);
	}

	.safety-stat .stat-value.near-limit {
		color: var(--color-near-limit);
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
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.standard-selector select {
		flex: 1;
		font-size: 0.8rem;
		padding: var(--spacing-xs) var(--spacing-sm);
	}

	/* Help text */
	.help-text {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin: var(--spacing-xs) 0 0 0;
		font-style: italic;
	}

	.warning-text {
		font-size: 0.75rem;
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
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.input-row input {
		font-family: var(--font-mono);
		font-size: 0.8rem;
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
		font-size: 0.875rem;
	}

	.zone-type {
		font-size: 0.65rem;
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
		font-size: 0.6rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}

	.stat .stat-value {
		font-family: var(--font-mono);
		font-size: 0.8rem;
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
		font-size: 0.65rem;
		color: var(--color-text-muted);
	}

	.no-results {
		text-align: center;
		padding: var(--spacing-sm);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-style: italic;
	}

	/* Export buttons */
	.export-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s;
		width: 100%;
		margin-top: var(--spacing-sm);
	}

	.export-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.export-btn.small {
		width: auto;
		margin-top: 0;
		padding: 2px var(--spacing-xs);
		font-size: 0.65rem;
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
		font-size: 0.75rem;
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
		font-size: 0.9rem;
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
		font-size: 0.7rem;
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
		font-size: 0.8rem;
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
		font-size: 0.75rem;
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
		font-size: 0.8rem;
		color: var(--color-text-muted);
		font-style: italic;
		margin: var(--spacing-sm) 0;
	}

	/* Zone actions in footer */
	.zone-actions {
		display: flex;
		gap: var(--spacing-xs);
	}

	/* Plot Modal */
	.plot-modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-sm);
	}

	.plot-modal-content {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		max-width: min(700px, 95vw);
		max-height: 95vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.plot-modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-xs) var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.plot-modal-header h3 {
		margin: 0;
		font-size: 0.9rem;
		color: var(--color-text);
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

	.plot-modal-body {
		padding: var(--spacing-sm);
		display: flex;
		flex-direction: column;
		align-items: center;
		min-height: 0;
		flex: 1;
	}

	.plot-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-lg);
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.plot-image {
		max-width: 100%;
		max-height: calc(95vh - 100px);
		height: auto;
		width: auto;
		object-fit: contain;
		border-radius: var(--radius-sm);
	}

	.plot-image.clickable {
		cursor: zoom-in;
		transition: opacity 0.15s;
	}

	.plot-image.clickable:hover {
		opacity: 0.9;
	}

	.click-hint {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		margin: 2px 0 0 0;
		text-align: center;
	}

	.loading-hires-hint {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		font-style: italic;
		margin: 2px 0 0 0;
		text-align: center;
	}

	.plot-error {
		padding: var(--spacing-md);
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.plot-modal-footer {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: flex-end;
		flex-shrink: 0;
	}

	.plot-modal-footer .export-btn {
		width: auto;
		margin-top: 0;
	}

	/* Lightbox */
	.lightbox-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.9);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2000;
		padding: var(--spacing-lg);
	}

	.lightbox-image {
		max-width: 90vw;
		max-height: 90vh;
		object-fit: contain;
		border-radius: var(--radius-md);
	}

	.lightbox-close {
		position: absolute;
		top: var(--spacing-md);
		right: var(--spacing-md);
		width: 44px;
		height: 44px;
		padding: 0;
		background: rgba(255, 255, 255, 0.1);
		border: none;
		border-radius: 50%;
		color: white;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
	}

	.lightbox-close:hover {
		background: rgba(255, 255, 255, 0.2);
	}
</style>
