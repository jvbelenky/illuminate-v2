<script lang="ts">
	// The edit tools for the current context, as text buttons. On the desktop it
	// sits bottom-left of the main view, also while 3D is main: tools that work
	// on the 2D canvas bring the 2D view up first; Copy and Delete act on the
	// selection in either view. On a phone it sits bottom-left of the pinned 2D view, scrolling sideways.
	// Shapes (structures, zones, keep-out areas) go PowerPoint style: with one
	// selected, Edit vertices, Rotate 90°, Copy and Delete; while its vertices are
	// edited, Done. Structures and zones come from their Add cards, so with nothing
	// selected their strip is empty; keep-out areas still draw from Rectangle and Polygon.
	// The room outline on Floorplan is always in that box: Edit vertices, Rotate 90°
	// and Draw new outline (no Copy or Delete), then Done. Lamps and calc points:
	// Move, Aim, Copy and Delete.
	import Glyph, { type GlyphName } from '$lib/workspace/Glyph.svelte';
	import type { DrawShape, PlanController } from './planController.svelte';

	interface Props {
		controller: PlanController;
		/** Glyphs only (names stay as aria-label and title), wrapping if even that is too wide: the main view is too narrow for labels. */
		compact?: boolean;
	}

	let { controller, compact = false }: Props = $props();
	const ctl = $derived(controller);
	const lamps = $derived(ctl.scene().lamps);

	interface Tool {
		label: string;
		glyph: GlyphName;
		/** Title tooltip: the action and its shortcut. */
		title?: string;
		onclick: () => void;
		disabled?: boolean;
		/** A one-shot tool (or a drawing): armed until its gesture ends, exposed as aria-pressed. */
		pressed?: boolean;

	}

	const COPY = 'Copy (Ctrl+D)';
	const DELETE = 'Delete (Del)';

	/** Rectangle and Polygon: draw a new shape (again, or Escape, cancels). */
	function newShapeTools(disabled = false): Tool[] {
		const draw = (shape: DrawShape, label: string, glyph: GlyphName): Tool => ({
			label,
			glyph,
			title: ctl.drawing && ctl.drawShape === shape ? 'Cancel drawing (Esc)' : `Draw a ${label.toLowerCase()}`,
			onclick: () => ctl.startShapeDraw(shape),
			disabled: disabled && !ctl.drawing,
			pressed: ctl.drawing && ctl.drawShape === shape
		});
		return [draw('rect', 'Rectangle', 'rect'), draw('polygon', 'Polygon', 'polygon')];
	}
	const DONE: Tool = { label: 'Done', glyph: 'check', title: 'Done editing vertices (Esc)', onclick: () => ctl.endCorners(), pressed: true };
	/** Edit vertices and Rotate 90° for the shape in the box. */
	function boxTools(disabled = false): Tool[] {
		return [
			{ label: 'Edit vertices', glyph: 'corners', title: 'Drag, add or remove vertices', onclick: () => ctl.inCanvas(ctl.editCorners), disabled },
			{ label: 'Rotate 90°', glyph: 'rotate', title: 'Rotate 90° counter-clockwise', onclick: ctl.rotateSelected90, disabled }
		];
	}
	/** A selected shape's tools, or Done while its vertices are edited. */
	function shapeTools(copy: () => void, remove: () => void, disabled = false): Tool[] {
		if (ctl.shapeMode === 'corners') return [DONE];
		return [
			...boxTools(disabled),
			{ label: 'Copy', glyph: 'copy', title: COPY, onclick: copy, disabled },
			{ label: 'Delete', glyph: 'trash', title: DELETE, onclick: remove, disabled }
		];
	}

	/** A lamp's or a calc point's tools: Move and Aim (armed for the next drag), Copy and Delete. */
	function markerTools(copy: () => void, remove: () => void, armDisabled: boolean, actDisabled: boolean): Tool[] {
		return [
			{ label: 'Move', glyph: 'move', title: 'Move (M)', onclick: () => ctl.inCanvas(() => ctl.toggleTool('move')), disabled: armDisabled, pressed: ctl.activeTool === 'move' },
			{ label: 'Aim', glyph: 'aim', title: 'Aim (A)', onclick: () => ctl.inCanvas(() => ctl.toggleTool('aim')), disabled: armDisabled, pressed: ctl.activeTool === 'aim' },
			{ label: 'Copy', glyph: 'copy', title: COPY, onclick: copy, disabled: actDisabled },
			{ label: 'Delete', glyph: 'trash', title: DELETE, onclick: remove, disabled: actDisabled }
		];
	}

	const tools = $derived.by<Tool[]>(() => {
		if (ctl.onOutline) {
			if (ctl.outlineEditable && !ctl.drawing && ctl.shapeMode === 'corners') return [DONE];
			const draw: Tool = { label: 'Draw new outline', glyph: 'pen', title: ctl.drawing ? 'Cancel drawing (Esc)' : 'Draw a new room outline', onclick: () => (ctl.drawing ? ctl.cancelDraw() : ctl.requestNewOutline()), pressed: ctl.drawing };
			return ctl.outlineEditable && !ctl.drawing ? [...boxTools(), draw] : [draw];
		}
		if (ctl.onObstacles) {
			if (ctl.drawing) return newShapeTools();
			if (!ctl.selected) return [];
			return shapeTools(ctl.duplicateSelected, ctl.deleteSelected);
		}
		if (ctl.onLamps) {
			const none = !lamps.length || !ctl.liveLampIds.length;
			return markerTools(ctl.copySelectedLamps, ctl.deleteSelectedLamps, !lamps.length, none);
		}
		if (ctl.onCeiling) {
			if (!ctl.drawing && ctl.selectedCeilingItem) {
				if (ctl.editableKeepOut) return shapeTools(ctl.copySelectedCeilingItem, ctl.deleteSelectedCeilingItem);
				return [
					{ label: 'Copy', glyph: 'copy', title: COPY, onclick: ctl.copySelectedCeilingItem },
					{ label: 'Delete', glyph: 'trash', title: DELETE, onclick: ctl.deleteSelectedCeilingItem }
				];
			}
			const list = newShapeTools(ctl.ceilingFull);
			if (ctl.tilesActive && !ctl.drawing) {
				list.push({ label: 'Move grid', glyph: 'tiles', title: 'Drag the tile grid', onclick: () => ctl.inCanvas(() => ctl.toggleTool('grid')), pressed: ctl.activeTool === 'grid' });
			}
			return list;
		}
		if (ctl.onZones) {
			if (ctl.drawing) return newShapeTools(ctl.placing);
			if (!ctl.selectedZone) return [];
			// A calc point moves and aims as a lamp (a wall's view has no aim point)
			if (ctl.selectedPoint) {
				const list = markerTools(ctl.copySelectedZone, ctl.deleteSelectedZone, ctl.placing, ctl.placing);
				return ctl.onWall ? list.filter((t) => t.label !== 'Aim') : list;
			}
			if (ctl.zoneCornersEditable) return shapeTools(ctl.copySelectedZone, ctl.deleteSelectedZone, ctl.placing);
			return [
				{ label: 'Copy', glyph: 'copy', title: COPY, onclick: ctl.copySelectedZone, disabled: ctl.placing },
				{ label: 'Delete', glyph: 'trash', title: DELETE, onclick: ctl.deleteSelectedZone, disabled: ctl.placing }
			];
		}
		return [];
	});
</script>

{#if ctl.editStripShown && tools.length}
	<div class="mv-seg plan-toolbar" class:compact role="toolbar" aria-label="Edit">
		{#each tools as t (t.label)}
			<button
				type="button"
				class="mv-btn tool"

				aria-label={t.label}
				title={t.title ?? t.label}
				aria-pressed={t.pressed}
				disabled={t.disabled}
				onclick={t.onclick}
			>
				<Glyph name={t.glyph} />
				<span class="tool-label">{t.label}</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.tool {
		white-space: nowrap;
	}
	/* An armed tool, and Done (the way out of Edit vertices, a mode), wear the shared
	   pressed fill (.mv-btn[aria-pressed]), the category blue */
	.plan-toolbar.compact {
		flex-wrap: wrap;
		height: auto;
	}
	.plan-toolbar.compact .tool-label {
		display: none;
	}
</style>
