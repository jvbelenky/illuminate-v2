<script lang="ts">
	import { Canvas, T } from '@threlte/core';
	import { OrbitControls, Text } from '@threlte/extras';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig, LampInstance } from '$lib/types/project';
	import { buildIsosurfaces, getIsosurfaceColor } from '$lib/utils/isosurface';
	import { theme } from '$lib/stores/theme';
	import { lamps } from '$lib/stores/project';
	import { getSessionZoneExport } from '$lib/api/client';
	import AlertDialog from './AlertDialog.svelte';
	import Modal from './Modal.svelte';
	import BillboardGroup from './BillboardGroup.svelte';
	import RoomAxes from './RoomAxes.svelte';
	import ViewSnapOverlay, { type ViewPreset } from './ViewSnapOverlay.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';

	interface Props {
		zone: CalcZone;
		zoneName: string;
		room: RoomConfig;
		values: number[][][];
		valueFactor?: number;
		onclose: () => void;
	}

	let { zone, zoneName, room, values, valueFactor = 1, onclose }: Props = $props();

	// Export state
	let exporting = $state(false);
	let savingPlot = $state(false);
	let alertDialog = $state<{ title: string; message: string } | null>(null);

	// Axes, tick marks, tick labels toggles
	let showAxes = $state(true);
	let showTickMarks = $state(true);
	let showTickLabels = $state(true);

	// Lamp labels toggle
	let showLampLabels = $state(false);

	// XYZ axes marker toggle
	let showXYZMarker = $state(true);

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
			// Perspective → Ortho: size frustum to fit the zone bounds with padding
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
	{@const isosurfaces = buildIsosurfaces(values, bounds, scale, colormap, 3)}
	{@const opacityLevels = [0.35, 0.25, 0.2]}

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
		{@const color = getIsosurfaceColor(iso.normalizedLevel, colormap)}
		{@const opacity = opacityLevels[index] ?? 0.2}
		<T.Mesh geometry={iso.geometry}>
			<T.MeshBasicMaterial
				color={new THREE.Color(color.r, color.g, color.b)}
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
				<button
					class="proj-toggle"
					title={useOrtho ? 'Switch to perspective projection' : 'Switch to orthographic projection'}
					onclick={toggleProjection}
				>
					<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
						{#if useOrtho}
							<!-- Ortho icon: cube with parallel edges, no foreshortening -->
							<!-- Front face -->
							<path d="M7 14 L7 28 L21 28 L21 14 Z" />
							<!-- Top face -->
							<path d="M7 14 L17 8 L31 8 L21 14 Z" />
							<!-- Right face -->
							<path d="M21 14 L31 8 L31 22 L21 28 Z" />
							<!-- Back hidden edges -->
							<line x1="7" y1="14" x2="17" y2="8" stroke-dasharray="2 2" opacity="0.4" />
							<line x1="17" y1="8" x2="17" y2="22" stroke-dasharray="2 2" opacity="0.4" />
							<line x1="17" y1="22" x2="7" y2="28" stroke-dasharray="2 2" opacity="0.4" />
						{:else}
							<!-- Perspective icon: cube with converging edges (back face much smaller) -->
							<!-- Front face (large) -->
							<path d="M3 11 L3 29 L21 29 L21 11 Z" />
							<!-- Back face (small, shifted right and up) -->
							<path d="M19 7 L19 17 L29 17 L29 7 Z" opacity="0.6" />
							<!-- Connecting edges (converging) -->
							<line x1="3" y1="11" x2="19" y2="7" />
							<line x1="21" y1="11" x2="29" y2="7" />
							<line x1="21" y1="29" x2="29" y2="17" />
							<line x1="3" y1="29" x2="19" y2="17" stroke-dasharray="2 2" opacity="0.4" />
						{/if}
					</svg>
				</button>
				<Canvas>
					{@render IsosurfaceScene(showAxes, showTickMarks, showTickLabels, showLampLabels, showXYZMarker)}
				</Canvas>
			</div>
			<p class="hint">Drag to rotate, scroll to zoom</p>
		</div>
	{/snippet}
	{#snippet footer()}
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

	.proj-toggle {
		position: absolute;
		bottom: var(--spacing-sm);
		left: calc(var(--spacing-sm) + 74px);
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 72px;
		height: 72px;
		padding: 14px;
		background: color-mix(in srgb, var(--color-bg-secondary) 85%, transparent);
		backdrop-filter: blur(4px);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.proj-toggle:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-accent);
		color: var(--color-text);
	}

	.proj-toggle svg {
		width: 100%;
		height: 100%;
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
</style>
