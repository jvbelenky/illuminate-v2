<script lang="ts">
	import { Canvas, T } from '@threlte/core';
	import { OrbitControls, Text } from '@threlte/extras';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig, LampInstance } from '$lib/types/project';
	import { theme } from '$lib/stores/theme';
	import { lamps } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { unitAbbrev } from '$lib/utils/unitConversion';
	import { getSessionZoneExport } from '$lib/api/client';
	import AlertDialog from './AlertDialog.svelte';
	import Modal from './Modal.svelte';
	import BillboardGroup from './BillboardGroup.svelte';
	import RoomAxes from './RoomAxes.svelte';
	import ViewSnapOverlay, { type ViewPreset } from './ViewSnapOverlay.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';
	import ProjectionToggle from './ProjectionToggle.svelte';
	import { unitLabel } from '$lib/utils/unitConversion';

	interface Props {
		zone: CalcZone;
		zoneName: string;
		room: RoomConfig;
		value: number;
		valueUnits: string;
		valueFactor?: number;
		onclose: () => void;
		dockId?: string;
	}

	let { zone, zoneName, room, value, valueUnits, valueFactor = 1, onclose, dockId }: Props = $props();

	// Export state
	let exporting = $state(false);
	let savingPlot = $state(false);
	let alertDialog = $state<{ title: string; message: string } | null>(null);

	// Display toggles
	let showAxes = $state(false);
	let showTickMarks = $state(true);
	let showTickLabels = $state(true);
	let showLampLabels = $state(false);
	let showXYZMarker = $state(false);

	// Canvas container ref for saving plot
	let canvasContainer: HTMLDivElement;

	// Keep renderer ref for theme-reactive clear color
	let rendererRef: THREE.WebGLRenderer | null = null;
	$effect(() => {
		if (rendererRef) {
			rendererRef.setClearColor(new THREE.Color($theme === 'dark' ? '#1a1a2e' : '#d0d7de'));
		}
	});

	// Projection mode
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

	$effect(() => {
		return () => { cancelAnimation(); };
	});

	function shortestAngleDelta(from: number, to: number): number {
		let delta = to - from;
		if (delta > Math.PI) delta -= 2 * Math.PI;
		if (delta < -Math.PI) delta += 2 * Math.PI;
		return delta;
	}

	// Point position and normal in room coordinates
	const px = $derived(zone.x ?? room.x / 2);
	const py = $derived(zone.y ?? room.y / 2);
	const pz = $derived(zone.z ?? 1.0);
	const ax = $derived(zone.aim_x ?? px);
	const ay = $derived(zone.aim_y ?? py);
	const az = $derived(zone.aim_z ?? pz + 1);

	// Bounding box: expand around the point with margin for context
	const viewMargin = $derived(Math.max(room.x, room.y, room.z) * 0.3);
	const bounds = $derived({
		x1: Math.max(0, Math.min(px, ax) - viewMargin),
		x2: Math.min(room.x, Math.max(px, ax) + viewMargin),
		y1: Math.max(0, Math.min(py, ay) - viewMargin),
		y2: Math.min(room.y, Math.max(py, ay) + viewMargin),
		z1: Math.max(0, Math.min(pz, az) - viewMargin),
		z2: Math.min(room.z, Math.max(pz, az) + viewMargin),
	});

	function handleViewChange(view: ViewPreset) {
		if (!cameraRef || !controlsRef) return;
		activeView = view;
		cancelAnimation();

		const cx = (bounds.x1 + bounds.x2) / 2;
		const cy = (bounds.z1 + bounds.z2) / 2;
		const cz = -((bounds.y1 + bounds.y2) / 2);
		const maxD = Math.max(bounds.x2 - bounds.x1, bounds.y2 - bounds.y1, bounds.z2 - bounds.z1);
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
			const zoneSize = Math.max(
				bounds.x2 - bounds.x1,
				bounds.y2 - bounds.y1,
				bounds.z2 - bounds.z1
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
			const canvas = canvasContainer?.querySelector('canvas');
			if (!canvas) throw new Error('Canvas not found');

			let savedAlpha = 1;
			if (rendererRef) {
				savedAlpha = rendererRef.getClearAlpha();
				rendererRef.setClearColor(0x000000, 0);
			}

			await new Promise(r => requestAnimationFrame(r));

			const scaleFactor = 2;
			const width = canvas.width * scaleFactor;
			const height = canvas.height * scaleFactor;

			const offscreen = document.createElement('canvas');
			offscreen.width = width;
			offscreen.height = height;
			const ctx = offscreen.getContext('2d');
			if (!ctx) throw new Error('Could not get 2d context');

			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'high';
			ctx.drawImage(canvas, 0, 0, width, height);

			if (rendererRef) {
				rendererRef.setClearColor(new THREE.Color($theme === 'dark' ? '#1a1a2e' : '#d0d7de'), savedAlpha);
			}

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

	const TICK_EPS = 1e-9;

	function generateTicks(min: number, max: number): number[] {
		const niceSteps = [1, 2, 2.5, 5, 10];
		const range = max - min;
		if (range <= 0) return [min];
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

	function buildTickGeometry(
		b: { x1: number; x2: number; y1: number; y2: number; z1: number; z2: number },
		scale: number,
		tickSize: number,
		xTicks: number[],
		yTicks: number[],
		zTicks: number[]
	): THREE.BufferGeometry {
		const positions: number[] = [];

		// X axis line
		positions.push(
			b.x1 * scale, b.z1 * scale, -b.y1 * scale,
			b.x2 * scale, b.z1 * scale, -b.y1 * scale
		);
		for (const tick of xTicks) {
			positions.push(
				tick * scale, b.z1 * scale, -b.y1 * scale,
				tick * scale, b.z1 * scale - tickSize, -b.y1 * scale
			);
		}

		// Y axis line
		positions.push(
			b.x1 * scale, b.z1 * scale, -b.y1 * scale,
			b.x1 * scale, b.z1 * scale, -b.y2 * scale
		);
		for (const tick of yTicks) {
			positions.push(
				b.x1 * scale, b.z1 * scale, -tick * scale,
				b.x1 * scale - tickSize, b.z1 * scale, -tick * scale
			);
		}

		// Z axis line
		positions.push(
			b.x1 * scale, b.z1 * scale, -b.y1 * scale,
			b.x1 * scale, b.z2 * scale, -b.y1 * scale
		);
		for (const tick of zTicks) {
			positions.push(
				b.x1 * scale, tick * scale, -b.y1 * scale,
				b.x1 * scale - tickSize, tick * scale, -b.y1 * scale
			);
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		return geometry;
	}

	function formatTick(v: number): string {
		return v.toFixed(room.precision);
	}

	// Enabled lamp positions for 3D rendering
	const enabledLamps = $derived.by((): LampInstance[] => {
		if (!showLampLabels) return [];
		const lampList: LampInstance[] = $lamps;
		return lampList?.filter(l => l.enabled) ?? [];
	});

	function buildAimLineGeometry(lx: number, ly: number, lz: number, aimX: number, aimY: number, aimZ: number): THREE.BufferGeometry {
		const geometry = new THREE.BufferGeometry();
		const positions = new Float32Array([0, 0, 0, aimX - lx, aimY - ly, aimZ - lz]);
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		return geometry;
	}

	// Display value with factor applied
	const displayValue = $derived((value * valueFactor).toPrecision(4));
</script>

{#snippet PointScene(axisLabelsVisible: boolean, tickMarksVisible: boolean, tickLabelsVisible: boolean, lampLabelsVisible: boolean, xyzMarkerVisible: boolean)}
	{@const scale = 1}
	{@const units = unitAbbrev($userSettings.units)}
	{@const b = bounds}

	{@const centerX = ((b.x1 + b.x2) / 2) * scale}
	{@const centerY = ((b.z1 + b.z2) / 2) * scale}
	{@const centerZ = -((b.y1 + b.y2) / 2) * scale}
	{@const maxDim = Math.max(
		(b.x2 - b.x1) * scale,
		(b.y2 - b.y1) * scale,
		(b.z2 - b.z1) * scale
	)}
	{@const cameraDistance = maxDim * 1.8}

	{@const textColor = $theme === 'dark' ? '#cccccc' : '#333333'}
	{@const axisColor = $theme === 'dark' ? '#888888' : '#666666'}
	{@const fontSize = maxDim * 0.06}
	{@const tickSize = maxDim * 0.02}

	{@const pointColor = '#3b82f6'}
	{@const sphereRadius = Math.min(0.15, Math.max(0.015, Math.sqrt(maxDim) * 0.02)) * scale}
	{@const arrowLength = Math.min(0.5, Math.max(0.05, Math.sqrt(maxDim) * 0.06)) * scale}

	<!-- Point position in Three.js coords -->
	{@const ptX = px * scale}
	{@const ptY = pz * scale}
	{@const ptZ = -(py * scale)}

	<!-- Normal direction in Three.js coords -->
	{@const normalDir = new THREE.Vector3(ax - px, az - pz, -(ay - py)).normalize()}

	<!-- Arrow geometry -->
	{@const arrowStart = new THREE.Vector3(ptX, ptY, ptZ).add(normalDir.clone().multiplyScalar(sphereRadius))}
	{@const arrowEnd = new THREE.Vector3(ptX, ptY, ptZ).add(normalDir.clone().multiplyScalar(arrowLength))}
	{@const coneHeight = sphereRadius * 2}
	{@const coneRadius = sphereRadius * 0.8}
	{@const shaftEnd = new THREE.Vector3(ptX, ptY, ptZ).add(normalDir.clone().multiplyScalar(arrowLength - coneHeight / 2))}
	{@const coneQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalDir)}
	{@const coneEuler = new THREE.Euler().setFromQuaternion(coneQuat)}

	<!-- Aim point in Three.js coords -->
	{@const aimPtX = ax * scale}
	{@const aimPtY = az * scale}
	{@const aimPtZ = -(ay * scale)}

	<!-- Camera defaults -->
	{@const defaultCamPos = [centerX + cameraDistance, centerY + cameraDistance * 0.6, centerZ + cameraDistance] as [number, number, number]}
	{@const defaultTarget = [ptX, ptY, ptZ] as [number, number, number]}

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

	<!-- Point sphere -->
	<T.Mesh position={[ptX, ptY, ptZ]}>
		<T.SphereGeometry args={[sphereRadius, 16, 16]} />
		<T.MeshStandardMaterial
			color={pointColor}
			emissive={pointColor}
			emissiveIntensity={0.3}
			transparent
			opacity={0.9}
		/>
	</T.Mesh>

	<!-- Normal arrow shaft -->
	{@const shaftGeo = (() => {
		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
			arrowStart.x, arrowStart.y, arrowStart.z,
			shaftEnd.x, shaftEnd.y, shaftEnd.z,
		]), 3));
		return geom;
	})()}
	<T.Line geometry={shaftGeo}>
		<T.LineBasicMaterial color={pointColor} linewidth={2} />
	</T.Line>

	<!-- Normal arrowhead -->
	<T.Mesh position={[arrowEnd.x, arrowEnd.y, arrowEnd.z]} rotation={[coneEuler.x, coneEuler.y, coneEuler.z]}>
		<T.ConeGeometry args={[coneRadius, coneHeight, 8]} />
		<T.MeshStandardMaterial
			color={pointColor}
			emissive={pointColor}
			emissiveIntensity={0.3}
		/>
	</T.Mesh>

	<!-- Dashed aim line -->
	{@const aimGeo = (() => {
		const geom = new THREE.BufferGeometry();
		const start = new THREE.Vector3(ptX, ptY, ptZ);
		const end = new THREE.Vector3(aimPtX, aimPtY, aimPtZ);
		const dist = start.distanceTo(end);
		geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
			ptX, ptY, ptZ, aimPtX, aimPtY, aimPtZ
		]), 3));
		geom.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array([0, dist]), 1));
		return geom;
	})()}
	{@const dashSize = Math.max(0.02, sphereRadius * 0.8)}
	{@const gapSize = Math.max(0.02, sphereRadius * 0.6)}
	<T.Line geometry={aimGeo}>
		<T.LineDashedMaterial color={pointColor} dashSize={dashSize} gapSize={gapSize} linewidth={1} opacity={0.5} transparent />
	</T.Line>

	<!-- Bounding box wireframe -->
	{@const boxWidth = (b.x2 - b.x1) * scale}
	{@const boxHeight = (b.z2 - b.z1) * scale}
	{@const boxDepth = (b.y2 - b.y1) * scale}
	{@const boxGeo = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth)}
	<T.LineSegments position={[centerX, centerY, centerZ]}>
		<T.EdgesGeometry args={[boxGeo]} />
		<T.LineBasicMaterial color={$theme === 'dark' ? '#666666' : '#555555'} opacity={$theme === 'dark' ? 0.5 : 0.8} transparent />
	</T.LineSegments>

	<!-- XYZ marker -->
	{#if xyzMarkerVisible}
		<RoomAxes axisLength={maxDim * 0.15} />
	{/if}

	<!-- Axes and tick marks -->
	{@const _du = $userSettings.units}
	{@const xTicks = generateTicks(b.x1, b.x2)}
	{@const yTicks = generateTicks(b.y1, b.y2)}
	{@const zTicks = generateTicks(b.z1, b.z2)}

	{#if tickMarksVisible}
		{@const tickGeometry = buildTickGeometry(b, scale, tickSize, xTicks, yTicks, zTicks)}
		<T.LineSegments geometry={tickGeometry}>
			<T.LineBasicMaterial color={axisColor} />
		</T.LineSegments>
	{/if}

	<!-- Lamp markers -->
	{#if lampLabelsVisible}
		{#each enabledLamps as lamp}
			{@const lx = lamp.x * scale}
			{@const ly = lamp.z * scale}
			{@const lz = -lamp.y * scale}
			{@const lax = lamp.aimx * scale}
			{@const lay = lamp.aimz * scale}
			{@const laz = -lamp.aimy * scale}
			<T.Mesh position={[lx, ly, lz]}>
				<T.SphereGeometry args={[maxDim * 0.015, 8, 8]} />
				<T.MeshBasicMaterial color="#3b82f6" />
			</T.Mesh>
			{@const lampAimGeo = buildAimLineGeometry(lx, ly, lz, lax, lay, laz)}
			<T.Group position={[lx, ly, lz]}>
				<T.LineSegments
					oncreate={(ref) => { ref.computeLineDistances(); }}
					geometry={lampAimGeo}
				>
					<T.LineDashedMaterial color="#3b82f6" dashSize={0.1} gapSize={0.06} transparent opacity={0.5} />
				</T.LineSegments>
			</T.Group>
			<T.Mesh position={[lax, lay, laz]}>
				<T.SphereGeometry args={[maxDim * 0.008, 6, 6]} />
				<T.MeshBasicMaterial color="#3b82f6" transparent opacity={0.6} />
			</T.Mesh>
		{/each}
	{/if}

	<!-- Text labels (billboarded) -->
	<BillboardGroup>
		<!-- Value label at the point -->
		<Text
			text="{displayValue} {valueUnits}"
			fontSize={fontSize * 0.8}
			color={$theme === 'dark' ? '#ffffff' : '#1f2328'}
			outlineColor={$theme === 'dark' ? '#000000' : '#ffffff'}
			outlineWidth={fontSize * 0.08}
			position={[ptX, ptY + sphereRadius * 2.5, ptZ]}
			anchorX="center"
			anchorY="bottom"
		/>

		<!-- Lamp labels -->
		{#if lampLabelsVisible}
			{#each enabledLamps as lamp}
				{@const lx = lamp.x * scale}
				{@const ly = lamp.z * scale}
				{@const lz = -lamp.y * scale}
				<Text
					text={lamp.name || lamp.id}
					fontSize={fontSize * 0.6}
					color={$theme === 'dark' ? '#ffffff' : '#1f2328'}
					outlineColor={$theme === 'dark' ? '#000000' : '#ffffff'}
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
				text="X"
				fontSize={fontSize}
				color={textColor}
				position={[centerX, b.z1 * scale - tickSize * 4, -b.y1 * scale + tickSize]}
				anchorX="center"
				anchorY="middle"
			/>
			<Text
				text="Y"
				fontSize={fontSize}
				color={textColor}
				position={[b.x1 * scale - tickSize * 4, b.z1 * scale - tickSize, centerZ]}
				anchorX="center"
				anchorY="middle"
			/>
			<Text
				text="Z"
				fontSize={fontSize}
				color={textColor}
				position={[b.x1 * scale - tickSize * 4, centerY, -b.y1 * scale + tickSize]}
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
					position={[tick * scale, b.z1 * scale - tickSize * 3, -b.y1 * scale]}
					anchorX="center"
					anchorY="middle"
				/>
			{/each}
			{#each yTicks as tick}
				{@const isCornerTick = Math.abs(tick - b.y1) < TICK_EPS && xTicks.some(xt => Math.abs(xt - b.x1) < TICK_EPS && formatTick(xt) === formatTick(tick))}
				{#if !isCornerTick}
				<Text
					text={formatTick(tick)}
					fontSize={fontSize * 0.7}
					color={textColor}
					position={[b.x1 * scale - tickSize * 3, b.z1 * scale - tickSize, -tick * scale]}
					anchorX="center"
					anchorY="middle"
				/>
				{/if}
			{/each}
			{#each zTicks as tick}
				{@const isCornerTick = Math.abs(tick - b.z1) < TICK_EPS && xTicks.some(xt => Math.abs(xt - b.x1) < TICK_EPS && formatTick(xt) === formatTick(tick))}
				{#if !isCornerTick}
				<Text
					text={formatTick(tick)}
					fontSize={fontSize * 0.7}
					color={textColor}
					position={[b.x1 * scale - tickSize * 3, tick * scale, -b.y1 * scale + tickSize]}
					anchorX="center"
					anchorY="middle"
				/>
				{/if}
			{/each}
		{/if}
	</BillboardGroup>
{/snippet}

<Modal title={zoneName} onClose={onclose} maxWidth="min(800px, 95vw)" maxHeight="95vh" titleFontSize="1rem" {dockId}>
	{#snippet headerExtra()}
		<span class="point-badge">Point</span>
	{/snippet}
	{#snippet body()}
		<div class="modal-body">
			<div class="canvas-container" class:dark={$theme === 'dark'} bind:this={canvasContainer}>
				<ViewSnapOverlay onViewChange={handleViewChange} {activeView} />
				<ProjectionToggle isOrtho={useOrtho} onclick={toggleProjection} />
				{#if showTickLabels}
					<span class="units-label">Units: {unitLabel($userSettings.units)}</span>
				{/if}
				<Canvas createRenderer={(canvas) => {
					const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: true, alpha: true });
					renderer.setClearColor(new THREE.Color($theme === 'dark' ? '#1a1a2e' : '#d0d7de'));
					rendererRef = renderer;
					return renderer;
				}}>
					{@render PointScene(showAxes, showTickMarks, showTickLabels, showLampLabels, showXYZMarker)}
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
	.point-badge {
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

	.units-label {
		position: absolute;
		bottom: var(--spacing-md);
		left: calc(var(--spacing-sm) + 124px);
		z-index: 10;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1;
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

	.footer-buttons {
		display: flex;
		gap: var(--spacing-sm);
		flex-shrink: 0;
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
</style>
