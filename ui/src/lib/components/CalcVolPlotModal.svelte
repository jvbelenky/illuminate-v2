<script lang="ts">
	import { Canvas, T } from '@threlte/core';
	import { OrbitControls, Text } from '@threlte/extras';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig, LampInstance } from '$lib/types/project';
	import { buildIsosurfaces, calculateIsoLevels } from '$lib/utils/isosurface';
	import { valueToColor } from '$lib/utils/colormaps';
	import { theme } from '$lib/stores/theme';
	import { lamps } from '$lib/stores/project';
	import { getSessionZoneExport } from '$lib/api/client';
	import AlertDialog from './AlertDialog.svelte';
	import Modal from './Modal.svelte';
	import BillboardGroup from './BillboardGroup.svelte';
	import RoomAxes from './RoomAxes.svelte';
	import ViewSnapOverlay, { type ViewPreset } from './ViewSnapOverlay.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';
	import ProjectionToggle from './ProjectionToggle.svelte';

	export interface IsoSettings {
		surfaceCount: number;
		customLevels: number[] | null;
		customColors: (string | null)[];
	}

	interface Props {
		zone: CalcZone;
		zoneName: string;
		room: RoomConfig;
		values: number[][][];
		valueFactor?: number;
		isoSettings?: IsoSettings;
		onIsoSettingsChange?: (settings: IsoSettings) => void;
		onclose: () => void;
	}

	let { zone, zoneName, room, values, valueFactor = 1, isoSettings, onIsoSettingsChange, onclose }: Props = $props();

	// Export state
	let exporting = $state(false);
	let savingPlot = $state(false);
	let alertDialog = $state<{ title: string; message: string } | null>(null);

	// Axes, tick marks, tick labels toggles
	let showAxes = $state(false);
	let showTickMarks = $state(true);
	let showTickLabels = $state(true);

	// Lamp labels toggle
	let showLampLabels = $state(false);

	// XYZ axes marker toggle
	let showXYZMarker = $state(false);

	// Iso level controls (initialized from persisted settings if available)
	let surfaceCount = $state(isoSettings?.surfaceCount ?? 3);
	const MAX_SURFACES = 5;
	const autoLevels = $derived(calculateIsoLevels(values, surfaceCount));
	let customLevels = $state<number[] | null>(isoSettings?.customLevels ?? null);
	const activeLevels = $derived(customLevels ?? autoLevels);
	const displayUnit = $derived(zone.dose ? 'mJ/cm\u00B2' : '\u00B5W/cm\u00B2');

	// Cached value range for color normalization
	const valueRange = $derived.by(() => {
		let minVal = Infinity, maxVal = -Infinity;
		for (const plane of values) {
			for (const row of plane) {
				for (const val of row) {
					if (isFinite(val)) {
						if (val < minVal) minVal = val;
						if (val > maxVal) maxVal = val;
					}
				}
			}
		}
		return { min: minVal, max: maxVal, range: (maxVal - minVal) || 1 };
	});

	// Per-surface color overrides (null = use colormap default)
	let customColors = $state<(string | null)[]>(isoSettings?.customColors ?? []);

	function colormapHex(level: number): string {
		// Normalize against data range so colors stay stable when levels change
		const dataMin = valueRange.min > 0 ? valueRange.min : 1;
		const dataMax = valueRange.max > 0 ? valueRange.max : 10;
		const logMin = Math.log10(dataMin);
		const logMax = Math.log10(dataMax);
		const logRange = logMax - logMin || 1;
		const normalized = (level > 0) ? Math.max(0, Math.min(1, (Math.log10(level) - logMin) / logRange)) : 0;
		const colormap = room.colormap || 'plasma';
		const c = valueToColor(normalized, colormap);
		const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
		const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
		const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
		return `#${r}${g}${b}`;
	}

	// Resolved colors: custom override or colormap-derived
	const activeColors = $derived(
		activeLevels.map((level, i) => customColors[i] ?? colormapHex(level))
	);

	function emitSettings() {
		onIsoSettingsChange?.({ surfaceCount, customLevels, customColors });
	}

	function resetToAutoLevels() {
		customLevels = null;
		customColors = [];
		surfaceCount = 3;
		emitSettings();
	}

	function addSurface() {
		if (surfaceCount >= MAX_SURFACES) return;
		const prevLevels = [...activeLevels];
		const prevColors = activeColors.map(c => c);
		// Add new level above the current highest
		const highest = prevLevels[prevLevels.length - 1];
		const dataMax = valueRange.max;
		let newLevel: number;
		if (highest < dataMax) {
			newLevel = (highest + dataMax) / 2;
		} else {
			// Already at or above data max — add a small increment above
			const span = prevLevels.length >= 2
				? prevLevels[prevLevels.length - 1] - prevLevels[0]
				: highest;
			newLevel = highest + (span * 0.25 || highest * 0.1);
		}
		prevLevels.push(newLevel);
		// Pick a color that's distinct from existing ones
		const newColor = pickDistinctColor(prevColors);
		prevColors.push(newColor);
		surfaceCount = prevLevels.length;
		customLevels = prevLevels;
		customColors = prevColors;
		emitSettings();
	}

	// Pick a color visually distinct from existing colors
	const DISTINCT_PALETTE = [
		'#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
		'#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
	];
	function pickDistinctColor(existing: string[]): string {
		const used = new Set(existing.map(c => c.toLowerCase()));
		for (const c of DISTINCT_PALETTE) {
			if (!used.has(c)) return c;
		}
		return DISTINCT_PALETTE[existing.length % DISTINCT_PALETTE.length];
	}

	function removeSurface() {
		if (surfaceCount <= 1) return;
		const prevLevels = [...activeLevels];
		const prevColors = activeColors.map(c => c);
		// Remove the middle level (least likely to be an endpoint the user cares about)
		const removeIdx = Math.floor(prevLevels.length / 2);
		prevLevels.splice(removeIdx, 1);
		prevColors.splice(removeIdx, 1);
		surfaceCount = prevLevels.length;
		customLevels = prevLevels;
		customColors = prevColors;
		emitSettings();
	}

	function updateLevel(index: number, displayValue: number) {
		const rawValue = displayValue / valueFactor;
		const newLevels = [...activeLevels];
		// Lock in current colors so they don't shift along the colormap
		const newColors = activeColors.map(c => c);
		newLevels[index] = rawValue;
		// Sort levels and colors together so colors follow their levels
		const paired = newLevels.map((l, i) => ({ level: l, color: newColors[i] }));
		paired.sort((a, b) => a.level - b.level);
		customLevels = paired.map(p => p.level);
		customColors = paired.map(p => p.color);
		emitSettings();
	}

	function updateColor(index: number, hex: string) {
		const newColors = [...customColors];
		while (newColors.length < activeLevels.length) newColors.push(null);
		newColors[index] = hex;
		customColors = newColors;
		emitSettings();
	}

	// Canvas container ref for saving plot
	let canvasContainer: HTMLDivElement;

	// Projection mode (perspective vs orthographic)
	let useOrtho = $state(false);
	let orthoHalfHeight = $state(5);
	let orthoHalfWidth = $state(7.5);
	let savedCameraPos = $state<[number, number, number] | null>(null);
	let savedTarget = $state<[number, number, number] | null>(null);

	// View snap state
	let cameraRef = $state<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null);
	let controlsRef = $state<any>(null);
	let activeView = $state<ViewPreset | null>(null);
	let animationId: number | null = null;
	const ANIMATION_DURATION = 400;

	function cancelAnimation() {
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
			animationId = null;
			if (controlsRef) controlsRef.enabled = true;
		}
	}

	// Cancel any running animation on unmount
	$effect(() => {
		return () => { cancelAnimation(); };
	});

	function shortestAngleDelta(from: number, to: number): number {
		let delta = to - from;
		if (delta > Math.PI) delta -= 2 * Math.PI;
		if (delta < -Math.PI) delta += 2 * Math.PI;
		return delta;
	}

	function handleViewChange(view: ViewPreset) {
		if (!cameraRef || !controlsRef) return;
		activeView = view;
		cancelAnimation();

		const s = room.units === 'feet' ? 0.3048 : 1;
		const b = {
			x1: zone.x_min ?? 0, x2: zone.x_max ?? room.x,
			y1: zone.y_min ?? 0, y2: zone.y_max ?? room.y,
			z1: zone.z_min ?? 0, z2: zone.z_max ?? room.z
		};
		const cx = ((b.x1 + b.x2) / 2) * s;
		const cy = ((b.z1 + b.z2) / 2) * s;
		const cz = -((b.y1 + b.y2) / 2) * s;
		const maxD = Math.max((b.x2 - b.x1) * s, (b.y2 - b.y1) * s, (b.z2 - b.z1) * s);
		const dist = maxD * 1.8;
		const isoDist = dist * 0.7;
		const isoHeight = dist * 0.6;

		const endTarget = new THREE.Vector3(cx, cy, cz);
		const startTarget = controlsRef.target.clone();

		let endPos: THREE.Vector3;
		switch (view) {
			case 'front': endPos = new THREE.Vector3(cx, cy, cz + dist); break;
			case 'back': endPos = new THREE.Vector3(cx, cy, cz - dist); break;
			case 'left': endPos = new THREE.Vector3(cx - dist, cy, cz); break;
			case 'right': endPos = new THREE.Vector3(cx + dist, cy, cz); break;
			case 'iso-front-left': endPos = new THREE.Vector3(cx - isoDist, cy + isoHeight, cz + isoDist); break;
			case 'iso-front-right': endPos = new THREE.Vector3(cx + isoDist, cy + isoHeight, cz + isoDist); break;
			case 'iso-back-left': endPos = new THREE.Vector3(cx - isoDist, cy + isoHeight, cz - isoDist); break;
			case 'iso-back-right': endPos = new THREE.Vector3(cx + isoDist, cy + isoHeight, cz - isoDist); break;
			case 'top': endPos = new THREE.Vector3(cx, cy + dist * 1.2, cz + 0.001); break;
			default: return;
		}

		const startOffset = cameraRef.position.clone().sub(startTarget);
		const startSph = new THREE.Spherical().setFromVector3(startOffset);
		const endOffset = endPos.clone().sub(endTarget);
		const endSph = new THREE.Spherical().setFromVector3(endOffset);

		const POLE_THRESHOLD = 0.05;
		if (endSph.phi < POLE_THRESHOLD) endSph.theta = startSph.theta;
		if (startSph.phi < POLE_THRESHOLD) startSph.theta = endSph.theta;

		const dTheta = shortestAngleDelta(startSph.theta, endSph.theta);
		const startTime = performance.now();

		const nearPole = startSph.phi < POLE_THRESHOLD || endSph.phi < POLE_THRESHOLD;
		const startPos = nearPole ? cameraRef.position.clone() : null;
		const endPosCart = nearPole ? endPos.clone() : null;

		controlsRef.enabled = false;

		function animate(now: number) {
			const elapsed = now - startTime;
			const t = Math.min(elapsed / ANIMATION_DURATION, 1);
			const currentTarget = new THREE.Vector3().lerpVectors(startTarget, endTarget, t);

			if (nearPole) {
				cameraRef!.position.lerpVectors(startPos!, endPosCart!, t);
			} else {
				const r = startSph.radius + (endSph.radius - startSph.radius) * t;
				const phi = startSph.phi + (endSph.phi - startSph.phi) * t;
				const theta = startSph.theta + dTheta * t;
				const offset = new THREE.Vector3().setFromSpherical(new THREE.Spherical(r, phi, theta));
				cameraRef!.position.copy(currentTarget).add(offset);
			}

			cameraRef!.lookAt(currentTarget);

			if (t < 1) {
				animationId = requestAnimationFrame(animate);
			} else {
				controlsRef!.target.copy(endTarget);
				controlsRef!.update();
				controlsRef!.enabled = true;
				animationId = null;
			}
		}

		animationId = requestAnimationFrame(animate);
	}

	function handleUserOrbit() {
		cancelAnimation();
		activeView = null;
	}

	function toggleProjection() {
		if (!cameraRef || !controlsRef) return;
		cancelAnimation();
		activeView = null;

		const pos = cameraRef.position;
		const tgt = controlsRef.target;
		savedCameraPos = [pos.x, pos.y, pos.z];
		savedTarget = [tgt.x, tgt.y, tgt.z];

		if (!useOrtho) {
			// Perspective → Ortho: size to zone bounds
			const s = room.units === 'feet' ? 0.3048 : 1;
			const zoneSize = Math.max(
				((zone.x_max ?? room.x) - (zone.x_min ?? 0)) * s,
				((zone.y_max ?? room.y) - (zone.y_min ?? 0)) * s,
				((zone.z_max ?? room.z) - (zone.z_min ?? 0)) * s
			);
			const aspect = canvasContainer ? canvasContainer.clientWidth / canvasContainer.clientHeight : 1.5;
			orthoHalfHeight = zoneSize * 0.75;
			orthoHalfWidth = orthoHalfHeight * aspect;
		}

		useOrtho = !useOrtho;
	}

	async function exportCSV() {
		exporting = true;
		try {
			const blob = await getSessionZoneExport(zone.id);
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
			exporting = false;
		}
	}

	async function savePlot() {
		savingPlot = true;
		try {
			// Find the canvas element inside the container
			const canvas = canvasContainer?.querySelector('canvas');
			if (!canvas) {
				throw new Error('Canvas not found');
			}

			// Create a high-res version by rendering to a larger canvas
			const scaleFactor = 2; // 2x resolution
			const width = canvas.width * scaleFactor;
			const height = canvas.height * scaleFactor;

			// Create an offscreen canvas
			const offscreen = document.createElement('canvas');
			offscreen.width = width;
			offscreen.height = height;
			const ctx = offscreen.getContext('2d');
			if (!ctx) throw new Error('Could not get 2d context');

			// Draw the WebGL canvas scaled up
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'high';
			ctx.drawImage(canvas, 0, 0, width, height);

			// Convert to blob and download
			offscreen.toBlob((blob) => {
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `${zoneName}.png`;
				a.click();
				URL.revokeObjectURL(url);
			}, 'image/png');
		} catch (error) {
			console.error('Failed to save plot:', error);
			alertDialog = { title: 'Save Failed', message: 'Failed to save plot. Please try again.' };
		} finally {
			savingPlot = false;
		}
	}

	// Generate "nice" tick values for an axis range
	function generateTicks(min: number, max: number): number[] {
		const niceSteps = [1, 2, 2.5, 5, 10];
		const range = max - min;
		const rawStep = range / 5;
		const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
		const normalized = rawStep / magnitude;
		const niceNorm = niceSteps.find(s => s >= normalized) ?? 10;
		const step = niceNorm * magnitude;

		const ticks: number[] = [];
		const start = Math.ceil(min / step) * step;
		for (let v = start; v <= max + step * 0.01; v += step) {
			ticks.push(Math.round(v * 1e6) / 1e6);
		}
		return ticks;
	}

	// Build a single LineSegments geometry for axis lines + tick marks on all 3 axes
	function buildTickGeometry(
		bounds: { x1: number; x2: number; y1: number; y2: number; z1: number; z2: number },
		scale: number,
		tickSize: number,
		xTicks: number[],
		yTicks: number[],
		zTicks: number[]
	): THREE.BufferGeometry {
		const positions: number[] = [];

		// X axis line (bottom-front edge, flush with bounding box)
		positions.push(
			bounds.x1 * scale, bounds.z1 * scale, -bounds.y1 * scale,
			bounds.x2 * scale, bounds.z1 * scale, -bounds.y1 * scale
		);
		// X tick marks (extend outward from axis line)
		for (const tick of xTicks) {
			const xPos = tick * scale;
			positions.push(
				xPos, bounds.z1 * scale, -bounds.y1 * scale,
				xPos, bounds.z1 * scale - tickSize, -bounds.y1 * scale
			);
		}

		// Y axis line (bottom-left edge, flush with bounding box, runs along Three.js -Z)
		positions.push(
			bounds.x1 * scale, bounds.z1 * scale, -bounds.y1 * scale,
			bounds.x1 * scale, bounds.z1 * scale, -bounds.y2 * scale
		);
		// Y tick marks (extend outward from axis line)
		for (const tick of yTicks) {
			const zPos = tick * scale;
			positions.push(
				bounds.x1 * scale, bounds.z1 * scale, -zPos,
				bounds.x1 * scale - tickSize, bounds.z1 * scale, -zPos
			);
		}

		// Z axis line (front-left vertical edge, flush with bounding box, runs along Three.js +Y)
		positions.push(
			bounds.x1 * scale, bounds.z1 * scale, -bounds.y1 * scale,
			bounds.x1 * scale, bounds.z2 * scale, -bounds.y1 * scale
		);
		// Z tick marks (extend outward from axis line)
		for (const tick of zTicks) {
			const yPos = tick * scale;
			positions.push(
				bounds.x1 * scale, yPos, -bounds.y1 * scale,
				bounds.x1 * scale - tickSize, yPos, -bounds.y1 * scale
			);
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		return geometry;
	}

	// Format tick value to match room's configured precision
	function formatTick(value: number): string {
		return value.toFixed(room.precision);
	}

	// Enabled lamp positions for 3D rendering
	const enabledLamps = $derived.by((): LampInstance[] => {
		if (!showLampLabels) return [];
		const lampList: LampInstance[] = $lamps;
		return lampList?.filter(l => l.enabled) ?? [];
	});
</script>

<!-- Isosurface Scene Component - must be inside Canvas -->
{#snippet IsosurfaceScene(axisLabelsVisible: boolean, tickMarksVisible: boolean, tickLabelsVisible: boolean, lampLabelsVisible: boolean, xyzMarkerVisible: boolean)}
	{@const colormap = room.colormap || 'plasma'}
	{@const scale = room.units === 'feet' ? 0.3048 : 1}
	{@const units = room.units === 'feet' ? 'ft' : 'm'}
	{@const bounds = {
		x1: zone.x_min ?? 0,
		x2: zone.x_max ?? room.x,
		y1: zone.y_min ?? 0,
		y2: zone.y_max ?? room.y,
		z1: zone.z_min ?? 0,
		z2: zone.z_max ?? room.z
	}}
	{@const isosurfaces = buildIsosurfaces(values, bounds, scale, colormap, surfaceCount, customLevels ?? undefined)}
	{@const opacityLevels = [0.35, 0.3, 0.25, 0.2, 0.15]}

	{@const centerX = ((bounds.x1 + bounds.x2) / 2) * scale}
	{@const centerY = ((bounds.z1 + bounds.z2) / 2) * scale}
	{@const centerZ = -((bounds.y1 + bounds.y2) / 2) * scale}
	{@const maxDim = Math.max(
		(bounds.x2 - bounds.x1) * scale,
		(bounds.y2 - bounds.y1) * scale,
		(bounds.z2 - bounds.z1) * scale
	)}
	{@const cameraDistance = maxDim * 1.8}

	<!-- Text styling -->
	{@const textColor = $theme === 'dark' ? '#cccccc' : '#333333'}
	{@const axisColor = $theme === 'dark' ? '#888888' : '#666666'}
	{@const fontSize = maxDim * 0.06}
	{@const tickSize = maxDim * 0.02}

	<!-- Camera with orbit controls -->
	{@const defaultCamPos = [centerX + cameraDistance, centerY + cameraDistance * 0.6, centerZ + cameraDistance] as [number, number, number]}
	{@const defaultTarget = [centerX, centerY, centerZ] as [number, number, number]}
	{#if useOrtho}
		<T.OrthographicCamera
			makeDefault
			manual
			args={[-orthoHalfWidth, orthoHalfWidth, orthoHalfHeight, -orthoHalfHeight, 0.1, cameraDistance * 20]}
			position={savedCameraPos ?? defaultCamPos}
			bind:ref={cameraRef}
		>
			<OrbitControls
				bind:ref={controlsRef}
				enableDamping
				dampingFactor={0.1}
				target={savedTarget ?? defaultTarget}
				onstart={handleUserOrbit}
			/>
		</T.OrthographicCamera>
	{:else}
		<T.PerspectiveCamera
			makeDefault
			position={savedCameraPos ?? defaultCamPos}
			fov={50}
			bind:ref={cameraRef}
		>
			<OrbitControls
				bind:ref={controlsRef}
				enableDamping
				dampingFactor={0.1}
				target={savedTarget ?? defaultTarget}
				onstart={handleUserOrbit}
			/>
		</T.PerspectiveCamera>
	{/if}

	<!-- Lighting -->
	<T.AmbientLight intensity={0.5} />
	<T.DirectionalLight position={[10, 20, 10]} intensity={0.7} />
	<T.DirectionalLight position={[-10, 10, -10]} intensity={0.3} />

	<!-- Isosurface shells -->
	{#each isosurfaces as iso, index}
		{@const opacity = opacityLevels[index] ?? 0.2}
		<T.Mesh geometry={iso.geometry}>
			<T.MeshBasicMaterial
				color={activeColors[index]}
				transparent
				opacity={opacity}
				side={THREE.DoubleSide}
				depthWrite={false}
			/>
		</T.Mesh>
	{/each}

	<!-- Bounding box wireframe -->
	{@const boxWidth = (bounds.x2 - bounds.x1) * scale}
	{@const boxHeight = (bounds.z2 - bounds.z1) * scale}
	{@const boxDepth = (bounds.y2 - bounds.y1) * scale}
	<T.LineSegments position={[centerX, centerY, centerZ]}>
		<T.EdgesGeometry args={[new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth)]} />
		<T.LineBasicMaterial color="#666666" opacity={0.5} transparent />
	</T.LineSegments>

	<!-- Axes viewfinder -->
	{#if xyzMarkerVisible}
		<RoomAxes />
	{/if}

	<!-- Axes and tick marks (batched into one LineSegments draw call) -->
	{@const xTicks = generateTicks(bounds.x1, bounds.x2)}
	{@const yTicks = generateTicks(bounds.y1, bounds.y2)}
	{@const zTicks = generateTicks(bounds.z1, bounds.z2)}

	{#if tickMarksVisible}
		{@const tickGeometry = buildTickGeometry(bounds, scale, tickSize, xTicks, yTicks, zTicks)}
		<T.LineSegments geometry={tickGeometry}>
			<T.LineBasicMaterial color={axisColor} />
		</T.LineSegments>
	{/if}

	<!-- Lamp markers: spheres + aim lines (always shown when toggle is on, regardless of bounding box) -->
	{#if lampLabelsVisible}
		{#each enabledLamps as lamp}
			{@const lx = lamp.x * scale}
			{@const ly = lamp.z * scale}
			{@const lz = -lamp.y * scale}
			{@const ax = lamp.aimx * scale}
			{@const ay = lamp.aimz * scale}
			{@const az = -lamp.aimy * scale}
			<!-- Lamp point -->
			<T.Mesh position={[lx, ly, lz]}>
				<T.SphereGeometry args={[maxDim * 0.015, 8, 8]} />
				<T.MeshBasicMaterial color="#3b82f6" />
			</T.Mesh>
			<!-- Aim line (dashed) -->
			<T.Group position={[lx, ly, lz]}>
				<T.LineSegments
					oncreate={(ref) => { ref.computeLineDistances(); }}
				>
					<T.BufferGeometry>
						<T.BufferAttribute
							attach="attributes-position"
							args={[new Float32Array([0, 0, 0, ax - lx, ay - ly, az - lz]), 3]}
						/>
					</T.BufferGeometry>
					<T.LineDashedMaterial color="#3b82f6" dashSize={0.1} gapSize={0.06} transparent opacity={0.5} />
				</T.LineSegments>
			</T.Group>
		{/each}
	{/if}

	<!-- All text labels (billboarded - always face camera) -->
	<BillboardGroup>
		<!-- Lamp labels -->
		{#if lampLabelsVisible}
			{#each enabledLamps as lamp}
				{@const lx = lamp.x * scale}
				{@const ly = lamp.z * scale}
				{@const lz = -lamp.y * scale}
				<Text
					text={lamp.name || lamp.id}
					fontSize={fontSize * 0.6}
					color="#ffffff"
					outlineColor="#000000"
					outlineWidth={fontSize * 0.06}
					position={[lx, ly + maxDim * 0.03, lz]}
					anchorX="center"
					anchorY="bottom"
				/>
			{/each}
		{/if}

		<!-- Axis labels -->
		{#if axisLabelsVisible}
			<Text
				text={`X (${units})`}
				fontSize={fontSize}
				color={textColor}
				position={[centerX, bounds.z1 * scale - tickSize * 4, -bounds.y1 * scale + tickSize]}
				anchorX="center"
				anchorY="middle"
			/>
			<Text
				text={`Y (${units})`}
				fontSize={fontSize}
				color={textColor}
				position={[bounds.x1 * scale - tickSize * 4, bounds.z1 * scale - tickSize, centerZ]}
				anchorX="center"
				anchorY="middle"
			/>
			<Text
				text={`Z (${units})`}
				fontSize={fontSize}
				color={textColor}
				position={[bounds.x1 * scale - tickSize * 4, centerY, -bounds.y1 * scale + tickSize]}
				anchorX="center"
				anchorY="middle"
			/>
		{/if}

		<!-- Tick labels -->
		{#if tickLabelsVisible}
			{#each xTicks as tick}
				<Text
					text={formatTick(tick)}
					fontSize={fontSize * 0.7}
					color={textColor}
					position={[tick * scale, bounds.z1 * scale - tickSize * 3, -bounds.y1 * scale]}
					anchorX="center"
					anchorY="middle"
				/>
			{/each}
			{#each yTicks as tick}
				<Text
					text={formatTick(tick)}
					fontSize={fontSize * 0.7}
					color={textColor}
					position={[bounds.x1 * scale - tickSize * 3, bounds.z1 * scale - tickSize, -tick * scale]}
					anchorX="center"
					anchorY="middle"
				/>
			{/each}
			{#each zTicks as tick}
				<Text
					text={formatTick(tick)}
					fontSize={fontSize * 0.7}
					color={textColor}
					position={[bounds.x1 * scale - tickSize * 3, tick * scale, -bounds.y1 * scale + tickSize]}
					anchorX="center"
					anchorY="middle"
				/>
			{/each}
		{/if}
	</BillboardGroup>
{/snippet}

<Modal title={zoneName} onClose={onclose} maxWidth="min(800px, 95vw)" maxHeight="95vh" titleFontSize="1rem">
	{#snippet headerExtra()}
		<span class="volume-badge">3D Volume</span>
	{/snippet}
	{#snippet body()}
		<div class="modal-body">
			<div class="canvas-container" class:dark={$theme === 'dark'} bind:this={canvasContainer}>
				<ViewSnapOverlay onViewChange={handleViewChange} {activeView} />
				<ProjectionToggle isOrtho={useOrtho} onclick={toggleProjection} />
				<Canvas>
					{@render IsosurfaceScene(showAxes, showTickMarks, showTickLabels, showLampLabels, showXYZMarker)}
				</Canvas>
			</div>
			<p class="hint">Drag to rotate, scroll to zoom</p>
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="iso-legend">
			<div class="iso-legend-header">
				<span class="iso-legend-title">Iso Levels ({displayUnit})</span>
				<div class="iso-count-controls">
					<button class="iso-count-btn" onclick={removeSurface} disabled={surfaceCount <= 1} title="Remove level">&minus;</button>
					<span class="iso-count">{surfaceCount}</span>
					<button class="iso-count-btn" onclick={addSurface} disabled={surfaceCount >= MAX_SURFACES} title="Add level">+</button>
					{#if customLevels || customColors.some(c => c != null)}
						<button class="iso-reset-btn" onclick={resetToAutoLevels} title="Reset to auto">Auto</button>
					{/if}
				</div>
			</div>
			<div class="iso-level-list">
				{#each activeLevels as level, i}
					<div class="iso-level-item">
						<input
							type="color"
							class="iso-color-picker"
							value={activeColors[i]}
							oninput={(e) => updateColor(i, e.currentTarget.value)}
							title="Click to change color"
						/>
						<input
							class="iso-level-input"
							type="number"
							step="any"
							value={parseFloat((level * valueFactor).toPrecision(4))}
							onchange={(e) => {
								const val = parseFloat(e.currentTarget.value);
								if (isFinite(val) && val > 0) updateLevel(i, val);
							}}
						/>
					</div>
				{/each}
			</div>
		</div>
		<div class="modal-footer">
			<div class="footer-controls">
				<span class="show-prefix">Show:</span>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showTickMarks} use:enterToggle />
					<span>Tick marks</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showTickLabels} use:enterToggle />
					<span>Tick labels</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showAxes} use:enterToggle />
					<span>Axis labels</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showLampLabels} use:enterToggle />
					<span>Lamp positions</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showXYZMarker} use:enterToggle />
					<span>XYZ marker</span>
				</label>
			</div>
			<div class="footer-buttons">
				<button class="export-btn" onclick={savePlot} disabled={savingPlot}>
					{savingPlot ? 'Saving...' : 'Save Plot'}
				</button>
				<button class="export-btn" onclick={exportCSV} disabled={exporting}>
					{exporting ? 'Exporting...' : 'Export CSV'}
				</button>
			</div>
		</div>
	{/snippet}
</Modal>

{#if alertDialog}
	<AlertDialog
		title={alertDialog.title}
		message={alertDialog.message}
		onDismiss={() => alertDialog = null}
	/>
{/if}

<style>
	.volume-badge {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--color-bg-tertiary);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
	}

	.modal-body {
		padding: var(--spacing-sm);
		display: flex;
		flex-direction: column;
		align-items: center;
		min-height: 0;
		flex: 1;
	}

	.canvas-container {
		width: 100%;
		height: 500px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #d0d7de;
		position: relative;
	}

	.canvas-container.dark {
		background: #1a1a2e;
	}

	.hint {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin: var(--spacing-xs) 0 0 0;
		text-align: center;
	}

	.modal-footer {
		padding: var(--spacing-xs) var(--spacing-md);
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-shrink: 0;
		gap: var(--spacing-sm);
	}

	.footer-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.show-prefix {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 0.75rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
		margin: 0;
	}

	.export-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.75rem;
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
	}

	.export-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.export-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.footer-buttons {
		display: flex;
		gap: var(--spacing-sm);
		flex-shrink: 0;
	}

	.iso-legend {
		padding: var(--spacing-xs) var(--spacing-md);
		border-top: 1px solid var(--color-border);
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		flex-shrink: 0;
	}

	.iso-legend-header {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex-shrink: 0;
	}

	.iso-legend-title {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-weight: 500;
		white-space: nowrap;
	}

	.iso-count-controls {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.iso-count-btn {
		width: 20px;
		height: 20px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		font-size: 0.8rem;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.iso-count-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.iso-count-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.iso-count {
		font-size: 0.7rem;
		color: var(--color-text);
		min-width: 12px;
		text-align: center;
	}

	.iso-reset-btn {
		font-size: 0.6rem;
		padding: 1px 5px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		cursor: pointer;
		margin-left: 2px;
	}

	.iso-reset-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.iso-level-list {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.iso-level-item {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.iso-color-picker {
		width: 22px;
		height: 22px;
		padding: 1px;
		border: 1px solid var(--color-border);
		border-radius: 3px;
		background: none;
		cursor: pointer;
		flex-shrink: 0;
	}

	.iso-color-picker::-webkit-color-swatch-wrapper {
		padding: 1px;
	}

	.iso-color-picker::-webkit-color-swatch {
		border: none;
		border-radius: 2px;
	}

	.iso-color-picker::-moz-color-swatch {
		border: none;
		border-radius: 2px;
	}

	.iso-level-input {
		width: 70px;
		padding: 2px 4px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.7rem;
		text-align: right;
	}

	.iso-level-input:focus {
		outline: none;
		border-color: var(--color-primary, #3b82f6);
	}
</style>
