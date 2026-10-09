<script lang="ts">
	import { tick } from 'svelte';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import SpectrumFileField from './SpectrumFileField.svelte';
	import FixtureEditor from './FixtureEditor.svelte';
	import LampFacetCard from './LampFacetCard.svelte';
	import FileBox from './FileBox.svelte';
	import NominalSpectrumLine from './NominalSpectrumLine.svelte';
	import SpectrumChart from './SpectrumChart.svelte';
	import FixtureScene from './FixtureScene.svelte';
	import { Canvas } from '@threlte/core';
	import { theme } from '$lib/stores/theme';
	import type { SpectrumFileFieldValue } from './SpectrumFileField.svelte';
	import { lampLibrary, customLamps, fileToEmbedded } from '$lib/stores/lampLibrary';
	import { lamps, project } from '$lib/stores/project';
	import { getLampContentHash, analyzeLampIes, plotLampIes, parseSpectrumFile } from '$lib/api/client';
	import type { EmitterOffset, HousingFaceToken, HousingRoll, IesAnalysisResponse } from '$lib/api/contract';
	import { aimToHousingExtents, fixtureSummary, formatExtents, matchFileFrame, type FixtureDraft } from '$lib/utils/housingGeometry';
	import { resolveFixtureView } from '$lib/utils/fixtureView';
	import { lampColor } from '$lib/utils/wavelengthColor';
	import type { PhotometricAxis } from '$lib/utils/photometricAxis';
	import type { CustomLampDef, CustomLampType, EmbeddedFile } from '$lib/types/lampLibrary';
	import { DEFAULT_UNITS, LENGTH_UNITS, fromMeters, toLengthUnit, unitAbbrev, unitLabel, type LengthUnit } from '$lib/utils/unitConversion';

	interface Props {
		onClose: () => void;
		initialLampType?: CustomLampType;
		// Called ONLY after a successful add (never on edit) with the new
		// definition id, so a launching lamp can auto-apply the created lamp.
		onCreated?: (defId: string) => void;
		// Open straight into editing this definition (a lamp editor's
		// "Spectrum..." button). Saving or cancelling closes the manager.
		initialEditDefId?: string;
	}

	let { onClose, initialLampType, onCreated, initialEditDefId }: Props = $props();

	// Captured once — this prop only ever sets the initial view/type; it is
	// not meant to be reactive across the modal's lifetime.
	const initialType = initialLampType;

	// Tracks whether the CURRENTLY open form is the launch-prefilled session
	// (opened directly into the form via initialType, targeting the launching
	// lamp via +page's lampManagerTargetLampId). onCreated auto-applies the new
	// def to that launching lamp, so it must fire only for a def created from
	// this specific session — never for an unrelated def added later from the
	// list (e.g. after cancelling back out of the prefilled form). Cancelling
	// or completing that session permanently revokes the association for the
	// rest of this modal instance's lifetime.
	let launchedFormActive = $state(initialType !== undefined);

	type View = 'list' | 'form';

	let view = $state<View>(initialType ? 'form' : 'list');
	let editingId = $state<string | null>(null);

	// --- Draft form state (a copy, never a store mirror — see startAdd/startEdit) ---
	let name = $state('');
	// In add mode the name auto-fills from the picked IES filename until the user
	// edits the Name field. Clearing the field back to empty re-enables autopop.
	// Edit mode initializes this true so replacing the IES never renames the def.
	let nameEdited = $state(false);
	let formLampType = $state<CustomLampType>(initialType ?? 'krcl_222');
	let wavelength = $state<number | undefined>(undefined);

	let iesFile = $state<File | null>(null);
	let currentIesFilename = $state<string | undefined>(undefined);
	let iesInput: HTMLInputElement;

	let spectrumValue = $state<SpectrumFileFieldValue | null>(null);
	let currentSpectrumFilename = $state<string | undefined>(undefined);
	let spectrumCleared = $state(false);

	// Scaling as in Advanced Lamp Settings; total power by default. An unset
	// value keeps the file as it is (the placeholder shows the file's figure).
	type ScalingChoice = 'total' | 'max' | 'center' | 'factor';
	let scalingMethod = $state<ScalingChoice>('total');
	let scalingValue = $state<number | undefined>(undefined);
	let intensityUnits = $state<'mw/sr' | 'uw/cm2' | undefined>(undefined);
	let surfaceWidth = $state<number | undefined>(undefined);
	let surfaceLength = $state<number | undefined>(undefined);
	let surfaceHeight = $state<number | undefined>(undefined);
	let surfaceUnits = $state<LengthUnit>(DEFAULT_UNITS);
	let housingWidth = $state<number | undefined>(undefined);
	let housingLength = $state<number | undefined>(undefined);
	let housingHeight = $state<number | undefined>(undefined);
	let photometricAxis = $state<PhotometricAxis>('down');
	let mountFace = $state<HousingFaceToken>('top');
	let housingRoll = $state<HousingRoll>(0);
	let emitterOffset = $state<EmitterOffset | null>(null);
	// Once the user picks a face, roll or offset (or edits a saved definition), the
	// layout stops following the beam direction.
	let layoutTouched = $state(false);
	// The lamp is shown as three cards (photometry, spectrum, fixture); Details
	// (Edit, for the fixture) opens one card's page, left only by Back. The
	// fixture is "Auto-detected" from the IES file until the user changes it.
	type Facet = 'photometry' | 'spectrum' | 'fixture';
	const FACET_TITLES: Record<Facet, string> = { photometry: 'Photometry', spectrum: 'Spectrum', fixture: 'Fixture' };
	let facet = $state<Facet | null>(null);
	let fixtureEdited = $state(false);
	// spectrum preview: the chosen file's (or saved definition's) curve
	let spectrumPreview = $state.raw<{ wavelengths: number[]; intensities: number[]; peak: number } | null>(null);
	let spectrumToken = 0;
	// Raw: the web holds ~10k vertex arrays and is only ever replaced whole; a
	// deep proxy makes the 3D scene's vertex loop quadratic and hangs the page.
	let iesAnalysis = $state.raw<IesAnalysisResponse | null>(null);
	let analysisToken = 0;
	// photometric polar plot of the chosen file (base64 PNG) for the preview column
	let iesPlot = $state<string | null>(null);
	let plotToken = 0;
	let sourceDensity = $state<number | undefined>(undefined);
	let intensityMapFile = $state<File | null>(null);
	let currentIntensityMapFilename = $state<string | undefined>(undefined);
	let intensityMapCleared = $state(false);

	let saveToBrowser = $state(true);
	let formError = $state<string | null>(null);
	// Why Save failed; shown beside the Save button, where the user is when it fails
	let saveError = $state<string | null>(null);
	let saving = $state(false);

	let deleteConfirm = $state<{ id: string; name: string; usedBy: { id: string; name: string }[] } | null>(null);
	let removeFromBrowserConfirm = $state<{ id: string; name: string } | null>(null);

	let browserLamps = $derived($customLamps.filter((d) => d.scope === 'browser'));
	let projectLamps = $derived($customLamps.filter((d) => d.scope === 'project'));

	let spectrumAttached = $derived(
		spectrumValue !== null ||
			(editingId !== null && currentSpectrumFilename !== undefined && !spectrumCleared)
	);

	// A freshly-picked spectrum file supersedes an earlier clear.
	$effect(() => {
		if (spectrumValue !== null) spectrumCleared = false;
	});

	function typeBadge(t: CustomLampType): string {
		if (t === 'krcl_222') return '222 nm';
		if (t === 'lp_254') return '254 nm';
		return 'Other';
	}

	function resetDraft() {
		name = '';
		nameEdited = false;
		formLampType = initialType ?? 'krcl_222';
		wavelength = undefined;
		iesFile = null;
		currentIesFilename = undefined;
		spectrumValue = null;
		currentSpectrumFilename = undefined;
		spectrumCleared = false;
		scalingMethod = 'total';
		scalingValue = undefined;
		intensityUnits = undefined;
		surfaceWidth = undefined;
		surfaceLength = undefined;
		surfaceHeight = undefined;
		surfaceUnits = DEFAULT_UNITS;
		housingWidth = undefined;
		housingLength = undefined;
		housingHeight = undefined;
		photometricAxis = 'down';
		mountFace = 'top';
		housingRoll = 0;
		emitterOffset = null;
		layoutTouched = false;
		facet = null;
		fixtureEdited = false;
		iesAnalysis = null;
		iesPlot = null;
		sourceDensity = undefined;
		intensityMapFile = null;
		currentIntensityMapFilename = undefined;
		intensityMapCleared = false;
		saveToBrowser = true;
		formError = null;
		saveError = null;
	}

	function startAdd() {
		editingId = null;
		resetDraft();
		view = 'form';
	}

	function startEdit(def: CustomLampDef) {
		editingId = def.id;
		name = def.name;
		nameEdited = true;
		formLampType = def.lampType;
		wavelength = def.wavelength;
		iesFile = null;
		currentIesFilename = def.ies.filename;
		spectrumValue = null;
		currentSpectrumFilename = def.spectrum?.filename;
		spectrumCleared = false;
		if (def.scalingMethod != null) {
			scalingMethod = def.scalingMethod;
			scalingValue = def.scalingValue;
		} else if (def.scalingFactor != null) {
			scalingMethod = 'factor';
			scalingValue = def.scalingFactor;
		} else {
			scalingMethod = 'total';
			scalingValue = undefined;
		}
		intensityUnits = def.intensityUnits;
		surfaceWidth = def.surface?.width;
		surfaceLength = def.surface?.length;
		surfaceHeight = def.surface?.height;
		surfaceUnits = toLengthUnit(def.surface?.units);
		housingWidth = def.housing?.width;
		housingLength = def.housing?.length;
		housingHeight = def.housing?.height;
		photometricAxis = def.photometricAxis ?? 'down';
		mountFace = def.housing?.mountFace ?? 'top';
		housingRoll = def.housing?.roll ?? 0;
		emitterOffset = def.housing?.offset ?? null;
		layoutTouched = true;
		facet = null;
		// definitions saved before the flag existed: a stored size or offset was typed in
		fixtureEdited = def.fixtureEdited ?? !!(
			def.housing?.length ?? def.housing?.width ?? def.housing?.height ?? def.housing?.offset
			?? def.surface?.length ?? def.surface?.width ?? def.surface?.height
		);
		sourceDensity = def.sourceDensity;
		intensityMapFile = null;
		currentIntensityMapFilename = def.intensityMap?.filename;
		intensityMapCleared = false;
		saveToBrowser = def.scope === 'browser';
		formError = null;
		saveError = null;
		view = 'form';
		const existingIes = lampLibrary.toIesFile(def.id);
		if (existingIes) analyzeIes(existingIes, false);
	}

	function cancelForm() {
		view = 'list';
		editingId = null;
		launchedFormActive = false;
		// Launched from a lamp editor to edit one definition: Cancel returns to
		// that editor rather than dropping the user on the library list.
		if (launchedEditActive) {
			launchedEditActive = false;
			onClose();
		}
	}

	function handleNameInput(e: Event) {
		// An emptied field counts as unedited so autopop resumes; any other value
		// locks the name against IES-filename overwrites for the rest of the session.
		nameEdited = (e.target as HTMLInputElement).value.length > 0;
	}

	function handleIesChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || !input.files[0]) return;
		iesFile = input.files[0];
		formError = null;
		saveError = null;
		// Add mode only: seed the name from the IES filename (verbatim, extension
		// included) until the user takes over the field. A programmatic assignment
		// does not fire oninput, so nameEdited stays false and a later pick still
		// overwrites.
		if (editingId === null && !nameEdited) {
			name = iesFile.name;
		}
		input.value = '';
		analyzeIes(iesFile, true);
	}

	// Analyze the IES for the orientation picker. `suggest` adopts the file's
	// suggested axis (new file); editing a saved definition keeps its own.
	async function fetchPlot(file: File) {
		const token = ++plotToken;
		iesPlot = null;
		try {
			const result = await plotLampIes(file, $theme === 'light' ? 'light' : 'dark');
			if (token === plotToken) iesPlot = result.photometric_plot_base64;
		} catch (err) {
			console.warn('Failed to render the photometric preview:', err);
		}
	}

	async function analyzeIes(file: File, suggest: boolean) {
		const token = ++analysisToken;
		iesAnalysis = null;
		fetchPlot(file);
		try {
			const result = await analyzeLampIes(file);
			if (token !== analysisToken) return;
			iesAnalysis = result;
			if (suggest) {
				photometricAxis = result.suggested_axis as PhotometricAxis;
				if (!layoutTouched) ({ face: mountFace, roll: housingRoll } = matchFileFrame(photometricAxis));
				// a new file: its fixture is auto-detected again
				fixtureEdited = false;
			}
		} catch (err: any) {
			if (token !== analysisToken) return;
			formError = err?.message || 'Failed to analyze IES file';
		}
	}

	function buildSurface() {
		if (surfaceWidth == null && surfaceLength == null && surfaceHeight == null) return undefined;
		return { width: surfaceWidth, length: surfaceLength, height: surfaceHeight, units: surfaceUnits };
	}

	function buildHousing() {
		const layoutSet = mountFace !== 'top' || housingRoll !== 0 || emitterOffset != null;
		if (housingWidth == null && housingLength == null && housingHeight == null && !layoutSet) return undefined;
		return {
			width: housingWidth, length: housingLength, height: housingHeight,
			...(layoutSet ? { mountFace, roll: housingRoll, offset: emitterOffset ?? undefined } : {}),
		};
	}

	const fixtureDraft = $derived<FixtureDraft>({
		axis: photometricAxis, housingWidth, housingLength, housingHeight,
		face: mountFace, roll: housingRoll, offset: emitterOffset,
		surfaceLength, surfaceWidth, surfaceHeight,
	});

	function handleFixtureChange(next: FixtureDraft) {
		fixtureEdited = true;
		const offsetChanged = JSON.stringify(next.offset) !== JSON.stringify(emitterOffset);
		if (next.face !== mountFace || next.roll !== housingRoll || offsetChanged) layoutTouched = true;
		const axisChanged = next.axis !== photometricAxis;
		photometricAxis = next.axis;
		housingWidth = next.housingWidth;
		housingLength = next.housingLength;
		housingHeight = next.housingHeight;
		surfaceLength = next.surfaceLength;
		surfaceWidth = next.surfaceWidth;
		surfaceHeight = next.surfaceHeight;
		if (!layoutTouched && axisChanged) {
			({ face: mountFace, roll: housingRoll } = matchFileFrame(next.axis));
		} else {
			mountFace = next.face;
			housingRoll = next.roll;
		}
		emitterOffset = next.offset;
	}

	const SCALING_UNITS: Record<ScalingChoice, string> = { total: 'mW', max: 'µW/cm²', center: 'µW/cm²', factor: '×' };
	// what the file gives for the chosen method, shown until a target is typed
	const scalingPlaceholder = $derived.by(() => {
		if (scalingMethod === 'factor') return '1';
		const v = scalingMethod === 'total' ? iesAnalysis?.total_power_mw
			: scalingMethod === 'max' ? iesAnalysis?.max_irradiance : iesAnalysis?.center_irradiance;
		return v == null ? '' : String(parseFloat(v.toPrecision(4)));
	});

	// the lamp's color follows its wavelength; with a spectrum file, the spectrum's peak
	const fixtureColor = $derived(lampColor({ lamp_type: formLampType, wavelength: spectrumPreview?.peak ?? wavelength }));
	const fixtureViewData = $derived(resolveFixtureView(fixtureDraft, iesAnalysis, surfaceUnits));
	const fixtureText = $derived(
		fixtureSummary(fixtureViewData.layoutDisplay, fixtureViewData.luminousHeight, photometricAxis, surfaceUnits)
	);
	const fmtPower = (v: number) => String(parseFloat(v.toPrecision(4)));
	// the file's total, or the scaling target with the file's total for reference
	const totalPowerText = $derived.by(() => {
		if (!iesAnalysis) return '…';
		const file = `${fmtPower(iesAnalysis.total_power_mw)} mW`;
		if (scalingMethod === 'total' && scalingValue != null) return `${fmtPower(scalingValue)} mW (scaled from ${file})`;
		return file;
	});

	// Nominal wavelength of the lamp type, used when there is no spectrum file
	const nominalWavelength = $derived(
		formLampType === 'krcl_222' ? 222 : formLampType === 'lp_254' ? 254 : (wavelength ?? null)
	);

	// Load the spectrum preview from the chosen file, or the saved definition's
	async function loadSpectrumPreview(file: File | null, columnIndex: number | undefined) {
		const token = ++spectrumToken;
		if (!file) {
			spectrumPreview = null;
			return;
		}
		try {
			const parsed = await parseSpectrumFile(file);
			if (token !== spectrumToken) return;
			const series = parsed.series[columnIndex ?? 0] ?? parsed.series[0];
			spectrumPreview = series
				? { wavelengths: parsed.wavelengths, intensities: series.intensities, peak: series.peak_wavelength }
				: null;
		} catch (err) {
			if (token === spectrumToken) spectrumPreview = null;
			console.warn('Failed to read the spectrum for the preview:', err);
		}
	}

	$effect(() => {
		if (spectrumValue) {
			loadSpectrumPreview(spectrumValue.file, spectrumValue.columnIndex);
		} else if (editingId && currentSpectrumFilename && !spectrumCleared) {
			const def = lampLibrary.get(editingId);
			loadSpectrumPreview(lampLibrary.toSpectrumFile(editingId), def?.spectrum?.columnIndex);
		} else {
			loadSpectrumPreview(null, undefined);
		}
	});

	const hasIes = $derived(!!(iesFile || currentIesFilename));
	const iesName = $derived(iesFile?.name ?? currentIesFilename ?? null);
	const openingText = $derived(formatExtents(fixtureViewData.fallbackHousing, surfaceUnits));
	// the spectrum preview, scaled to a peak of 1
	const relativeSpectrum = $derived.by(() => {
		if (!spectrumPreview) return null;
		const max = Math.max(...spectrumPreview.intensities);
		return max > 0 ? spectrumPreview.intensities.map((v) => v / max) : spectrumPreview.intensities;
	});
	const spectrumChip = $derived(
		spectrumAttached ? { text: 'From file', tone: 'ok' as const }
			: formLampType === 'other' && wavelength == null ? { text: 'Needs a wavelength', tone: 'warn' as const }
			: { text: 'Optional' }
	);
	// the peak of an attached spectrum ('…' while it is read)
	const peakText = $derived(spectrumPreview ? fmtPower(spectrumPreview.peak) : '…');
	const typedWavelength = $derived(formLampType === 'other' && !spectrumAttached);
	const totalPowerParts = $derived.by(() => {
		if (!iesAnalysis) return { value: '…', note: '' };
		const file = fmtPower(iesAnalysis.total_power_mw);
		if (scalingMethod === 'total' && scalingValue != null) return { value: fmtPower(scalingValue), note: ` (scaled from ${file} mW)` };
		return { value: file, note: '' };
	});

	/** Report a missing field beside Save and bring the field into view. */
	async function failValidation(message: string, fieldId: string) {
		saveError = message;
		await tick();
		const field = document.getElementById(fieldId);
		// The IES input itself is hidden behind a button, so scroll its whole group
		(field?.closest('.form-group') ?? field)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
		field?.focus({ preventScroll: true });
	}

	async function save() {
		saveError = null;

		const trimmedName = name.trim();
		if (!trimmedName) {
			failValidation('Name is required', 'lamp-name');
			return;
		}
		const hasExistingIes = editingId !== null && currentIesFilename !== undefined;
		if (!iesFile && !hasExistingIes) {
			failValidation('An IES file is required', 'ies-file-input');
			return;
		}
		if (formLampType === 'other' && wavelength == null && !spectrumAttached) {
			failValidation('Provide a spectrum file or a wavelength for a custom-wavelength lamp', 'wavelength');
			return;
		}

		saving = true;
		try {
			const iesForHash = iesFile ?? (editingId ? lampLibrary.toIesFile(editingId) : null);
			if (!iesForHash) {
				saveError = 'An IES file is required';
				return;
			}
			const spectrumForHash = spectrumValue
				? spectrumValue.file
				: spectrumCleared
					? undefined
					: editingId
						? (lampLibrary.toSpectrumFile(editingId) ?? undefined)
						: undefined;
			const columnIndexForHash = spectrumValue
				? spectrumValue.columnIndex
				: spectrumCleared
					? undefined
					: editingId
						? lampLibrary.get(editingId)?.spectrum?.columnIndex
						: undefined;

			let hash: string;
			try {
				const result = await getLampContentHash(iesForHash, spectrumForHash, columnIndexForHash);
				hash = result.content_hash;
			} catch (err: any) {
				saveError = err?.message || 'Failed to validate IES file';
				return;
			}

			let iesEmbedded: EmbeddedFile;
			if (iesFile) {
				iesEmbedded = await fileToEmbedded(iesFile);
			} else {
				// Reuse the existing definition's IES. If it vanished (deleted in
				// another tab/view since this modal opened), abort cleanly.
				const existing = editingId ? lampLibrary.get(editingId) : undefined;
				if (!existing) {
					saveError = "This lamp was deleted in another view";
					return;
				}
				iesEmbedded = existing.ies;
			}

			let spectrumEmbedded: (EmbeddedFile & { columnIndex?: number }) | undefined;
			if (spectrumValue) {
				spectrumEmbedded = { ...(await fileToEmbedded(spectrumValue.file)), columnIndex: spectrumValue.columnIndex };
			} else if (spectrumCleared) {
				spectrumEmbedded = undefined;
			} else if (editingId) {
				spectrumEmbedded = lampLibrary.get(editingId)?.spectrum;
			}

			let intensityMapEmbedded: EmbeddedFile | undefined;
			if (intensityMapFile) {
				intensityMapEmbedded = await fileToEmbedded(intensityMapFile);
			} else if (intensityMapCleared) {
				intensityMapEmbedded = undefined;
			} else if (editingId) {
				intensityMapEmbedded = lampLibrary.get(editingId)?.intensityMap;
			}

			const fields = {
				name: trimmedName,
				lampType: formLampType,
				wavelength: formLampType === 'other' ? wavelength : undefined,
				ies: iesEmbedded,
				spectrum: spectrumEmbedded,
				scalingFactor: undefined,
				scalingMethod: scalingValue != null ? scalingMethod : undefined,
				scalingValue,
				intensityUnits,
				surface: buildSurface(),
				housing: buildHousing(),
				photometricAxis,
				fixtureEdited,
				sourceDensity,
				intensityMap: intensityMapEmbedded,
				scope: (saveToBrowser ? 'browser' : 'project') as CustomLampDef['scope'],
				contentHash: hash,
			};

			if (editingId) {
				await lampLibrary.update(editingId, fields);
				await project.propagateCustomLampEdit(editingId);
				if (launchedEditActive) {
					launchedEditActive = false;
					onClose();
					return;
				}
			} else {
				const newId = await lampLibrary.add(fields);
				// Only the launch-prefilled session (or a modal opened with no
				// launch context at all, i.e. no initialType) may auto-apply —
				// see launchedFormActive above.
				const fromLaunch = launchedFormActive;
				if (initialType === undefined || launchedFormActive) {
					onCreated?.(newId);
				}
				launchedFormActive = false;
				// The dropdown/launch flow (LampEditor's "Add custom lamp...") returns
				// the user to the lamp editor once the new def is auto-applied, so close
				// the manager. A standalone manager (no launch context) stays open on
				// the list so the user can keep managing definitions.
				if (fromLaunch) {
					onClose();
					return;
				}
			}

			view = 'list';
			editingId = null;
		} finally {
			saving = false;
		}
	}

	function handleRemoveFromBrowser(def: CustomLampDef) {
		const inUse = $lamps.some((l) => l.custom_lamp_id === def.id);
		if (inUse) {
			lampLibrary.setScope(def.id, 'project');
		} else {
			removeFromBrowserConfirm = { id: def.id, name: def.name };
		}
	}

	function confirmRemoveFromBrowser() {
		if (!removeFromBrowserConfirm) return;
		lampLibrary.remove(removeFromBrowserConfirm.id);
		removeFromBrowserConfirm = null;
	}

	function requestDelete(def: CustomLampDef) {
		const usedBy = $lamps.filter((l) => l.custom_lamp_id === def.id);
		if (usedBy.length > 0) {
			deleteConfirm = {
				id: def.id,
				name: def.name,
				usedBy: usedBy.map((l) => ({ id: l.id, name: l.name || 'Unnamed Lamp' })),
			};
		} else {
			lampLibrary.remove(def.id);
		}
	}

	async function confirmDelete() {
		if (!deleteConfirm) return;
		const { id, usedBy } = deleteConfirm;
		for (const l of usedBy) {
			await project.detachCustomLamp(l.id);
		}
		await lampLibrary.remove(id);
		deleteConfirm = null;
	}

	// Launched into edit mode for one definition (captured once, like
	// initialType). Falls back to the list when the definition is gone.
	let launchedEditActive = $state(false);
	const launchedEditDef = initialEditDefId ? lampLibrary.get(initialEditDefId) : undefined;
	if (launchedEditDef) {
		startEdit(launchedEditDef);
		view = 'form';
		launchedEditActive = true;
	}
</script>

<!-- The form hosts the side-by-side fixture editor, so it gets more room than the list -->
<Modal
	title={view === 'form' && facet ? `${name.trim() || 'Custom lamp'} › ${FACET_TITLES[facet]}` : 'Manage Custom Lamps'}
	{onClose}
	onEscapeKey={() => {
		if (view !== 'form' || !facet) return false;
		facet = null;
		return true;
	}}
	width={view === 'form' ? '1040px' : '600px'}
	maxWidth="95vw"
	dockId="lamp-manager"
>
	{#snippet body()}
		<div class="lamp-manager">
			{#if view === 'list'}
				<div class="list-header">
					<button type="button" class="primary" onclick={startAdd}>Add custom lamp</button>
				</div>

				<div class="lamp-section">
					<h3>Saved in storage</h3>
					{#if browserLamps.length === 0}
						<div class="empty-state">No custom lamps saved to storage</div>
					{:else}
						{#each browserLamps as def (def.id)}
							<div class="lamp-row">
								<span class="lamp-name">{def.name}</span>
								<span class="type-badge">{typeBadge(def.lampType)}</span>
								{#if def.spectrum}
									<span class="spectrum-dot" title="Has spectrum"></span>
								{/if}
								<div class="row-actions">
									<button type="button" class="secondary" onclick={() => startEdit(def)}>Edit</button>
									<button type="button" class="secondary" onclick={() => handleRemoveFromBrowser(def)}>Remove from storage</button>
									<button type="button" class="danger" onclick={() => requestDelete(def)}>Delete</button>
								</div>
							</div>
						{/each}
					{/if}
				</div>

				<div class="lamp-section">
					<h3>This project only</h3>
					{#if projectLamps.length === 0}
						<div class="empty-state">No project-only custom lamps</div>
					{:else}
						{#each projectLamps as def (def.id)}
							<div class="lamp-row">
								<span class="lamp-name">{def.name}</span>
								<span class="type-badge">{typeBadge(def.lampType)}</span>
								{#if def.spectrum}
									<span class="spectrum-dot" title="Has spectrum"></span>
								{/if}
								<div class="row-actions">
									<button type="button" class="secondary" onclick={() => startEdit(def)}>Edit</button>
									<button type="button" class="secondary" onclick={() => lampLibrary.setScope(def.id, 'browser')}>Save to storage</button>
									<button type="button" class="danger" onclick={() => requestDelete(def)}>Delete</button>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			{:else}
				<div class="lamp-form" style:--facet-color={fixtureColor}>
					{#if formError}
						<div class="file-status warning">{formError}</div>
					{/if}

					<label for="ies-file-input" class="visually-hidden">IES File</label>
					<input
						id="ies-file-input"
						type="file"
						accept=".ies"
						bind:this={iesInput}
						onchange={handleIesChange}
						style="display: none"
					/>

					{#snippet lampTypeField(detail: boolean)}
						<div class="form-group">
							<label for="lamp-type-select" class:field-label={detail}>Lamp Type</label>
							<select id="lamp-type-select" bind:value={formLampType}>
								<option value="krcl_222">Krypton chloride (222 nm)</option>
								<option value="lp_254">Low-pressure mercury (254 nm)</option>
								<option value="other">Other (custom wavelength)</option>
							</select>
						</div>
					{/snippet}

					{#snippet plotView(stage: boolean)}
						{#if !hasIes}
							<button type="button" class="secondary choose-ies" onclick={() => iesInput.click()}>Choose an IES file…</button>
						{:else if iesPlot}
							<img class="photometric-plot" class:stage src={`data:image/png;base64,${iesPlot}`} alt="Photometric distribution (polar plot)" />
						{:else}
							<span class="muted">Rendering…</span>
						{/if}
					{/snippet}

					{#snippet scalingControl()}
						<div class="scaling-row">
							<select id="scaling-method" aria-label="Scaling method" bind:value={scalingMethod} onchange={() => (scalingValue = undefined)}>
								<option value="total">Scale to total power</option>
								<option value="max">Scale to max irradiance</option>
								<option value="center">Scale to center irradiance</option>
								<option value="factor">Scale by factor</option>
							</select>
							<input id="scaling-value" type="number" step="any" min="0" aria-label="Scaling value" placeholder={scalingPlaceholder} bind:value={scalingValue} />
							<span class="scaling-unit">{SCALING_UNITS[scalingMethod]}</span>
						</div>
					{/snippet}

					{#snippet spectrumView(stage: boolean)}
						{#if spectrumPreview && relativeSpectrum}
							<SpectrumChart
								wavelengths={spectrumPreview.wavelengths}
								series={[{ label: 'Spectrum', intensities: relativeSpectrum, color: fixtureColor, visible: true }]}
								height={stage ? '340px' : '240px'}
								yLabel="Relative intensity"
								interactive={false}
							/>
						{:else}
							<NominalSpectrumLine
								wavelength={nominalWavelength}
								color={fixtureColor}
								tag={formLampType === 'other' ? 'entered' : 'assumed'}
								axes={stage}
							/>
						{/if}
					{/snippet}

					{#snippet spectrumFile(variant: 'link' | 'box')}
						<SpectrumFileField
							bind:value={spectrumValue}
							currentFilename={spectrumCleared ? undefined : currentSpectrumFilename}
							{variant}
							onerror={(msg) => (formError = msg)}
							oncleared={() => (spectrumCleared = true)}
						/>
					{/snippet}

					{#snippet fixtureView()}
						{#if hasIes}
							<Canvas>
								<FixtureScene
									layout={fixtureViewData.layoutMeters}
									axis={photometricAxis}
									surfaceLength={fixtureViewData.surfaceMeters.length}
									surfaceWidth={fixtureViewData.surfaceMeters.width}
									surfaceHeight={fixtureViewData.surfaceMeters.height}
									web={fixtureViewData.web}
									color={fixtureColor}
								/>
							</Canvas>
						{:else}
							<span class="muted">Shown after an IES file is chosen</span>
						{/if}
					{/snippet}

					{#if facet === null}
						<div class="identity-row">
							<div class="form-group">
								<label for="lamp-name">Name</label>
								<input id="lamp-name" type="text" bind:value={name} oninput={handleNameInput} />
							</div>
							{@render lampTypeField(false)}
						</div>

						<div class="facet-cards">
							<LampFacetCard facet="photometry" title="Photometry" chip={hasIes ? { text: 'From file', tone: 'ok' } : undefined}>
								{#snippet file()}
									<FileBox name={iesName} badge="IES" variant="link" addLabel="Add…" emptyText="No IES file" onpick={() => iesInput.click()} replaceTitle="Replace IES file" />
								{/snippet}
								{#snippet preview()}{@render plotView(false)}{/snippet}
								{#snippet figures()}
									{#if hasIes}<div class="figure"><span class="muted">Total power</span> <strong class="num">{totalPowerText}</strong></div>{/if}
								{/snippet}
								{#snippet control()}
									{#if hasIes}
										<div class="form-group">
											<span class="small-label">Scaling</span>
											{@render scalingControl()}
										</div>
									{/if}
								{/snippet}
								{#snippet actions()}
									<button type="button" class="secondary small" data-facet-open="photometry" disabled={!hasIes} onclick={() => (facet = 'photometry')}>Details</button>
								{/snippet}
							</LampFacetCard>

							<LampFacetCard facet="spectrum" title="Spectrum" chip={spectrumChip}>
								{#snippet file()}{@render spectrumFile('link')}{/snippet}
								{#snippet preview()}{@render spectrumView(false)}{/snippet}
								{#snippet figures()}
									<div class="figure">
										<span class="muted">{spectrumAttached ? 'Peak' : 'Wavelength'}</span>
										{#if spectrumAttached}
											<strong class="num">{peakText} nm</strong>
										{:else if typedWavelength}
											<span class="wl-field">
												<input id="wavelength" class="wl-input" type="number" step="any" placeholder="e.g. 265" aria-label="Wavelength (nm)" bind:value={wavelength} aria-invalid={wavelength == null} />
												<span class="muted">nm</span>
											</span>
										{:else}
											<strong class="num">{nominalWavelength} nm</strong>
										{/if}
									</div>
								{/snippet}
								{#snippet actions()}
									<button type="button" class="secondary small" data-facet-open="spectrum" onclick={() => (facet = 'spectrum')}>Details</button>
								{/snippet}
							</LampFacetCard>

							<LampFacetCard
								facet="fixture"
								title="Fixture"
								chip={hasIes ? (fixtureEdited ? { text: 'Edited', tone: 'ok' } : { text: 'Auto-detected', tone: 'warn' }) : undefined}
								preview={fixtureView}
							>
								{#snippet figures()}
									{#if hasIes && iesAnalysis}
										<div class="figure"><span class="muted">{fixtureText.mounting}</span></div>
										<div class="figure"><span class="muted">Luminous opening</span> <strong class="num">{openingText}</strong></div>
										<div class="figure"><span class="muted">Luminaire housing</span> <strong class="num">{fixtureText.housing}</strong></div>
									{/if}
								{/snippet}
								{#snippet actions()}
									<button type="button" class="secondary small" data-facet-open="fixture" disabled={!hasIes} onclick={() => (facet = 'fixture')}>Edit</button>
								{/snippet}
							</LampFacetCard>
						</div>

						<label class="checkbox-label">
							<input type="checkbox" bind:checked={saveToBrowser} />
							<span>Save to storage for future sessions. The file will only be available to you, not other users.</span>
						</label>

						{#if saveError}
							<p class="file-status warning save-error" role="alert">{saveError}</p>
						{/if}
						<div class="form-actions">
							<button type="button" class="secondary" onclick={cancelForm} disabled={saving}>Cancel</button>
							<button type="button" class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save lamp'}</button>
						</div>
					{:else}
						<div class="facet-detail" data-facet-detail={facet}>
							{#if facet === 'photometry'}
								<div class="detail-controls">
									<div class="field">
										<span class="field-label">Photometry file</span>
										<FileBox name={iesName} badge="IES" variant="box" addLabel="Add IES file" onpick={() => iesInput.click()} replaceTitle="Replace IES file" />
									</div>
									<div class="field">
										<span class="field-label">Total power</span>
										<span class="unit-value"><b>{totalPowerParts.value}</b><span>mW{totalPowerParts.note}</span></span>
									</div>
									<div class="field">
										<span class="field-label">Scaling</span>
										{@render scalingControl()}
									</div>
									<div class="field">
										<label class="field-label" for="intensity-units">Intensity units</label>
										<select id="intensity-units" bind:value={intensityUnits}>
											<option value={undefined}>(default)</option>
											<option value="mw/sr">mW/sr</option>
											<option value="uw/cm2">&micro;W/cm&sup2;</option>
										</select>
									</div>
								</div>
								<div class="detail-stage">{@render plotView(true)}</div>
							{:else if facet === 'spectrum'}
								<div class="detail-controls">
									<div class="field">{@render lampTypeField(true)}</div>
									<div class="field">
										<span class="field-label">Spectrum file</span>
										{@render spectrumFile('box')}
									</div>
									<div class="field">
										<span class="field-label">{spectrumAttached ? 'Peak wavelength' : 'Wavelength'}</span>
										{#if spectrumAttached}
											<span class="unit-value"><b>{peakText}</b><span>nm</span></span>
										{:else if typedWavelength}
											<label class="unit-input" class:invalid={wavelength == null}>
												<input id="wavelength" type="number" step="any" placeholder="265" aria-label="Wavelength (nm)" bind:value={wavelength} />
												<span>nm</span>
											</label>
										{:else}
											<span class="unit-value"><b>{nominalWavelength}</b><span>nm</span></span>
										{/if}
									</div>
								</div>
								<div class="detail-stage">{@render spectrumView(true)}</div>
							{:else}
								<div class="detail-wide">
									<FixtureEditor
										value={fixtureDraft}
										onchange={handleFixtureChange}
										analysis={iesAnalysis}
										units={surfaceUnits}
										color={fixtureColor}
									/>
								</div>
							{/if}
						</div>
						<div class="form-actions back-only">
							<button type="button" class="primary" onclick={() => (facet = null)}>‹ Back</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/snippet}
</Modal>

{#if deleteConfirm}
	<ConfirmDialog
		title="Delete Custom Lamp"
		message="&quot;{deleteConfirm.name}&quot; is used by: {deleteConfirm.usedBy.map((l) => l.name).join(', ')}. These lamps will lose their photometry."
		confirmLabel="Delete"
		variant="danger"
		onConfirm={confirmDelete}
		onCancel={() => (deleteConfirm = null)}
	/>
{/if}

{#if removeFromBrowserConfirm}
	<ConfirmDialog
		title="Remove from Storage"
		message="&quot;{removeFromBrowserConfirm.name}&quot; is not saved anywhere else and will be deleted. Continue?"
		confirmLabel="Remove"
		variant="danger"
		onConfirm={confirmRemoveFromBrowser}
		onCancel={() => (removeFromBrowserConfirm = null)}
	/>
{/if}

<style>
	.lamp-manager {
		padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.list-header {
		display: flex;
		justify-content: flex-end;
	}

	.lamp-section h3 {
		margin: 0 0 var(--spacing-xs);
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.lamp-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		margin-bottom: var(--spacing-xs);
	}

	.lamp-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.type-badge {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		background: var(--color-bg-tertiary);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.spectrum-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-success);
		flex-shrink: 0;
	}

	.row-actions {
		display: flex;
		gap: var(--spacing-xs);
		flex-shrink: 0;
	}

	.empty-state {
		padding: var(--spacing-md);
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		font-style: italic;
	}

	/* Lighter blue for the primary actions (Add custom lamp / Save). Uses the
	   app's defined blue token (--color-info) rather than the undefined
	   --color-primary, which previously computed to a transparent background. */
	button.primary {
		background: var(--color-info);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		padding: 6px 14px;
		font-size: 0.8rem;
		cursor: pointer;
		font-weight: 500;
	}

	button.primary:hover {
		background: color-mix(in srgb, var(--color-info) 85%, black);
	}

	button.danger {
		background: none;
		border: 1px solid var(--color-error);
		color: var(--color-error);
		border-radius: var(--radius-sm);
		padding: 5px 10px;
		font-size: 0.75rem;
		cursor: pointer;
	}

	button.danger:hover {
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
	}

	.lamp-form {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		container-type: inline-size;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: 0.85rem;
		color: var(--color-text);
		cursor: pointer;
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
		flex-shrink: 0;
		margin: 0;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-sm);
	}

	.form-actions .primary,
	.form-actions .secondary {
		width: auto;
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: var(--font-size-sm);
	}

	.file-status {
		font-size: var(--font-size-base);
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.file-status.warning {
		background: color-mix(in srgb, var(--color-warning) 15%, transparent);
		color: var(--color-warning);
	}

	.muted {
		color: var(--color-text-muted);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.identity-row {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		gap: var(--spacing-md);
	}

	.identity-row .form-group {
		margin-bottom: 0;
	}

	/* three cards with the same anatomy; one opens across the width */
	.facet-cards {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--spacing-sm);
	}

	.facet-cards :global(.form-group) {
		margin-bottom: 0;
	}

	.figure {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--spacing-sm);
	}

	.figure strong {
		text-align: right;
	}

	.num {
		font-variant-numeric: tabular-nums;
	}

	.choose-ies {
		width: auto;
	}

	.photometric-plot {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}

	.photometric-plot.stage {
		height: 420px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field :global(.form-group) {
		margin-bottom: 0;
	}

	.field-label {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.unit-value {
		display: inline-flex;
		align-items: baseline;
		gap: 6px;
	}

	.unit-value b {
		font-size: 1.4rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.unit-value span,
	.unit-input span {
		color: var(--color-text-muted);
	}

	.unit-input {
		display: inline-flex;
		align-items: baseline;
		gap: 6px;
		width: 11rem;
		padding: 8px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		cursor: text;
	}

	.unit-input:focus-within {
		border-color: var(--facet-color, var(--color-accent));
	}

	.unit-input.invalid {
		border-color: var(--color-warning);
	}

	.unit-input input {
		flex: 1;
		min-width: 0;
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		font-size: 1.4rem;
		font-weight: 600;
		outline: none;
	}

	.wl-field {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.wl-input {
		width: 8rem;
	}

	.wl-input[aria-invalid='true'] {
		border-color: var(--color-warning);
	}

	.form-actions.back-only {
		justify-content: flex-start;
	}

	.form-actions.back-only .primary {
		padding: 8px 20px;
		font-size: var(--font-size-base);
		font-weight: 600;
	}

	.small-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	/* in a card the method gets its own row; the target and unit share the next */
	/* in a card: method, target and unit on one compact line, as the figures above */
	.facet-cards .scaling-row select,
	.facet-cards .scaling-row input {
		padding: 4px 6px;
		font-size: var(--font-size-sm);
	}

	.facet-cards .scaling-row input {
		width: 5.5rem;
	}

	.facet-detail {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
		gap: var(--spacing-md);
		padding: var(--spacing-md);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
	}

	.detail-controls {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		min-width: 0;
	}

	.detail-controls :global(.form-group) {
		margin-bottom: 0;
	}

	.detail-stage {
		display: grid;
		place-items: center;
		min-height: 320px;
		overflow: hidden;
		border-radius: var(--radius-sm);
	}

	.detail-wide {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	@media (max-width: 860px) {
		.facet-cards,
		.facet-detail,
		.identity-row {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.scaling-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.scaling-row select {
		flex: 1 1 auto;
		min-width: 0;
	}

	.scaling-row input {
		width: 7rem;
	}

	.scaling-unit {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
	}
</style>
