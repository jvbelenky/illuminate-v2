<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls, Text, Billboard } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import { roomWireColor } from '$lib/utils/sceneColors';
	import { lampLocalToThree, luminousOpeningPlaneArgs } from '$lib/utils/fixturePreviewGeometry';
	import { axisMatrix, guvToThreeMatrix, transposeMat3, type Mat3, type PhotometricAxis } from '$lib/utils/photometricAxis';
	import { emitterPosition, housingMatrix, type HousingLayout } from '$lib/utils/housingGeometry';

	interface Props {
		layout: HousingLayout;   // meters
		axis: PhotometricAxis;
		surfaceLength: number;   // meters
		surfaceWidth: number;    // meters
		web: { vertices: number[][]; triangles: number[][] } | null;  // IES frame
	}

	let { layout, axis, surfaceLength, surfaceWidth, web }: Props = $props();

	const { scene } = useThrelte();
	$effect(() => {
		scene.background = new THREE.Color($theme === 'light' ? '#d0d7de' : '#1a1a2e');
	});

	// Fit the larger of the housing and the emitter's reach into ~1 scene unit
	const scale = $derived.by(() => {
		const e = emitterPosition(layout);
		const r = Math.max(layout.length, layout.width, layout.height, surfaceLength, surfaceWidth,
			2 * Math.hypot(...e));
		return r > 0 ? 1 / r : 1;
	});

	function quat(m: Mat3): [number, number, number, number] {
		const t = guvToThreeMatrix(m);
		const m4 = new THREE.Matrix4().set(
			t[0][0], t[0][1], t[0][2], 0,
			t[1][0], t[1][1], t[1][2], 0,
			t[2][0], t[2][1], t[2][2], 0,
			0, 0, 0, 1
		);
		const q = new THREE.Quaternion().setFromRotationMatrix(m4);
		return [q.x, q.y, q.z, q.w];
	}

	// aim frame -> housing frame
	const emitterQuat = $derived(quat(transposeMat3(housingMatrix(layout.face, layout.roll))));
	const emitterPos = $derived(lampLocalToThree(emitterPosition(layout).map((v) => v * scale)));
	const webQuat = $derived(quat(axisMatrix(axis)));

	const boxGeometry = $derived.by(() => {
		const [hl, hw, hh] = [layout.length / 2, layout.width / 2, layout.height / 2].map((v) => v * scale);
		if (hl <= 0 && hw <= 0 && hh <= 0) return null;
		const c = [
			[-hl, -hw, -hh], [hl, -hw, -hh], [hl, hw, -hh], [-hl, hw, -hh],
			[-hl, -hw, hh], [hl, -hw, hh], [hl, hw, hh], [-hl, hw, hh],
		];
		const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
		const g = new THREE.BufferGeometry();
		const pos: number[] = [];
		for (const [a, b] of edges) pos.push(...lampLocalToThree(c[a]), ...lampLocalToThree(c[b]));
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		return g;
	});

	// The web is shown at a fixed size so it reads next to any housing
	const webGeometry = $derived.by(() => {
		if (!web || web.vertices.length === 0) return null;
		let r = 0;
		for (const [x, y, z] of web.vertices) r = Math.max(r, Math.hypot(x, y, z));
		const k = 0.6 / (r || 1);
		const g = new THREE.BufferGeometry();
		const pos: number[] = [];
		for (const v of web.vertices) pos.push(...lampLocalToThree([v[0] * k, v[1] * k, v[2] * k]));
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		if (web.triangles.length) g.setIndex(web.triangles.flat());
		g.computeVertexNormals();
		return g;
	});

	const opening = $derived(
		surfaceLength > 0 && surfaceWidth > 0
			? luminousOpeningPlaneArgs(surfaceWidth * scale, surfaceLength * scale)
			: ([0.08, 0.08] as [number, number])
	);

	const beamGeometry = (() => {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.9, 0], 3));
		return g;
	})();

	const labels = $derived([
		{ text: 'L', at: lampLocalToThree([(layout.length / 2) * scale + 0.08, 0, 0]) },
		{ text: 'W', at: lampLocalToThree([0, (layout.width / 2) * scale + 0.08, 0]) },
		{ text: 'H', at: lampLocalToThree([0, 0, (layout.height / 2) * scale + 0.08]) },
	]);

	const webColor = $derived($theme === 'light' ? '#7a3fd6' : '#cc61ff');
	const wireColor = $derived(roomWireColor($theme));
	const textColor = $derived($theme === 'light' ? '#333' : '#ccc');
	const beamColor = '#ff8c00';
</script>

<T.PerspectiveCamera makeDefault position={[1.6, 1.1, 1.6]} fov={45}>
	<OrbitControls enableDamping dampingFactor={0.1} target={[0, 0, 0]} />
</T.PerspectiveCamera>
<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[5, 8, 5]} intensity={0.8} />

{#if boxGeometry}
	<T.LineSegments geometry={boxGeometry}>
		<T.LineBasicMaterial color={wireColor} />
	</T.LineSegments>
{/if}
{#each labels as l (l.text)}
	<Billboard position={l.at}>
		<Text text={l.text} fontSize={0.08} color={textColor} anchorX="center" anchorY="middle" />
	</Billboard>
{/each}

<T.Group position={emitterPos} quaternion={emitterQuat}>
	<T.Mesh rotation={[-Math.PI / 2, 0, 0]}>
		<T.PlaneGeometry args={opening} />
		<T.MeshBasicMaterial color={beamColor} transparent opacity={0.7} side={THREE.DoubleSide} />
	</T.Mesh>
	{#if webGeometry}
		<T.Group quaternion={webQuat}>
			<T.Mesh geometry={webGeometry}>
				<T.MeshStandardMaterial color={webColor} transparent opacity={0.45} side={THREE.DoubleSide} />
			</T.Mesh>
		</T.Group>
	{/if}
	<T.Line geometry={beamGeometry}>
		<T.LineBasicMaterial color={beamColor} />
	</T.Line>
	<T.Mesh position={[0, -0.9, 0]} rotation={[Math.PI, 0, 0]}>
		<T.ConeGeometry args={[0.05, 0.12, 12]} />
		<T.MeshBasicMaterial color={beamColor} />
	</T.Mesh>
</T.Group>
