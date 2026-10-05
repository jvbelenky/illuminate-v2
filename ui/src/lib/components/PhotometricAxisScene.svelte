<script lang="ts">
	import { T, useThrelte, useTask } from '@threlte/core';
	import { OrbitControls, interactivity, Text } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import { lampLocalToThree } from '$lib/utils/fixturePreviewGeometry';
	import {
		PHOTOMETRIC_AXES, AXIS_LABELS, axisDirection, axisMatrix, snapToAxis, guvToThreeMatrix,
		type PhotometricAxis
	} from '$lib/utils/photometricAxis';

	interface Props {
		vertices: number[][];              // IES frame, meters
		triangles: number[][];
		axis: PhotometricAxis;
		scores: Record<string, number>;
		fixtureBounds: number[][] | null;  // aim frame (guv local), scene units
		onPick: (axis: PhotometricAxis) => void;
	}

	let { vertices, triangles, axis, scores, fixtureBounds, onPick }: Props = $props();

	interactivity();

	const { scene } = useThrelte();
	$effect(() => {
		scene.background = new THREE.Color($theme === 'light' ? '#d0d7de' : '#1a1a2e');
	});

	// Normalise the web so its longest spoke is 1 scene unit
	const webRadius = $derived.by(() => {
		let r = 0;
		for (const [x, y, z] of vertices) r = Math.max(r, Math.hypot(x, y, z));
		return r || 1;
	});

	const webGeometry = $derived.by(() => {
		const g = new THREE.BufferGeometry();
		const pos: number[] = [];
		for (const v of vertices) {
			const [x, y, z] = lampLocalToThree([v[0] / webRadius, v[1] / webRadius, v[2] / webRadius]);
			pos.push(x, y, z);
		}
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		if (triangles.length) g.setIndex(triangles.flat());
		g.computeVertexNormals();
		return g;
	});

	// Target rotation: IES frame -> aim frame, expressed for Three
	const targetQuat = $derived.by(() => {
		const m = guvToThreeMatrix(axisMatrix(axis));
		const m4 = new THREE.Matrix4().set(
			m[0][0], m[0][1], m[0][2], 0,
			m[1][0], m[1][1], m[1][2], 0,
			m[2][0], m[2][1], m[2][2], 0,
			0, 0, 0, 1
		);
		return new THREE.Quaternion().setFromRotationMatrix(m4);
	});

	const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	let currentQuat = $state(new THREE.Quaternion());
	useTask((delta) => {
		if (currentQuat.angleTo(targetQuat) < 1e-4) return;
		if (reduceMotion) {
			currentQuat = targetQuat.clone();
			return;
		}
		currentQuat = currentQuat.clone().slerp(targetQuat, Math.min(1, delta * 6));
	});
	const quatArray = $derived([currentQuat.x, currentQuat.y, currentQuat.z, currentQuat.w] as [number, number, number, number]);

	// Six handles sit at the IES-frame axis tips (they rotate with the web)
	const handles = $derived(PHOTOMETRIC_AXES.map((a) => {
		const d = axisDirection(a);
		const pos = lampLocalToThree([d[0] * 1.25, d[1] * 1.25, d[2] * 1.25]);
		const dim = (scores[a] ?? 0) < 0.05;
		return { axis: a, pos, dim, label: AXIS_LABELS[a] };
	}));

	const boxGeometry = $derived.by(() => {
		if (!fixtureBounds || fixtureBounds.length !== 8) return null;
		const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
		const g = new THREE.BufferGeometry();
		const pos: number[] = [];
		for (const [a, b] of edges) {
			pos.push(...lampLocalToThree(fixtureBounds[a]), ...lampLocalToThree(fixtureBounds[b]));
		}
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		return g;
	});

	const aimGeometry = (() => {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -1.4, 0], 3));
		return g;
	})();

	// Clicking a lobe: un-rotate the hit point into the IES frame and snap
	function onWebClick(e: { point: THREE.Vector3; stopPropagation: () => void }) {
		e.stopPropagation();
		const p = e.point.clone().applyQuaternion(currentQuat.clone().invert());
		const guv: [number, number, number] = [p.x, -p.z, p.y];
		onPick(snapToAxis(guv));
	}

	const webColor = $derived($theme === 'light' ? '#7a3fd6' : '#cc61ff');
	const wireColor = $derived($theme === 'light' ? '#4a7fcf' : '#6a9fff');
	const handleColor = $derived($theme === 'light' ? '#1f6feb' : '#58a6ff');
	const dimColor = $derived($theme === 'light' ? '#9aa4b2' : '#4b5563');
</script>

<T.PerspectiveCamera makeDefault position={[2.2, 1.6, 2.2]} fov={45}>
	<OrbitControls enableDamping dampingFactor={0.1} target={[0, 0, 0]} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[5, 8, 5]} intensity={0.8} />

<!-- Web + handles rotate together from the file frame into the aim frame -->
<T.Group quaternion={quatArray}>
	<T.Mesh geometry={webGeometry} onclick={onWebClick} oncreate={(ref) => { ref.cursor = 'pointer'; }}>
		<T.MeshStandardMaterial color={webColor} transparent opacity={0.55} side={THREE.DoubleSide} />
	</T.Mesh>
	{#each handles as h (h.axis)}
		<T.Mesh position={h.pos} onclick={(e: any) => { e.stopPropagation(); onPick(h.axis); }} oncreate={(ref) => { ref.cursor = 'pointer'; }}>
			<T.SphereGeometry args={[h.axis === axis ? 0.09 : 0.06, 16, 16]} />
			<T.MeshStandardMaterial color={h.dim ? dimColor : handleColor} emissive={h.axis === axis ? handleColor : '#000000'} emissiveIntensity={h.axis === axis ? 0.6 : 0} />
		</T.Mesh>
		<Text text={h.label} position={[h.pos[0] * 1.15, h.pos[1] * 1.15 + 0.08, h.pos[2] * 1.15]} fontSize={0.12} color={h.dim ? dimColor : handleColor} anchorX="center" anchorY="middle" />
	{/each}
</T.Group>

<!-- Housing box and aim arrow stay in the aim frame -->
{#if boxGeometry}
	<T.LineSegments geometry={boxGeometry}>
		<T.LineBasicMaterial color={wireColor} />
	</T.LineSegments>
{/if}
<T.Line geometry={aimGeometry}>
	<T.LineBasicMaterial color="#ff8c00" />
</T.Line>
<T.Mesh position={[0, -1.4, 0]} rotation={[Math.PI, 0, 0]}>
	<T.ConeGeometry args={[0.06, 0.16, 12]} />
	<T.MeshBasicMaterial color="#ff8c00" />
</T.Mesh>
