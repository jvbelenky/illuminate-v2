<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import type { SceneObject } from '$lib/types/project';
	import { theme } from '$lib/stores/theme';
	import { localFootprint } from '$lib/utils/objectGeometry';

	interface Props {
		object: SceneObject;
		scale?: number;
		selected?: boolean;
		highlighted?: boolean;
		onclick?: (event: any) => void;
	}

	let { object, scale = 1, selected = false, highlighted = false, onclick }: Props = $props();

	// Geometry is authored in ROOM coordinates (x right, y into the room, z up)
	// and placed inside a group rotated -90° about X, which maps room (x, y, z)
	// to three.js (x, z, -y) — the convention the rest of the scene uses. That
	// keeps guv_calcs' rotation model intact: yaw about Z, then pitch about Y,
	// then roll about X (Rz·Ry·Rx), which is three.js' 'ZYX' Euler order.
	const ROOM_TO_THREE = -Math.PI / 2;

	const geometry = $derived.by(() => {
		if (object.shape === 'extrusion' && object.vertices && object.vertices.length >= 3) {
			const shape = new THREE.Shape(localFootprint(object).map(([x, y]) => new THREE.Vector2(x * scale, y * scale)));
			return new THREE.ExtrudeGeometry(shape, { depth: object.height * scale, bevelEnabled: false });
		}
		// BoxGeometry is centred on the origin; lift it so the base sits at z = 0.
		const box = new THREE.BoxGeometry(object.width * scale, object.length * scale, object.height * scale);
		box.translate(0, 0, (object.height * scale) / 2);
		return box;
	});

	const edges = $derived(new THREE.EdgesGeometry(geometry));

	// Release GPU buffers when the geometry is rebuilt or the component unmounts.
	$effect(() => {
		const g = geometry;
		const e = edges;
		return () => {
			g.dispose();
			e.dispose();
		};
	});

	const disabled = $derived(object.enabled === false);

	// Colour scheme matches the zones: grey = disabled, light blue = highlighted,
	// magenta = selected; otherwise the room's own wireframe blue (Room3D), so
	// an obstacle reads as part of the room rather than a foreign solid.
	const roomBlue = $derived($theme === 'dark' ? '#6a9fff' : '#4a7fcf');
	const faceColor = $derived(
		disabled ? '#888888' :
		highlighted ? '#60a5fa' :
		selected ? '#d946ef' :
		roomBlue
	);
	const edgeColor = $derived(
		disabled ? '#888888' :
		highlighted ? '#60a5fa' :
		selected ? '#d946ef' :
		roomBlue
	);

	// A transparent object (transmittance → 1) fades; an opaque one stays solid.
	const faceOpacity = $derived(
		disabled ? 0.15 : 0.35 + 0.55 * (1 - Math.min(1, Math.max(0, object.transmittance)))
	);

	let group = $state<THREE.Group | undefined>();
	$effect(() => {
		if (!group) return;
		const toRad = Math.PI / 180;
		group.rotation.set(object.roll * toRad, object.pitch * toRad, object.yaw * toRad, 'ZYX');
	});

	const position = $derived([object.x * scale, object.y * scale, object.z * scale] as [number, number, number]);
</script>

<T.Group rotation.x={ROOM_TO_THREE}>
	<T.Group bind:ref={group} {position}>
		<T.Mesh
			{geometry}
			onclick={onclick}
			userData={{ clickType: 'object', clickId: object.id }}
			oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }}
			castShadow
			receiveShadow
		>
			<T.MeshStandardMaterial
				color={faceColor}
				transparent={faceOpacity < 1}
				opacity={faceOpacity}
				roughness={0.85}
				metalness={0}
				side={THREE.DoubleSide}
				depthWrite={faceOpacity >= 0.5}
			/>
		</T.Mesh>
		{#if disabled}
			<T.LineSegments geometry={edges} oncreate={(ref) => { ref.computeLineDistances(); }}>
				<T.LineDashedMaterial color={edgeColor} dashSize={0.2} gapSize={0.12} />
			</T.LineSegments>
		{:else}
			<T.LineSegments geometry={edges}>
				<T.LineBasicMaterial color={edgeColor} transparent opacity={selected || highlighted ? 1 : 0.8} />
			</T.LineSegments>
		{/if}
	</T.Group>
</T.Group>
