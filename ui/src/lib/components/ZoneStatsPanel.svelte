<script lang="ts">
	import { zones, results, room, lamps, project } from '$lib/stores/project';
	import { ROOM_DEFAULTS, type CalcZone, type ZoneResult } from '$lib/types/project';
	import { TLV_LIMITS, OZONE_WARNING_THRESHOLD_PPB } from '$lib/constants/safety';
	import { formatValue } from '$lib/utils/formatting';
	import { calculateHoursToTLV, calculateOzoneIncrease } from '$lib/utils/calculations';
	import { exportZoneCSV as exportZoneCSVUtil, downloadFile } from '$lib/utils/export';
	import { getSessionReport, generateReport as generateReportLegacy } from '$lib/api/client';
	import EfficacyPanel from './EfficacyPanel.svelte';

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
	const overallCompliant = $derived(skinCompliant && eyeCompliant);

	// Calculate hours to TLV
	const skinHoursToLimit = $derived(calculateHoursToTLV(skinMax, currentLimits.skin));
	const eyeHoursToLimit = $derived(calculateHoursToTLV(eyeMax, currentLimits.eye));

	// Get efficacy data from results (now comes from guv-calcs)
	const efficacyData = $derived($results?.efficacy);

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

	// Export zone data as CSV
	function exportZoneCSV(zoneId: string) {
		const result = getZoneResult(zoneId);
		if (!result?.values) return;

		const zone = $zones.find(z => z.id === zoneId);
		if (!zone) return;

		exportZoneCSVUtil(zone, result);
	}

	// Generate summary report using backend session
	let isGeneratingReport = $state(false);

	async function generateReport() {
		if (isGeneratingReport) return;

		isGeneratingReport = true;
		try {
			let blob: Blob;

			// Try to use session report (uses existing Room, no recalculation)
			try {
				blob = await getSessionReport();
			} catch (sessionError) {
				// Fallback to legacy method if session not available
				console.warn('Session report failed, using legacy method:', sessionError);
				const projectData = project.export();
				blob = await generateReportLegacy(projectData);
			}

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
					<span class="summary-value" class:compliant={skinCompliant} class:non-compliant={!skinCompliant}>
						{formatValue(skinMax, 1)} mJ/cm²
					</span>
				</div>
			{/if}

			{#if eyeMax !== null && eyeMax !== undefined}
				<div class="summary-row">
					<span class="summary-label">Max Eye Dose (8hr)</span>
					<span class="summary-value" class:compliant={eyeCompliant} class:non-compliant={!eyeCompliant}>
						{formatValue(eyeMax, 1)} mJ/cm²
					</span>
				</div>
			{/if}

			{#if skinMax !== undefined && eyeMax !== undefined}
				<div class="compliance-banner" class:compliant={overallCompliant} class:non-compliant={!overallCompliant}>
					{#if overallCompliant}
						Installation complies with {$room.standard} TLVs
					{:else}
						Does not comply with {$room.standard} TLVs
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
								<span class="stat-value" class:compliant={skinCompliant} class:non-compliant={!skinCompliant}>
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
								<span class="stat-value" class:compliant={eyeCompliant} class:non-compliant={!eyeCompliant}>
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

		<!-- Pathogen Reduction Section (using guv-calcs efficacy data) -->
		{#if avgFluence !== null && avgFluence !== undefined && efficacyData}
			<section class="results-section">
				<h4 class="section-title">Pathogen Reduction in Air</h4>

				<EfficacyPanel
					avgFluence={efficacyData.average_fluence}
					wavelength={efficacyData.wavelength}
					eachUvMedian={efficacyData.each_uv_median}
					eachUvMin={efficacyData.each_uv_min}
					eachUvMax={efficacyData.each_uv_max}
					pathogenCount={efficacyData.pathogen_count}
					airChanges={$room.air_changes || ROOM_DEFAULTS.air_changes}
				/>
			</section>
		{:else if avgFluence !== null && avgFluence !== undefined}
			<!-- Fallback when no efficacy data from API -->
			<section class="results-section">
				<h4 class="section-title">Pathogen Reduction in Air</h4>
				<div class="summary-row">
					<span class="summary-label">Average Fluence</span>
					<span class="summary-value highlight">{formatValue(avgFluence, 3)} µW/cm²</span>
				</div>
				<p class="help-text">
					Run calculation with efficacy analysis to see detailed pathogen data
				</p>
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

		<!-- User-Defined Zones Section -->
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
									<button class="export-btn small" onclick={() => exportZoneCSV(zone.id)}>
										Export CSV
									</button>
								{/if}
							</div>
						{:else}
							<div class="no-results">Not calculated</div>
						{/if}
					</div>
				{/each}
			</section>
		{/if}

		<!-- Export Section -->
		<section class="results-section export-section">
			<h4 class="section-title">Export Results</h4>

			<div class="export-buttons">
				<button class="export-btn primary" onclick={generateReport}>
					Export All Results
				</button>

				{#each $zones.filter(z => hasResults(z.id)) as zone (zone.id)}
					{@const result = getZoneResult(zone.id)}
					{#if result?.values}
						<button class="export-btn" onclick={() => exportZoneCSV(zone.id)}>
							{zone.name || zone.id}
						</button>
					{/if}
				{/each}
			</div>
		</section>
	{/if}
</div>

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
		color: var(--color-success);
	}

	.summary-value.compliant {
		color: #3b82f6;
	}

	.summary-value.non-compliant {
		color: #dc2626;
	}

	.summary-value.warning {
		color: #dc2626;
	}

	.summary-value.ok {
		color: #3b82f6;
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
		background: rgba(59, 130, 246, 0.1);
		color: #3b82f6;
		border: 1px solid rgba(59, 130, 246, 0.3);
	}

	.compliance-banner.non-compliant {
		background: rgba(220, 38, 38, 0.1);
		color: #dc2626;
		border: 1px solid rgba(220, 38, 38, 0.3);
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
		color: #dc2626;
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
		border-color: var(--color-success);
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
		color: var(--color-success);
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
		color: #000;
		font-weight: 600;
	}

	.export-btn.primary:hover {
		background: #22d37e;
	}

	.export-section .export-buttons {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.export-section .export-btn {
		margin-top: 0;
	}
</style>
