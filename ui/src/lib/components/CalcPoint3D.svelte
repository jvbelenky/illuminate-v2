<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig } from '$lib/types/project';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		scale: number;
		value?: number;
		selected?: boolean;
		highlighted?: boolean;
		onclick?: (event: any) => void;
	}

	let { zone, room, scale, value, selected = false, highlighted = false, onclick }: Props = $props();

	// Color scheme: grey=disabled, light blue=highlighted, magenta=selected, blue=enabled
	const pointColor = $derived(
		zone.enabled === false ? '#888888' :
		highlighted ? '#60a5fa' :
		selected ? '#d946ef' :
		'#3b82f6'
	);

	// Room→Three.js coordinate mapping: X→X, Y→-Z, Z→Y
	const position = $derived<[number, number, number]>([
		(zone.x ?? room.x / 2) * scale,
		(zone.z ?? 1.0) * scale,
		-(zone.y ?? room.y / 2) * scale,
	]);

	// Aim point position in Three.js coordinates (for dashed aim line)
	const aimPosition = $derived<[number, number, number]>([
		(zone.aim_x ?? (zone.x ?? room.x / 2)) * scale,
		(zone.aim_z ?? ((zone.z ?? 1.0) + 1)) * scale,
		-(zone.aim_y ?? (zone.y ?? room.y / 2)) * scale,
	]);

	// Normal direction derived from aim_point - position, in Three.js coordinates
	const normalDir = $derived(() => {
		const px = zone.x ?? room.x / 2;
		const py = zone.y ?? room.y / 2;
		const pz = zone.z ?? 1.0;
		const ax = zone.aim_x ?? px;
		const ay = zone.aim_y ?? py;
		const az = zone.aim_z ?? pz + 1;
		// Room direction: (ax-px, ay-py, az-pz)
		// Room→Three.js: (dx, dz, -dy)
		return new THREE.Vector3(ax - px, az - pz, -(ay - py)).normalize();
	});

	// Size based on room dimensions — sqrt scaling so the point stays visible
	// in large rooms without becoming comically oversized.
	// Sphere min ≈ 3 cm diameter (real radiometer), max ≈ 30 cm diameter.
	const maxDim = $derived(Math.max(room.x, room.y, room.z));
	const sphereRadius = $derived(Math.min(0.15, Math.max(0.015, Math.sqrt(maxDim) * 0.02)) * scale);
	const arrowLength = $derived(Math.min(0.5, Math.max(0.05, Math.sqrt(maxDim) * 0.06)) * scale);

	// Build arrow geometry for the normal direction
	const arrowPoints = $derived.by(() => {
		const dir = normalDir();
		const start = new THREE.Vector3(...position);
		const end = start.clone().add(dir.clone().multiplyScalar(arrowLength));
		return { start, end, dir };
	});

	// Arrowhead cone: positioned at the tip of the arrow
	const conePosition = $derived<[number, number, number]>([
		arrowPoints.end.x,
		arrowPoints.end.y,
		arrowPoints.end.z,
	]);

	// Rotation to align cone with normal direction
	const coneRotation = $derived(() => {
		const dir = normalDir();
		const quaternion = new THREE.Quaternion();
		quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
		const euler = new THREE.Euler().setFromQuaternion(quaternion);
		return [euler.x, euler.y, euler.z] as [number, number, number];
	});

	const coneHeight = $derived(sphereRadius * 2);
	const coneRadius = $derived(sphereRadius * 0.8);

	// Shaft line — from sphere surface to cone base
	const shaftStart = $derived.by(() => {
		const dir = normalDir();
		return new THREE.Vector3(...position).add(dir.clone().multiplyScalar(sphereRadius));
	});
	const shaftEnd = $derived.by(() => {
		const dir = normalDir();
		return new THREE.Vector3(...position).add(dir.clone().multiplyScalar(arrowLength - coneHeight / 2));
	});

	const shaftGeometry = $derived.by(() => {
		const geom = new THREE.BufferGeometry();
		const positions = new Float32Array([
			shaftStart.x, shaftStart.y, shaftStart.z,
			shaftEnd.x, shaftEnd.y, shaftEnd.z,
		]);
		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		return geom;
	});

	// Dashed line from point position to aim point
	const aimLineGeometry = $derived.by(() => {
		const geom = new THREE.BufferGeometry();
		const positions = new Float32Array([
			position[0], position[1], position[2],
			aimPosition[0], aimPosition[1], aimPosition[2],
		]);
		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geom.computeBoundingSphere();
		// computeLineDistances is needed for dashed materials
		const lineGeom = new THREE.BufferGeometry();
		lineGeom.setAttribute('position', geom.getAttribute('position'));
		const start = new THREE.Vector3(...position);
		const end = new THREE.Vector3(...aimPosition);
		const dist = start.distanceTo(end);
		lineGeom.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array([0, dist]), 1));
		return lineGeom;
	});

	const aimDashSize = $derived(Math.max(0.02, sphereRadius * 0.8));
	const aimGapSize = $derived(Math.max(0.02, sphereRadius * 0.6));
</script>

<!-- Click target group -->
<T.Group
	userData={{ clickType: 'zone', clickId: zone.id }}
	onclick={onclick}
>
	<!-- Point sphere -->
	<T.Mesh position={position}>
		<T.SphereGeometry args={[sphereRadius, 16, 16]} />
		<T.MeshStandardMaterial
			color={pointColor}
			emissive={pointColor}
			emissiveIntensity={0.3}
			transparent
			opacity={0.9}
		/>
	</T.Mesh>

	<!-- Normal direction arrow shaft -->
	<T.Line geometry={shaftGeometry}>
		<T.LineBasicMaterial color={pointColor} linewidth={2} />
	</T.Line>

	<!-- Normal direction arrowhead -->
	<T.Mesh position={conePosition} rotation={coneRotation()}>
		<T.ConeGeometry args={[coneRadius, coneHeight, 8]} />
		<T.MeshStandardMaterial
			color={pointColor}
			emissive={pointColor}
			emissiveIntensity={0.3}
		/>
	</T.Mesh>

	<!-- Dashed line to aim point -->
	<T.Line geometry={aimLineGeometry}>
		<T.LineDashedMaterial color={pointColor} dashSize={aimDashSize} gapSize={aimGapSize} linewidth={1} opacity={0.5} transparent />
	</T.Line>
</T.Group>
