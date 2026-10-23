<script lang="ts">
	// Hosts PlanPane the way the workspace does, with a tiny in-memory scene in
	// place of the project store: each action is logged to `calls` and applied,
	// so the pane sees its edits come back through the controller's scene.
	import PlanPane from '$lib/plan/PlanPane.svelte';
	import { PlanController } from '$lib/plan/planController.svelte';
	import type { PlanActions, PlanScene } from '$lib/plan/planActions';
	import type { PlanContext } from '$lib/workspace/editorNav';
	import type { CalcZone, FloorPlanPlacement, LampInstance, RoomConfig, SceneObject } from '$lib/types/project';
	import type { FloorPlanImage } from '$lib/stores/floorplanImage';
	import { lengthFactor, type LengthUnit } from '$lib/utils/unitConversion';
	import type { Vertex } from '$lib/utils/roomGeometry';

	interface Props {
		context?: PlanContext;
		readonly?: boolean;
		vertices?: Vertex[];
		units?: LengthUnit;
		precision?: number;
		lamps?: LampInstance[];
		objects?: SceneObject[];
		floorplan?: FloorPlanPlacement | null;
		image?: FloorPlanImage | null;
		roomZ?: number;
		/** Every action call as [name, ...args], in order. */
		calls?: unknown[][];
		zones?: CalcZone[];
		/** Receives the controller, so a test can drive what the editor panel will. */
		onController?: (ctl: PlanController) => void;
	}

	let {
		context = 'outline',
		readonly = false,
		vertices = [[0, 0], [6, 0], [6, 4], [0, 4]],
		units = 'meters',
		precision = 1,
		lamps = [],
		objects = [],
		floorplan = null,
		image = null,
		roomZ = 2.7,
		calls = [],
		zones = [],
		onController = () => {},
	}: Props = $props();

	// svelte-ignore state_referenced_locally
	let scene = $state({ vertices, units, objects, floorplan, image, lamps, zones });
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
		addPlacedLamp: async (fixture, mode) => {
			const id = `lamp-${nextId++}`;
			calls.push(['addPlacedLamp', fixture, mode]);
			const x = 1 + scene.lamps.length, y = 1;
			scene.lamps = [...scene.lamps, { lamp_type: 'krcl_222', preset_id: fixture.replace(/^preset:/, ''), has_ies_file: true, scaling_factor: 1, enabled: true, x, y, z: 2.5, aimx: x, aimy: y, aimz: 0, id, name: `Lamp ${scene.lamps.length + 1}` } as LampInstance];
			return id;
		},
		copyLamps: async (ids, dx, dy) => {
			calls.push(['copyLamps', ids, dx, dy]);
			return ids.map((srcId) => {
				const id = `lamp-${nextId++}`;
				const src = scene.lamps.find((l) => l.id === srcId)!;
				scene.lamps = [...scene.lamps, { ...src, id, x: src.x + dx, y: src.y + dy, aimx: src.aimx + dx, aimy: src.aimy + dy }];
				return id;
			});
		},
		addLamp: async (x, y, likeId) => {
			const id = `lamp-${nextId++}`;
			calls.push(['addLamp', x, y, likeId]);
			const like = likeId ? scene.lamps.find((l) => l.id === likeId) : undefined;
			const base = like ?? { lamp_type: 'krcl_222', preset_id: 'beacon', z: 2.5, aimz: 0, scaling_factor: 1, enabled: true, aimx: x, aimy: y, x, y };
			const lamp = { ...base, id, name: `Lamp ${scene.lamps.length + 1}`, x, y, aimx: x + (base.aimx - base.x), aimy: y + (base.aimy - base.y) } as LampInstance;
			scene.lamps = [...scene.lamps, lamp];
			return id;
		},
		updateLamp: (id, partial) => {
			calls.push(['updateLamp', id, partial]);
			scene.lamps = scene.lamps.map((l) => (l.id === id ? { ...l, ...partial } : l));
		},
		removeLamp: (id) => {
			calls.push(['removeLamp', id]);
			scene.lamps = scene.lamps.filter((l) => l.id !== id);
		},
		addZone: async (type, geometry) => {
			const id = `zone-${nextId++}`;
			calls.push(['addZone', type, geometry]);
			scene.zones = [...scene.zones, { id, name: `Zone ${scene.zones.length + 1}`, type, enabled: true, ref_surface: 'xy', height: 0, z: 1, aim_z: 2, ...geometry } as CalcZone];
			return id;
		},
		updateZone: (id, partial) => {
			calls.push(['updateZone', id, partial]);
			scene.zones = scene.zones.map((z) => (z.id === id ? { ...z, ...partial } : z));
		},
		removeZone: (id) => {
			calls.push(['removeZone', id]);
			scene.zones = scene.zones.filter((z) => z.id !== id);
		},
		copyZone: async (id, dx, dy) => {
			calls.push(['copyZone', id, dx, dy]);
			const src = scene.zones.find((z) => z.id === id)!;
			const newId = `zone-${nextId++}`;
			scene.zones = [...scene.zones, { ...src, id: newId }];
			return newId;
		},
		changeUnits: (u) => {
			calls.push(['changeUnits', u]);
			const f = lengthFactor(scene.units, u);
			scene.vertices = scene.vertices.map(([x, y]) => [x * f, y * f] as Vertex);
			scene.units = u;
		},
		updateRoom: (partial) => {
			calls.push(['updateRoom', partial]);
		},
		setHidden: (kind, id, hidden) => {
			calls.push(['setHidden', kind, id, hidden]);
		},
	};

	// Getters keep each derived value on the field it reads, not the whole scene.
	const sceneView: PlanScene = {
		get vertices() { return scene.vertices; },
		get units() { return scene.units; },
		get precision() { return precision; },
		get lamps() { return scene.lamps; },
		get objects() { return scene.objects; },
		get zones() { return scene.zones; },
		get floorplan() { return scene.floorplan; },
		get image() { return scene.image; },
		get roomZ() { return roomZ; },
		fixtures: [],
		room: {} as RoomConfig,
		hidden: { lamps: new Set(), zones: new Set(), objects: new Set() },
	};

	// svelte-ignore state_referenced_locally
	const ctl = new PlanController({ actions, scene: () => sceneView });
	// svelte-ignore state_referenced_locally
	ctl.setContext(context);
	// svelte-ignore state_referenced_locally
	onController(ctl);
</script>

<PlanPane controller={ctl} {readonly} />
