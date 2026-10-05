<script lang="ts">
	// Hosts FloorPlanModal the way the page does, with a tiny in-memory scene in
	// place of the project store: each action is logged to `calls` and applied,
	// so the modal sees its edits come back as props.
	import FloorPlanModal, { type PlanActions, type PlanStep } from '../FloorPlanModal.svelte';
	import type { FloorPlanPlacement, LampInstance, SceneObject } from '$lib/types/project';
	import type { FloorPlanImage } from '$lib/stores/floorplanImage';
	import { lengthFactor, type LengthUnit } from '$lib/utils/unitConversion';
	import type { Vertex } from '$lib/utils/roomGeometry';

	interface Props {
		vertices?: Vertex[];
		units?: LengthUnit;
		precision?: number;
		lamps?: LampInstance[];
		objects?: SceneObject[];
		floorplan?: FloorPlanPlacement | null;
		image?: FloorPlanImage | null;
		roomZ?: number;
		initialStep?: PlanStep;
		initialObstacleId?: string | null;
		armDraw?: boolean;
		onClose?: () => void;
		/** Every action call as [name, ...args], in order. */
		calls?: unknown[][];
	}

	let {
		vertices = [[0, 0], [6, 0], [6, 4], [0, 4]],
		units = 'meters',
		precision = 1,
		lamps = [],
		objects = [],
		floorplan = null,
		image = null,
		roomZ = 2.7,
		initialStep = 'outline',
		initialObstacleId = null,
		armDraw = false,
		onClose = () => {},
		calls = [],
	}: Props = $props();

	// svelte-ignore state_referenced_locally
	let scene = $state({ vertices, units, objects, floorplan, image });
	let nextId = 1;

	const actions: PlanActions = {
		setOutline: (v) => {
			calls.push(['setOutline', v]);
			scene.vertices = v;
		},
		setPlacement: (placement, img) => {
			calls.push(['setPlacement', placement, img]);
			scene.floorplan = placement;
			if (img) scene.image = img;
			if (!placement) scene.image = null;
		},
		addObstacle: async (obj) => {
			const id = `object-${nextId++}`;
			calls.push(['addObstacle', obj]);
			scene.objects = [...scene.objects, { ...obj, id } as SceneObject];
			return id;
		},
		updateObstacle: (id, partial) => {
			calls.push(['updateObstacle', id, partial]);
			scene.objects = scene.objects.map((o) => (o.id === id ? { ...o, ...partial } : o));
		},
		removeObstacle: (id) => {
			calls.push(['removeObstacle', id]);
			scene.objects = scene.objects.filter((o) => o.id !== id);
		},
		changeUnits: (u) => {
			calls.push(['changeUnits', u]);
			const f = lengthFactor(scene.units, u);
			scene.vertices = scene.vertices.map(([x, y]) => [x * f, y * f] as Vertex);
			scene.units = u;
		},
	};
</script>

<FloorPlanModal
	vertices={scene.vertices}
	units={scene.units}
	{precision}
	{lamps}
	objects={scene.objects}
	floorplan={scene.floorplan}
	image={scene.image}
	{actions}
	{onClose}
	{roomZ}
	{initialStep}
	{initialObstacleId}
	{armDraw}
/>
