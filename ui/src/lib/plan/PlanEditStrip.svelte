<script lang="ts">
	// The edit tools for the current context, as text buttons. On the desktop it
	// sits bottom-left of the main view, also while 3D is main: tools that work
	// on the 2D canvas bring the 2D view up first; Copy and Delete act on the
	// selection in either view. On a phone it sits under the plan canvas.
	import Glyph, { type GlyphName } from '$lib/workspace/Glyph.svelte';
	import type { PlanController } from './planController.svelte';

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
		/** A one-shot tool (or Draw): armed until its gesture ends, exposed as aria-pressed. */
		pressed?: boolean;
	}

	const COPY = 'Copy (Ctrl+D)';
	const DELETE = 'Delete (Del)';

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
			const none = !ctl.selected || ctl.drawing;
			return [
				{ label: 'Draw', glyph: 'pen', onclick: () => (ctl.drawing ? ctl.stopObstacleDraw() : ctl.startObstacleDraw()), pressed: ctl.drawing },
				{ label: 'Copy', glyph: 'copy', title: COPY, onclick: ctl.duplicateSelected, disabled: none },
				{ label: 'Delete', glyph: 'trash', title: DELETE, onclick: ctl.deleteSelected, disabled: none }
			];
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
			if (ctl.selectedCeilingItem) {
				return [
					{ label: 'Copy', glyph: 'copy', title: COPY, onclick: ctl.copySelectedCeilingItem, disabled: ctl.drawing },
					{ label: 'Delete', glyph: 'trash', title: DELETE, onclick: ctl.deleteSelectedCeilingItem, disabled: ctl.drawing }
				];
			}
			return [{ label: 'Move grid', glyph: 'tiles', onclick: () => ctl.inCanvas(() => ctl.toggleTool('grid')), pressed: ctl.activeTool === 'grid' }];
		}
		if (ctl.onZones) {
			const none = !ctl.selectedZone || ctl.placing || ctl.drawing;
			return [
				{ label: 'Draw', glyph: 'pen', onclick: () => (ctl.drawing ? ctl.canvas?.cancelDraw() : ctl.startZoneDraw('plane')), disabled: ctl.placing, pressed: ctl.drawing },
				{ label: 'Edit corners', glyph: 'corners', onclick: () => ctl.inCanvas(() => ctl.toggleTool('corners')), disabled: !ctl.zoneCornersEditable || ctl.placing || ctl.drawing, pressed: ctl.activeTool === 'corners' },
				{ label: 'Copy', glyph: 'copy', title: COPY, onclick: ctl.copySelectedZone, disabled: none },
				{ label: 'Delete', glyph: 'trash', title: DELETE, onclick: ctl.deleteSelectedZone, disabled: none }
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
	/* An armed tool: the scene's selection colour */
	.tool[aria-pressed='true'],
	.tool[aria-pressed='true']:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-scene-selected) 22%, transparent);
		border-color: var(--color-scene-selected);
		color: var(--color-text);
	}
	.plan-toolbar.compact {
		flex-wrap: wrap;
		height: auto;
	}
	.plan-toolbar.compact .tool-label {
		display: none;
	}
</style>
