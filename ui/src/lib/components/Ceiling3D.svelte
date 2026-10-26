<script lang="ts">
	// The ceiling layout in the 3D view: tile lines, detectors (discs), vents
	// (squares), sensors (cones) and keep-out areas (translucent red). Planning
	// only: nothing here is picked or edited, and nothing reaches the calculation.
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import { userSettings } from '$lib/stores/settings';
	import { ceilingColors, roomWireColor, SELECTED_COLOR } from '$lib/utils/sceneColors';
	import { roomVertices } from '$lib/utils/roomGeometry';
	import { fromMeters } from '$lib/utils/unitConversion';
	import { ceilingDrawing, type DrawnKeepOut, type DrawnPoint } from '$lib/ceiling/ceiling3d';
	import type { CeilingLayout } from '$lib/ceiling/ceilingLayout';
	import type { RoomConfig } from '$lib/types/project';

	interface Props {
		layout: CeilingLayout;
		room: RoomConfig;
		/** Ceiling height in the project's units */
		height: number;
		selectedId?: string | null;
	}

	let { layout, room, height, selectedId = null }: Props = $props();

	const units = $derived($userSettings.units);
	const outline = $derived(roomVertices(room));
	const drawing = $derived(ceilingDrawing(layout, outline, units, null));
	// The selection is applied by id in the markup, so selecting rebuilds no geometry
	const colors = $derived(ceilingColors($theme));

	// Room (x, y, z) -> three.js (x, z, -y). Drawn just below the ceiling plane
	// (the translucent ceiling sits 1 mm under it), the tiles lowest and the
	// items a little lower, so nothing z-fights.
	const lift = $derived(Math.max(fromMeters(0.004, units), height * 0.0015));
	const tileY = $derived(height - lift);
	const itemY = $derived(height - lift * 2);

	const tileGeometry = $derived.by(() => {
		const positions: number[] = [];
		for (const s of drawing.tiles) positions.push(s.x1, 0, -s.y1, s.x2, 0, -s.y2);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		return geo;
	});
	$effect(() => {
		const geo = tileGeometry;
		return () => { geo.dispose(); };
	});

	const points = $derived(drawing.items.filter((i): i is DrawnPoint => i.kind !== 'keep'));
	const keepOuts = $derived(drawing.items.filter((i): i is DrawnKeepOut => i.kind === 'keep'));

	// Keep-out fill: a Shape in XY rotated -90 degrees about X lands on (x, 0, -y)
	const keepFill = $derived(keepOuts.map((k) => new THREE.ShapeGeometry(new THREE.Shape(k.vertices.map(([x, y]) => new THREE.Vector2(x, y))))));
	const keepLine = $derived(keepOuts.map((k) => {
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(k.vertices.flatMap(([x, y]) => [x, 0, -y]), 3));
		return geo;
	}));
	$effect(() => {
		const fills = keepFill;
		const lines = keepLine;
		return () => {
			for (const g of fills) g.dispose();
			for (const g of lines) g.dispose();
		};
	});

	const itemColor = (selected: boolean, base: string) => (selected ? SELECTED_COLOR : base);
</script>

{#if drawing.tiles.length}
	<T.LineSegments position.y={tileY}>
		<T is={tileGeometry} />
		<T.LineBasicMaterial color={roomWireColor($theme)} transparent opacity={0.8} depthWrite={false} />
	</T.LineSegments>
{/if}

{#each keepOuts as k, i (k.id)}
	<T.Mesh position.y={itemY} rotation.x={-Math.PI / 2} renderOrder={1}>
		<T is={keepFill[i]} />
		<T.MeshBasicMaterial color={itemColor(k.id === selectedId, colors.keepOut)} transparent opacity={k.id === selectedId ? 0.35 : 0.22} side={THREE.DoubleSide} depthWrite={false} />
	</T.Mesh>
	<T.LineLoop position.y={itemY} renderOrder={2}>
		<T is={keepLine[i]} />
		<T.LineBasicMaterial color={itemColor(k.id === selectedId, colors.keepOut)} depthWrite={false} />
	</T.LineLoop>
{/each}

{#each points as p (p.id)}
	{@const color = itemColor(p.id === selectedId, colors.point)}
	{#if p.kind === 'smoke'}
		<T.Mesh position={[p.x, itemY, -p.y]} rotation.x={-Math.PI / 2} renderOrder={2}>
			<T.CircleGeometry args={[p.size / 2, 24]} />
			<T.MeshBasicMaterial {color} side={THREE.DoubleSide} />
		</T.Mesh>
	{:else if p.kind === 'vent'}
		<T.Mesh position={[p.x, itemY, -p.y]} rotation.x={-Math.PI / 2} renderOrder={2}>
			<T.PlaneGeometry args={[p.size, p.size]} />
			<T.MeshBasicMaterial {color} side={THREE.DoubleSide} />
		</T.Mesh>
	{:else}
		<!-- Sensor: a cone hanging from the ceiling, point down -->
		<T.Mesh position={[p.x, itemY - p.size / 2, -p.y]} rotation.x={Math.PI} renderOrder={2}>
			<T.ConeGeometry args={[p.size / 2, p.size, 16]} />
			<T.MeshBasicMaterial {color} />
		</T.Mesh>
	{/if}
{/each}
