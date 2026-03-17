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

	// Normal direction in Three.js coordinates
	const normalDir = $derived(() => {
		const nx = zone.normal_x ?? 0;
		const ny = zone.normal_y ?? 0;
		const nz = zone.normal_z ?? 1;
		// Room→Three.js: (nx, nz, -ny)
		return new THREE.Vector3(nx, nz, -ny).normalize();
	});

	// Arrow length based on room size
	const arrowLength = $derived(Math.max(room.x, room.y, room.z) * 0.08 * scale);
	const sphereRadius = $derived(Math.max(room.x, room.y, room.z) * 0.025 * scale);

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
</T.Group>
