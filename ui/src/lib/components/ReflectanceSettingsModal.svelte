<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Canvas } from '@threlte/core';
	import { project, room, objects } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { theme } from '$lib/stores/theme';
	import type { SurfaceReflectances, SurfaceSpacings, SurfaceNumPointsAll, ReflectanceResolutionMode, SceneObject, FaceOptics } from '$lib/types/project';
	import { uniformReflectances, ROOM_DEFAULTS } from '$lib/types/project';
	import { surfaceIdsFor, surfaceLabel, roomVertices, wallIdsFor, polygonEdgeLengths } from '$lib/utils/roomGeometry';
	import { objectFaceIds, faceLabel, planeKey, parsePlaneKey, faceOptics, withFaceOptics, faceSpans, faceNumPoints, faceSpacing } from '$lib/utils/objectFaces';
	import { formatFloat } from '$lib/utils/formatting';
	import { spacingFromNumPoints, numPointsFromSpacing } from '$lib/utils/calculations';
	import { unitAbbrev as getUnitAbbrev } from '$lib/utils/unitConversion';
	import { getReflectanceSurfaces } from '$lib/api/client';
	import ReflectancePreview3D from './ReflectancePreview3D.svelte';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// On mount, fetch the backend's actual grids for room surfaces and object
	// faces so the resolution fields show what will be calculated.
	onMount(async () => {
		try {
			const resp = await getReflectanceSurfaces();
			const roomNumPoints: Partial<SurfaceNumPointsAll> = {};
			const roomSpacings: Partial<SurfaceSpacings> = {};
			const perObject: Record<string, { num: Record<string, { x: number; y: number }>; sp: Record<string, { x: number; y: number }> }> = {};
			for (const [name, info] of Object.entries(resp.surfaces)) {
				const parsed = parsePlaneKey(name);
				if (parsed) {
					const entry = (perObject[parsed.objectId] ??= { num: {}, sp: {} });
					entry.num[parsed.faceId] = { x: info.num_x, y: info.num_y };
					entry.sp[parsed.faceId] = { x: round3(info.x_spacing), y: round3(info.y_spacing) };
				} else {
					roomNumPoints[name] = { x: info.num_x, y: info.num_y };
					roomSpacings[name] = { x: round3(info.x_spacing), y: round3(info.y_spacing) };
				}
			}
			project.updateRoom({
				reflectance_num_points: roomNumPoints as SurfaceNumPointsAll,
				reflectance_spacings: roomSpacings as SurfaceSpacings,
			});
			for (const [id, entry] of Object.entries(perObject)) {
				project.updateObjectFromBackend(id, { face_num_points: entry.num, face_spacings: entry.sp });
			}
		} catch (e) {
			// If backend fetch fails, keep using current store values
			console.warn('[ReflectanceSettingsModal] Failed to fetch surfaces from backend:', e);
		}
	});

	// Room surface list: floor, ceiling, then walls in edge order (backend naming)
	const roomSurfaces = $derived(surfaceIdsFor($room));
	const outline = $derived(roomVertices($room));
	const wallIds = $derived(wallIdsFor(outline));
	const edgeLengths = $derived(polygonEdgeLengths(outline));
	const unitAbbrev = $derived(getUnitAbbrev($userSettings.units));

	// Selection shared with the 3D preview (a room surface id or "object:face")
	let selectedSurface = $state<string | null>(null);
	let showPoints = $state(false);
	let showAdvanced = $state(false);

	// Group open state: the room open by default, obstacles collapsed
	let roomOpen = $state(true);
	let openObjects = $state<Record<string, boolean>>({});

	function round3(v: number): number {
		return Math.round(v * 1000) / 1000;
	}

	// ---- Room surfaces ----

	function roomSpans(surface: string): { x: number; y: number } {
		const r = $room;
		if (surface === 'floor' || surface === 'ceiling') return { x: r.x, y: r.y };
		const edge = wallIds.indexOf(surface);
		return { x: edge >= 0 ? edgeLengths[edge] : r.x, y: r.z };
	}

	// A wall the store hasn't seen yet (the backend echo fills these in right
	// after a shape change) falls back to guv_calcs' 10x10 default.
	const defaultPts = ROOM_DEFAULTS.reflectance_num_points;
	function roomNumPointsFor(surface: string): { x: number; y: number } {
		return $room.reflectance_num_points[surface] ?? { x: defaultPts, y: defaultPts };
	}
	function roomSpacingFor(surface: string): { x: number; y: number } {
		const existing = $room.reflectance_spacings[surface];
		if (existing) return existing;
		const spans = roomSpans(surface);
		return { x: round3(spans.x / defaultPts), y: round3(spans.y / defaultPts) };
	}
	function roomReflectanceFor(surface: string): number {
		return $room.reflectances[surface] ?? ROOM_DEFAULTS.reflectance;
	}
	function roomSurfaceTitle(surface: string): string {
		const edge = wallIds.indexOf(surface);
		if (edge < 0) return surfaceLabel(surface);
		const [x1, y1] = outline[edge];
		const [x2, y2] = outline[(edge + 1) % outline.length];
		return `${surfaceLabel(surface)}: (${formatFloat(x1, $room.precision)}, ${formatFloat(y1, $room.precision)}) → (${formatFloat(x2, $room.precision)}, ${formatFloat(y2, $room.precision)}), ${formatFloat(edgeLengths[edge], $room.precision)} ${unitAbbrev}`;
	}

	// One shared value for the group's quickset, or null when mixed
	const roomCommon = $derived.by(() => {
		const values = roomSurfaces.map(roomReflectanceFor);
		if (values.length === 0) return ROOM_DEFAULTS.reflectance;
		return values.every((v) => Math.abs(v - values[0]) < 1e-9) ? values[0] : null;
	});

	function setRoomReflectance(surface: string, value: number) {
		const newReflectances: SurfaceReflectances = { ...$room.reflectances, [surface]: value };
		project.updateRoom({ reflectances: newReflectances });
	}

	function setAllRoomReflectances(value: number) {
		project.updateRoom({ reflectances: uniformReflectances(value, $room) });
	}

	function setRoomSpacing(surface: string, axis: 'x' | 'y', value: number) {
		const spans = roomSpans(surface);
		const newSpacings: SurfaceSpacings = {
			...$room.reflectance_spacings,
			[surface]: { ...roomSpacingFor(surface), [axis]: value }
		};
		const newNumPoints: SurfaceNumPointsAll = {
			...$room.reflectance_num_points,
			[surface]: { ...roomNumPointsFor(surface), [axis]: numPointsFromSpacing(spans[axis], value) }
		};
		project.updateRoom({ reflectance_spacings: newSpacings, reflectance_num_points: newNumPoints });
	}

	function setRoomNumPoints(surface: string, axis: 'x' | 'y', value: number) {
		const spans = roomSpans(surface);
		const newNumPoints: SurfaceNumPointsAll = {
			...$room.reflectance_num_points,
			[surface]: { ...roomNumPointsFor(surface), [axis]: value }
		};
		const newSpacings: SurfaceSpacings = {
			...$room.reflectance_spacings,
			[surface]: { ...roomSpacingFor(surface), [axis]: round3(spacingFromNumPoints(spans[axis], value)) }
		};
		project.updateRoom({ reflectance_num_points: newNumPoints, reflectance_spacings: newSpacings });
	}

	// ---- Object faces ----

	function objectCommon(obj: SceneObject): { R: number | null; T: number | null } {
		const all = objectFaceIds(obj).map((f) => faceOptics(obj, f));
		const sameR = all.every((o) => Math.abs(o.R - all[0].R) < 1e-9);
		const sameT = all.every((o) => Math.abs(o.T - all[0].T) < 1e-9);
		return { R: sameR ? all[0].R : null, T: sameT ? all[0].T : null };
	}

	// Object-level R/T travel together (guv_calcs validates the pair) and
	// reset every face, so the quickset also clears the overrides.
	function setObjectReflectance(obj: SceneObject, R: number) {
		project.updateObject(obj.id, { reflectance: R, transmittance: obj.transmittance, face_properties: {} });
	}
	function setObjectTransmittance(obj: SceneObject, T: number) {
		project.updateObject(obj.id, { reflectance: obj.reflectance, transmittance: T, face_properties: {} });
	}

	function setFaceOptics(obj: SceneObject, faceId: string, optics: FaceOptics) {
		const baseline = { R: obj.reflectance, T: obj.transmittance };
		project.updateObject(obj.id, {
			face_properties: withFaceOptics(obj.face_properties, baseline, faceId, optics),
		});
	}

	function setFaceSpacing(obj: SceneObject, faceId: string, axis: 'x' | 'y', value: number) {
		const spans = faceSpans(obj, faceId);
		const sp = { ...faceSpacing(obj, faceId), [axis]: value };
		const np = { ...faceNumPoints(obj, faceId), [axis]: numPointsFromSpacing(spans[axis], value) };
		project.updateObject(obj.id, {
			face_spacings: { ...(obj.face_spacings ?? {}), [faceId]: sp },
			face_num_points: { ...(obj.face_num_points ?? {}), [faceId]: np },
		});
	}

	function setFaceNumPoints(obj: SceneObject, faceId: string, axis: 'x' | 'y', value: number) {
		const spans = faceSpans(obj, faceId);
		const np = { ...faceNumPoints(obj, faceId), [axis]: value };
		const sp = { ...faceSpacing(obj, faceId), [axis]: round3(spacingFromNumPoints(spans[axis], value)) };
		project.updateObject(obj.id, {
			face_spacings: { ...(obj.face_spacings ?? {}), [faceId]: sp },
			face_num_points: { ...(obj.face_num_points ?? {}), [faceId]: np },
		});
	}

	// ---- Advanced ----

	const spacingMode = $derived($room.reflectance_resolution_mode === 'spacing');

	function toggleResolutionMode() {
		const newMode: ReflectanceResolutionMode = spacingMode ? 'num_points' : 'spacing';
		project.updateRoom({ reflectance_resolution_mode: newMode });
	}

	function handleMaxPassesChange(value: number) {
		project.updateRoom({ reflectance_max_num_passes: value });
	}

	function handleThresholdChange(value: number) {
		project.updateRoom({ reflectance_threshold: value });
	}

	// ---- Preview selection → expand, scroll, focus ----

	let listEl = $state<HTMLDivElement | undefined>();

	async function selectFromPreview(key: string) {
		selectedSurface = key;
		const parsed = parsePlaneKey(key);
		if (parsed) openObjects = { ...openObjects, [parsed.objectId]: true };
		else roomOpen = true;
		await tick();
		const row = listEl?.querySelector<HTMLElement>(`[data-plane="${CSS.escape(key)}"]`);
		if (!row) return;
		if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
		row.querySelector<HTMLInputElement>('input')?.focus();
	}

	function toggleObject(id: string) {
		openObjects = { ...openObjects, [id]: !openObjects[id] };
	}
</script>

<Modal
	title="Reflectance Settings"
	{onClose}
	maxWidth="min(960px, 95vw)"
	titleFontSize="1rem"
>
	{#snippet body()}
		<div class="modal-body">
			<!-- Left: 3D Preview -->
			<div class="preview-column">
				<div class="canvas-container" class:dark={$theme === 'dark'}>
					<Canvas>
						<ReflectancePreview3D
							room={$room}
							numPoints={$room.reflectance_num_points}
							objects={$objects}
							{showPoints}
							{selectedSurface}
							onSelect={selectFromPreview}
						/>
					</Canvas>
				</div>
				<p class="hint canvas-hint">Click a surface to edit it. Drag to rotate, scroll to zoom.</p>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showPoints} />
					<span>Show grid points</span>
				</label>
			</div>

			<!-- Right: plane groups -->
			<div class="settings-column" bind:this={listEl}>
				<!-- Room surfaces -->
				<section class="group" class:open={roomOpen}>
					<div class="group-header">
						<button type="button" class="disclosure" onclick={() => roomOpen = !roomOpen} aria-expanded={roomOpen} aria-controls="refl-group-room">
							<span class="collapse-icon">{roomOpen ? '▼' : '▶'}</span>
							<span class="group-title">Room surfaces</span>
						</button>
						<label class="quick-field">
							<span>R</span>
							{#if roomCommon === null}
								<input type="text" inputmode="decimal" placeholder="mixed" aria-label="Room surfaces reflectance" title="Surfaces differ; type a value to apply it to all of them"
									onchange={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (isFinite(v) && v >= 0 && v <= 1) setAllRoomReflectances(v); else (e.target as HTMLInputElement).value = ''; }} />
							{:else}
								<ValidatedNumberInput value={roomCommon} precision={3} oncommit={setAllRoomReflectances} min={0} max={1} step={0.01} id="refl-room-all" />
							{/if}
						</label>
					</div>
					{#if roomOpen}
						<div class="rows" id="refl-group-room">
							<div class="row header-row" class:advanced={showAdvanced}>
								<span class="col-name">Surface</span>
								<span class="col-value">R</span>
								<span class="col-value"></span>
								{#if showAdvanced}
									<span class="col-value">{spacingMode ? 'X spacing' : 'X points'}</span>
									<span class="col-value">{spacingMode ? 'Y spacing' : 'Y points'}</span>
								{/if}
							</div>
							{#each roomSurfaces as surface (surface)}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="row"
									class:advanced={showAdvanced}
									class:highlighted={selectedSurface === surface}
									data-plane={surface}
									onmouseenter={() => selectedSurface = surface}
									onfocusin={() => selectedSurface = surface}
								>
									<span class="col-name" title={roomSurfaceTitle(surface)}>{surfaceLabel(surface)}</span>
									<ValidatedNumberInput value={roomReflectanceFor(surface)} precision={3} oncommit={(v) => setRoomReflectance(surface, v)} min={0} max={1} step={0.01} />
									<span></span>
									{#if showAdvanced}
										{#if spacingMode}
											<ValidatedNumberInput value={roomSpacingFor(surface).x} precision={$room.precision} oncommit={(v) => setRoomSpacing(surface, 'x', v)} step={0.1} validate={(v) => v > 0 && v < roomSpans(surface).x} />
											<ValidatedNumberInput value={roomSpacingFor(surface).y} precision={$room.precision} oncommit={(v) => setRoomSpacing(surface, 'y', v)} step={0.1} validate={(v) => v > 0 && v < roomSpans(surface).y} />
										{:else}
											<ValidatedNumberInput value={roomNumPointsFor(surface).x} oncommit={(v) => setRoomNumPoints(surface, 'x', v)} integer min={1} max={1000} step={1} />
											<ValidatedNumberInput value={roomNumPointsFor(surface).y} oncommit={(v) => setRoomNumPoints(surface, 'y', v)} integer min={1} max={1000} step={1} />
										{/if}
									{/if}
								</div>
								{#if showAdvanced}
									<div class="computed-row">
										{#if spacingMode}
											<span class="computed-value">{roomNumPointsFor(surface).x} x {roomNumPointsFor(surface).y} pts</span>
										{:else}
											<span class="computed-value">{formatFloat(spacingFromNumPoints(roomSpans(surface).x, roomNumPointsFor(surface).x), $room.precision)} x {formatFloat(spacingFromNumPoints(roomSpans(surface).y, roomNumPointsFor(surface).y), $room.precision)} {unitAbbrev}</span>
										{/if}
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				</section>

				<!-- One group per obstacle -->
				{#each $objects as obj (obj.id)}
					{@const common = objectCommon(obj)}
					{@const isOpen = !!openObjects[obj.id]}
					<section class="group" class:open={isOpen} class:disabled={obj.enabled === false}>
						<div class="group-header">
							<button type="button" class="disclosure" onclick={() => toggleObject(obj.id)} aria-expanded={isOpen} aria-controls="refl-group-{obj.id}">
								<span class="collapse-icon">{isOpen ? '▼' : '▶'}</span>
								<span class="group-title">{obj.name || obj.id}</span>
								{#if obj.enabled === false}<span class="muted">(disabled)</span>{/if}
							</button>
							<label class="quick-field">
								<span>R</span>
								{#if common.R === null}
									<input type="text" inputmode="decimal" placeholder="mixed" aria-label="{obj.name || obj.id} reflectance"
										onchange={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (isFinite(v) && v >= 0 && v <= 1 - obj.transmittance) setObjectReflectance(obj, v); else (e.target as HTMLInputElement).value = ''; }} />
								{:else}
									<ValidatedNumberInput value={common.R} precision={3} oncommit={(v) => setObjectReflectance(obj, v)} min={0} max={Math.max(0, 1 - obj.transmittance)} step={0.01} id="refl-obj-{obj.id}-r" />
								{/if}
							</label>
							<label class="quick-field">
								<span>T</span>
								{#if common.T === null}
									<input type="text" inputmode="decimal" placeholder="mixed" aria-label="{obj.name || obj.id} transmittance"
										onchange={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (isFinite(v) && v >= 0 && v <= 1 - obj.reflectance) setObjectTransmittance(obj, v); else (e.target as HTMLInputElement).value = ''; }} />
								{:else}
									<ValidatedNumberInput value={common.T} precision={3} oncommit={(v) => setObjectTransmittance(obj, v)} min={0} max={Math.max(0, 1 - obj.reflectance)} step={0.01} id="refl-obj-{obj.id}-t" />
								{/if}
							</label>
						</div>
						{#if isOpen}
							<div class="rows" id="refl-group-{obj.id}">
								<div class="row object-row header-row" class:advanced={showAdvanced}>
									<span class="col-name">Face</span>
									<span class="col-value">R</span>
									<span class="col-value">T</span>
									{#if showAdvanced}
										<span class="col-value">{spacingMode ? 'X spacing' : 'X points'}</span>
										<span class="col-value">{spacingMode ? 'Y spacing' : 'Y points'}</span>
									{/if}
								</div>
								{#each objectFaceIds(obj) as faceId (faceId)}
									{@const key = planeKey(obj.id, faceId)}
									{@const optics = faceOptics(obj, faceId)}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										class="row object-row"
										class:advanced={showAdvanced}
										class:highlighted={selectedSurface === key}
										data-plane={key}
										onmouseenter={() => selectedSurface = key}
										onfocusin={() => selectedSurface = key}
									>
										<span class="col-name">{faceLabel(faceId)}</span>
										<ValidatedNumberInput value={optics.R} precision={3} oncommit={(v) => setFaceOptics(obj, faceId, { R: v, T: optics.T })} min={0} max={Math.max(0, 1 - optics.T)} step={0.01} />
										<ValidatedNumberInput value={optics.T} precision={3} oncommit={(v) => setFaceOptics(obj, faceId, { R: optics.R, T: v })} min={0} max={Math.max(0, 1 - optics.R)} step={0.01} />
										{#if showAdvanced}
											{#if spacingMode}
												<ValidatedNumberInput value={faceSpacing(obj, faceId).x} precision={$room.precision} oncommit={(v) => setFaceSpacing(obj, faceId, 'x', v)} step={0.1} validate={(v) => v > 0 && v < faceSpans(obj, faceId).x} />
												<ValidatedNumberInput value={faceSpacing(obj, faceId).y} precision={$room.precision} oncommit={(v) => setFaceSpacing(obj, faceId, 'y', v)} step={0.1} validate={(v) => v > 0 && v < faceSpans(obj, faceId).y} />
											{:else}
												<ValidatedNumberInput value={faceNumPoints(obj, faceId).x} oncommit={(v) => setFaceNumPoints(obj, faceId, 'x', v)} integer min={1} max={1000} step={1} />
												<ValidatedNumberInput value={faceNumPoints(obj, faceId).y} oncommit={(v) => setFaceNumPoints(obj, faceId, 'y', v)} integer min={1} max={1000} step={1} />
											{/if}
										{/if}
									</div>
									{#if showAdvanced}
										<div class="computed-row">
											{#if spacingMode}
												<span class="computed-value">{faceNumPoints(obj, faceId).x} x {faceNumPoints(obj, faceId).y} pts</span>
											{:else}
												<span class="computed-value">{formatFloat(spacingFromNumPoints(faceSpans(obj, faceId).x, faceNumPoints(obj, faceId).x), $room.precision)} x {formatFloat(spacingFromNumPoints(faceSpans(obj, faceId).y, faceNumPoints(obj, faceId).y), $room.precision)} {unitAbbrev}</span>
											{/if}
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					</section>
				{/each}

				{#if $objects.length > 0}
					<p class="hint">R reflects, T lets light through; together at most 1. The rest is absorbed.</p>
				{/if}

				<!-- Advanced -->
				<section class="group advanced-group" class:open={showAdvanced}>
					<div class="group-header">
						<button type="button" class="disclosure" onclick={() => showAdvanced = !showAdvanced} aria-expanded={showAdvanced} aria-controls="refl-advanced">
							<span class="collapse-icon">{showAdvanced ? '▼' : '▶'}</span>
							<span class="group-title">Advanced</span>
						</button>
						{#if showAdvanced}
							<button type="button" class="mode-switch-btn" onclick={toggleResolutionMode}>
								{spacingMode ? 'Set points' : 'Set spacing'}
							</button>
						{/if}
					</div>
					{#if showAdvanced}
						<div class="rows advanced-body" id="refl-advanced">
							<p class="section-description">Each surface's grid resolution is shown in the rows above. Interreflection stops when contributions fall below threshold &times; initial value, or max iterations is reached, whichever comes first.</p>
							<div class="form-row halves">
								<div class="form-group compact">
									<label for="max_passes">Max iterations</label>
									<ValidatedNumberInput id="max_passes" value={$room.reflectance_max_num_passes} oncommit={handleMaxPassesChange} integer min={1} step={1} />
									<span class="field-hint">Maximum reflection passes</span>
								</div>
								<div class="form-group compact">
									<label for="threshold">Threshold</label>
									<ValidatedNumberInput id="threshold" value={$room.reflectance_threshold} oncommit={handleThresholdChange} min={0} max={1} step={0.01} />
									<span class="field-hint">Fraction of initial value</span>
								</div>
							</div>
						</div>
					{/if}
				</section>
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	.modal-body {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: row;
		gap: var(--spacing-md);
		overflow-y: auto;
	}

	/* Left: 3D preview */
	.preview-column {
		flex: 0 0 380px;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.canvas-container {
		width: 100%;
		height: 380px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #d0d7de;
	}

	.canvas-container.dark {
		background: #1a1a2e;
	}

	.canvas-hint {
		text-align: center;
		margin: 0;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
		margin: 0;
	}

	/* Right: groups */
	.settings-column {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		min-width: 0;
		max-height: 70vh;
		overflow-y: auto;
		padding-right: 2px;
	}

	.hint {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.muted {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-weight: 400;
	}

	.group {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-xs) var(--spacing-sm);
	}

	.group.disabled {
		opacity: 0.6;
	}

	.group-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		min-height: 30px;
	}

	.disclosure {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		padding: 0;
		color: var(--color-text);
		font-weight: 600;
		font-size: var(--font-size-base);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		text-align: left;
	}

	.group-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.collapse-icon {
		font-size: 0.7em;
		color: var(--color-text-muted);
	}

	.quick-field {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.quick-field :global(input) {
		width: 4.25rem;
		padding: 2px 6px;
		font-size: var(--font-size-sm);
		font-variant-numeric: tabular-nums;
	}

	.rows {
		display: flex;
		flex-direction: column;
		padding-top: var(--spacing-xs);
		margin-top: var(--spacing-xs);
		border-top: 1px solid var(--color-border);
	}

	.row {
		display: grid;
		grid-template-columns: 90px 1fr 1fr;
		gap: var(--spacing-xs);
		align-items: center;
		padding: 3px var(--spacing-xs);
		margin: 0 calc(-1 * var(--spacing-xs));
		border-radius: var(--radius-sm);
		transition: background 0.1s;
	}

	.row.advanced {
		grid-template-columns: 90px 1fr 1fr 1fr 1fr;
	}

	.row.highlighted {
		background: rgba(34, 211, 238, 0.08);
	}

	.header-row {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		padding-bottom: 2px;
	}

	.header-row .col-value {
		text-align: center;
	}

	.col-name {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row :global(input) {
		padding: 4px 6px;
		font-size: var(--font-size-base);
		width: 100%;
	}

	.computed-row {
		display: grid;
		grid-template-columns: 90px 1fr;
		margin-top: -2px;
		margin-bottom: var(--spacing-xs);
		padding-left: var(--spacing-xs);
	}

	.computed-row .computed-value {
		grid-column: 2;
		text-align: right;
	}

	.computed-value {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		opacity: 0.7;
	}

	.mode-switch-btn {
		padding: 2px var(--spacing-sm);
		font-size: var(--font-size-xs);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.mode-switch-btn:hover {
		background: var(--color-border);
		border-color: var(--color-text-muted);
	}

	.advanced-body {
		gap: var(--spacing-sm);
	}

	.section-description {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0;
		opacity: 0.8;
	}

	.field-hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.form-row {
		display: flex;
		gap: var(--spacing-sm);
	}

	.form-row.halves > * {
		flex: 1;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.form-group.compact {
		gap: 2px;
	}

	.form-group.compact label {
		font-size: var(--font-size-xs);
		text-transform: capitalize;
		color: var(--color-text-muted);
	}

	.form-group.compact :global(input) {
		padding: 4px 6px;
		font-size: var(--font-size-base);
		width: 100%;
	}

	/* Responsive: stack vertically on narrow viewports */
	@media (max-width: 700px) {
		.modal-body {
			flex-direction: column;
		}

		.preview-column {
			flex: none;
		}

		.canvas-container {
			height: 250px;
		}

		.settings-column {
			max-height: none;
		}
	}
</style>
