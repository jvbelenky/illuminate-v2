<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from './Modal.svelte';
	import PathogenMultiSelect from './PathogenMultiSelect.svelte';
	import { project, reportMeta, results, resultsStale, room, lamps, zones } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { postSessionReportPdf, getSessionReport, getEfficacyExploreData, errorDetail, ApiError } from '$lib/api/client';
	import { performCalculation } from '$lib/utils/calculate';
	import { parseTableResponse, type EfficacyRow } from '$lib/utils/efficacy-filters';
	import { speciesWithDataAt } from '$lib/utils/resultsSummary';
	import { captureReportImages, captureThumbnails, COVER_CHOICES, type SceneCaptureApi, type CoverChoice } from '$lib/utils/reportCapture';
	import { reportFixtureNames } from '$lib/utils/reportFixtureNames';
	import { customLamps } from '$lib/stores/lampLibrary';
	import type { ReportRequest } from '$lib/api/contract';

	interface Props {
		onClose: () => void;
		/** The 3D view's capture API; null while the scene is not mounted. */
		captureApi: SceneCaptureApi | null;
	}
	let { onClose, captureApi }: Props = $props();

	// ----- species with inactivation data at the lamps' wavelengths -----
	let rows = $state<EfficacyRow[]>([]);
	onMount(async () => {
		try {
			const data = await getEfficacyExploreData();
			rows = parseTableResponse(data.table.columns, data.table.rows);
		} catch (e) {
			console.error('Failed to load efficacy data for the report', e);
		}
	});
	const wavelengths = $derived.by(() => {
		const byWv = $results?.fluenceByWavelength;
		if (byWv && Object.keys(byWv).length > 0) return Object.keys(byWv).map(Number);
		return [...new Set($lamps.map((l) => l.wavelength).filter((w): w is number => w != null))];
	});
	const speciesOptions = $derived(speciesWithDataAt(rows, wavelengths));
	const categoryOf = $derived.by(() => {
		const m = new Map<string, string>();
		for (const r of rows) if (r.medium === 'Aerosol' && !m.has(r.species)) m.set(r.species, r.category);
		return m;
	});
	// Pre-selected: the species the user compares in the panel, with the summary pick
	// first so the report's headline tiles name the same species as the panel
	const selectedSpecies = $derived.by(() => {
		const summary = $userSettings.summarySpecies;
		const rest = $userSettings.resultSpecies.filter((s) => s !== summary);
		const wanted = summary && !summary.startsWith('group:') ? [summary, ...rest] : [...$userSettings.resultSpecies];
		return wanted.filter((s) => speciesOptions.includes(s));
	});
	function setSpecies(next: string[]) {
		userSettings.update((s) => ({ ...s, resultSpecies: next }));
	}

	// ----- cover view thumbnails -----
	let thumbs = $state<Partial<Record<CoverChoice, string>>>({});
	onMount(async () => {
		if (!captureApi) return;
		try {
			thumbs = await captureThumbnails(captureApi, COVER_CHOICES.map((c) => c.id), 240);
		} catch (e) {
			console.error('Report thumbnails failed', e);
		}
	});

	// ----- generation -----
	const hasResults = $derived(!!$results?.zones && Object.keys($results.zones).length > 0);
	let busy = $state(false);
	let status = $state<string | null>(null);
	let error = $state<string | null>(null);
	// Missing or stale results are not a blocker: generate() calculates first
	const needsCalculation = $derived(!hasResults || $resultsStale);
	const canGenerate = $derived(selectedSpecies.length > 0 && !!captureApi && !busy);

	function downloadBlob(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	function slug(title: string): string {
		return title.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'report';
	}

	/** Calculate if the results are missing or stale; false (with the error shown) when that fails. */
	async function ensureFreshResults(): Promise<boolean> {
		if (!needsCalculation) return true;
		status = 'Calculating…';
		const result = await performCalculation();
		if (result.success) return true;
		error = result.error ?? (result.budgetError ? 'The calculation exceeds the resource budget; reduce the zone resolution and try again.' : 'Calculation failed');
		return false;
	}

	/** The plain CSV report (the pre-PDF format): every input and zone statistic as rows. */
	async function downloadCsv() {
		busy = true;
		error = null;
		try {
			if (!(await ensureFreshResults())) return;
			status = 'Preparing CSV…';
			const blob = await getSessionReport();
			downloadBlob(blob, `${slug($reportMeta.title)}_report.csv`);
			status = null;
		} catch (e) {
			status = null;
			error = errorDetail(e, 'CSV export failed');
		} finally {
			busy = false;
		}
	}

	/** The backend's own "no results" answer: the browser's view of freshness was wrong. */
	function backendHasNoResults(e: unknown): boolean {
		return e instanceof ApiError && e.status === 400 && /calculate the room/i.test(errorDetail(e));
	}

	/** Capture the views, render the PDF and download it. */
	async function renderPdf() {
		if (!captureApi) throw new Error('The 3D view is not available for capture');
		status = 'Capturing views…';
		// Custom volumes only: the whole-room fluence is reported by its numbers and survival curves
		const volumes = $zones
			.filter((z) => z.type === 'volume' && z.id !== 'WholeRoomFluence' && $results?.zones?.[z.id])
			.map((z) => ({ id: z.id, mean: $results?.zones?.[z.id]?.statistics?.mean }));
		const images = await captureReportImages(captureApi, {
			coverView: $userSettings.reportCoverView,
			volumes,
			colormap: $room.colormap || 'plasma',
			lampIds: $lamps.filter((l) => l.enabled).map((l) => l.id),
		});
		status = 'Rendering PDF…';
		const body: ReportRequest = {
			meta: $reportMeta,
			options: { include_lamp_appendix: true, include_methodology: true, page_size: 'auto' },
			pathogens: selectedSpecies,
			images,
			fixture_names: reportFixtureNames($lamps, $customLamps),
		};
		const blob = await postSessionReportPdf(body);
		downloadBlob(blob, `${slug($reportMeta.title)}_report.pdf`);
	}

	async function generate() {
		if (!captureApi) return;
		busy = true;
		error = null;
		try {
			if (!(await ensureFreshResults())) return;
			try {
				await renderPdf();
			} catch (e) {
				// The backend session may have lost its results (restart, expiry) while the
				// browser still holds some: calculate once and try again rather than report it.
				if (!backendHasNoResults(e)) throw e;
				status = 'Calculating…';
				const result = await performCalculation();
				if (!result.success) {
					error = result.error ?? 'Calculation failed';
					return;
				}
				await renderPdf();
			}
			status = null;
		} catch (e) {
			status = null;
			error = errorDetail(e, 'Report generation failed');
		} finally {
			busy = false;
		}
	}
</script>

<Modal title="Generate report" {onClose} maxWidth="640px">
	{#snippet body()}
		<div class="report-body">
			{#if !hasResults}
				<div class="notice">The room will be calculated first; the report is built from fresh results.</div>
			{:else if $resultsStale}
				<div class="notice">The room has changed since the last calculation, so it will be recalculated first.</div>
			{/if}

			<section>
				<h4>Details</h4>
				<div class="card">
				<label>
					Title
					<input type="text" aria-label="Title" value={$reportMeta.title} maxlength="120"
						oninput={(e) => project.updateReportMeta({ title: (e.target as HTMLInputElement).value })} />
				</label>
				<div class="row">
					<label>
						Client or site
						<input type="text" aria-label="Client or site" value={$reportMeta.client} maxlength="120"
							oninput={(e) => project.updateReportMeta({ client: (e.target as HTMLInputElement).value })} />
					</label>
					<label>
						Prepared by
						<input type="text" aria-label="Prepared by" value={$reportMeta.prepared_by} maxlength="120"
							oninput={(e) => project.updateReportMeta({ prepared_by: (e.target as HTMLInputElement).value })} />
					</label>
				</div>
				<label>
					Notes
					<textarea aria-label="Notes" rows="3" value={$reportMeta.notes} maxlength="2000"
						oninput={(e) => project.updateReportMeta({ notes: (e.target as HTMLTextAreaElement).value })}></textarea>
				</label>
				</div>
			</section>

			<section>
				<h4>Cover view</h4>
				<div class="card">
				<div class="thumbs" role="radiogroup" aria-label="Cover view">
					{#each COVER_CHOICES as c (c.id)}
						<label class="thumb" class:active={$userSettings.reportCoverView === c.id}>
							<input type="radio" name="cover" value={c.id} aria-label={c.label}
								checked={$userSettings.reportCoverView === c.id}
								onchange={() => userSettings.update((s) => ({ ...s, reportCoverView: c.id }))} />
							{#if thumbs[c.id]}
								<img src={thumbs[c.id]} alt="" />
							{:else}
								<div class="thumb-empty"></div>
							{/if}
							<span>{c.label}</span>
						</label>
					{/each}
				</div>
				</div>
			</section>

			<section>
				<h4>Pathogens</h4>
				<div class="card">
				{#if speciesOptions.length > 0}
					<PathogenMultiSelect options={speciesOptions} {categoryOf} selected={selectedSpecies} onChange={setSpecies} />
					{#if selectedSpecies.length === 0}
						<div class="hint">Choose at least one pathogen.</div>
					{/if}
				{:else}
					<div class="hint">No inactivation data at the lamps' wavelengths.</div>
				{/if}
				</div>
			</section>

			{#if error}
				<div class="error" role="alert">{error}</div>
			{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="footer-row">
			<span class="status" aria-live="polite">{status ?? ''}</span>
			<button type="button" class="secondary" onclick={onClose}>Close</button>
			<button type="button" class="secondary" onclick={downloadCsv} disabled={busy} title="The plain data report: inputs and zone statistics as CSV">Download CSV</button>
			<button type="button" onclick={generate} disabled={!canGenerate}>Generate PDF</button>
		</div>
	{/snippet}
</Modal>

<style>
	/* Same rhythm as the Export and Settings modals: generous body padding,
	   each section a labelled card. */
	.report-body {
		padding: var(--spacing-lg);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
	}
	section h4 {
		margin: 0 0 var(--spacing-xs) 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}
	.card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	input[type="text"], textarea {
		width: 100%;
		box-sizing: border-box;
		color: var(--color-text);
		font: inherit;
	}
	textarea {
		resize: vertical;
		min-height: 3.5em;
		padding: var(--spacing-sm);
		background: var(--color-bg-input);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-base);
	}
	textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
	}
	.thumbs {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--spacing-sm);
	}
	.thumb {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		align-items: stretch;
		text-align: center;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text);
		background: var(--color-bg);
		transition: border-color 0.15s ease;
	}
	.thumb:hover {
		border-color: var(--color-text-muted);
	}
	.thumb.active {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}
	.thumb input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.thumb img, .thumb-empty {
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		background: var(--color-bg-tertiary);
		border-radius: 2px;
	}
	.thumb span {
		font-size: var(--font-size-xs);
		line-height: 1.2;
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.notice {
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		background: color-mix(in srgb, var(--color-warning) 12%, var(--color-bg));
		border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
	}
	.error {
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 10%, var(--color-bg));
		border: 1px solid color-mix(in srgb, var(--color-error) 25%, transparent);
	}
	.footer-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-md) var(--spacing-lg);
		border-top: 1px solid var(--color-border);
	}
	.status {
		flex: 1;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	@media (max-width: 767px) {
		.report-body { padding: var(--spacing-md); }
		.row, .thumbs { grid-template-columns: 1fr 1fr; }
	}
</style>
