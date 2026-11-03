<script lang="ts">
	// The edit tools for the current context, as text buttons. On the desktop it
	// sits bottom-left of the main view, also while 3D is main: tools that work
	// on the 2D canvas bring the 2D view up first; Copy and Delete act on the
	// selection in either view. On a phone it sits bottom-left of the pinned 2D view, scrolling sideways.
	// Shapes (structures, zones, keep-out areas) go PowerPoint style: with nothing
	// selected, Rectangle and Polygon draw a new one; with one selected, Edit
	// corners, Rotate 90°, Copy and Delete; while its corners are edited, Done.
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
		/** The way out of a mode (Done): filled in the selection colour. */
		primary?: boolean;
	}

	const COPY = 'Copy (Ctrl+D)';
	const DELETE = 'Delete (Del)';

	/** Rectangle and Polygon: draw a new shape (again, or Escape, cancels). */
	function newShapeTools(disabled = false): Tool[] {
		const draw = (shape: DrawShape, label: string, glyph: GlyphName): Tool => ({
			label,
			glyph,
			onclick: () => ctl.startShapeDraw(shape),
			disabled: disabled && !ctl.drawing,
			pressed: ctl.drawing && ctl.drawShape === shape
		});
		return [draw('rect', 'Rectangle', 'rect'), draw('polygon', 'Polygon', 'polygon')];
	}
	/** A selected shape's tools, or Done while its corners are edited. */
	function shapeTools(copy: () => void, remove: () => void, disabled = false): Tool[] {
		if (ctl.shapeMode === 'corners') {
			return [{ label: 'Done', glyph: 'check', title: 'Done (Esc)', onclick: ctl.endCorners, pressed: true, primary: true }];
		}
		return [
			{ label: 'Edit corners', glyph: 'corners', onclick: () => ctl.inCanvas(ctl.editCorners), disabled },
			{ label: 'Rotate 90°', glyph: 'rotate', onclick: ctl.rotateSelected90, disabled },
			{ label: 'Copy', glyph: 'copy', title: COPY, onclick: copy, disabled },
			{ label: 'Delete', glyph: 'trash', title: DELETE, onclick: remove, disabled }
		];
	}

	const tools = $derived.by<Tool[]>(() => {
		if (ctl.onOutline) {
			const list: Tool[] = [
				{ label: 'Draw', glyph: 'pen', onclick: () => (ctl.drawing ? ctl.cancelDraw() : ctl.requestNewOutline()), pressed: ctl.drawing },
				{ label: 'Edit corners', glyph: 'corners', onclick: () => ctl.inCanvas(() => ctl.toggleTool('corners')), disabled: ctl.drawing, pressed: ctl.activeTool === 'corners' }
			];
			if (ctl.hasImage) {
				list.push({ label: 'Move image', glyph: 'image', onclick: () => ctl.inCanvas(() => ctl.toggleTool('image')), disabled: ctl.drawing, pressed: ctl.activeTool === 'image' });
			}
			return list;
		}
		if (ctl.onObstacles) {
			if (ctl.drawing || !ctl.selected) return newShapeTools();
			return shapeTools(ctl.duplicateSelected, ctl.deleteSelected);
		}
		if (ctl.onLamps) {
			const none = !lamps.length || !ctl.liveLampIds.length;
			return [
				{ label: 'Move', glyph: 'move', title: 'Move (M)', onclick: () => ctl.inCanvas(() => ctl.toggleTool('move')), disabled: !lamps.length, pressed: ctl.activeTool === 'move' },
				{ label: 'Aim', glyph: 'aim', title: 'Aim (A)', onclick: () => ctl.inCanvas(() => ctl.toggleTool('aim')), disabled: !lamps.length, pressed: ctl.activeTool === 'aim' },
				{ label: 'Copy', glyph: 'copy', title: COPY, onclick: ctl.copySelectedLamps, disabled: none },
				{ label: 'Delete', glyph: 'trash', title: DELETE, onclick: ctl.deleteSelectedLamps, disabled: none }
			];
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
				list.push({ label: 'Move grid', glyph: 'tiles', onclick: () => ctl.inCanvas(() => ctl.toggleTool('grid')), pressed: ctl.activeTool === 'grid' });
			}
			return list;
		}
		if (ctl.onZones) {
			if (ctl.drawing || !ctl.selectedZone) return newShapeTools(ctl.placing);
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
				class:primary={t.primary}
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
	/* An armed tool: the scene's selection colour */
	.tool[aria-pressed='true'],
	.tool[aria-pressed='true']:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-scene-selected) 22%, transparent);
		border-color: var(--color-scene-selected);
		color: var(--color-text);
	}
	/* Done: filled in the selection colour, the way back to select mode */
	.tool.primary,
	.tool.primary:hover:not(:disabled) {
		background: var(--color-scene-selected);
		border-color: var(--color-scene-selected);
		color: #06202c;
		font-weight: 600;
	}
	.plan-toolbar.compact {
		flex-wrap: wrap;
		height: auto;
	}
	.plan-toolbar.compact .tool-label {
		display: none;
	}
</style>
