<script lang="ts">
	// The 3D view's tools, bottom right of the view in the main view's 28 px
	// style: view presets (a 3x3 grid in a popover), projection, open in a new
	// window and save as image. `lead` goes first (the units select).
	import { tick, type Snippet } from 'svelte';
	import type { ViewPreset } from './ViewSnapOverlay.svelte';
	import { VIEW_PRESET_GRID } from './viewPresets';
	import { rovingTabindex } from '$lib/actions/rovingTabindex';
	import Glyph from '$lib/workspace/Glyph.svelte';

	interface Props {
		activeView: ViewPreset | null;
		onViewChange: (view: ViewPreset) => void;
		isOrtho: boolean;
		onToggleProjection: () => void;
		onOpen: () => void;
		onSave: () => void;
		saving: boolean;
		lead?: Snippet;
	}

	let { activeView, onViewChange, isOrtho, onToggleProjection, onOpen, onSave, saving, lead }: Props = $props();

	let presetsOpen = $state(false);
	let rootEl: HTMLElement | undefined = $state();
	let presetsButton: HTMLButtonElement | undefined = $state();

	function choose(view: ViewPreset) {
		onViewChange(view);
		presetsOpen = false;
		presetsButton?.focus();
	}

	// Opening the presets moves focus into the grid (the active preset, else the first)
	$effect(() => {
		if (!presetsOpen) return;
		tick().then(() => {
			const grid = rootEl?.querySelector('.presets');
			(grid?.querySelector<HTMLElement>('.preset.on') ?? grid?.querySelector<HTMLElement>('.preset'))?.focus();
		});
	});

	function onWindowPointerDown(e: PointerEvent) {
		if (presetsOpen && rootEl && !rootEl.contains(e.target as Node)) presetsOpen = false;
	}

	function onPopoverKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			presetsOpen = false;
			presetsButton?.focus();
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="view-tools-3d" bind:this={rootEl}>
	{@render lead?.()}
	<div class="mv-seg" role="group" aria-label="3D view">
		<button
			type="button"
			class="mv-btn"
			bind:this={presetsButton}
			aria-label="View presets"
			title="View presets"
			aria-expanded={presetsOpen}
			aria-haspopup="true"
			onclick={() => (presetsOpen = !presetsOpen)}
		>
			<Glyph name="views" />
		</button>
		<button
			type="button"
			class="mv-btn proj-toggle"
			aria-label={isOrtho ? 'Perspective' : 'Orthographic'}
			title={isOrtho ? 'Switch to perspective projection' : 'Switch to orthographic projection'}
			onclick={onToggleProjection}
		>
			<Glyph name={isOrtho ? 'ortho' : 'perspective'} />
		</button>
		<button type="button" class="mv-btn" aria-label="Open in new window" title="Open in new window" onclick={onOpen}>
			<Glyph name="external" />
		</button>
		<button type="button" class="mv-btn" aria-label="Save as image" title="Save as image" onclick={onSave} disabled={saving}>
			{#if saving}
				<span class="spinner" aria-hidden="true"></span>
			{:else}
				<Glyph name="download" />
			{/if}
		</button>
	</div>
	{#if presetsOpen}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="presets"
			role="group"
			aria-label="View presets"
			tabindex="-1"
			onkeydown={onPopoverKey}
			use:rovingTabindex={{ orientation: 'grid', columns: 3, selector: '.preset' }}
		>
			{#each VIEW_PRESET_GRID.flat() as cell (cell.id)}
				<button type="button" class="mv-btn preset" class:on={activeView === cell.id} title={cell.title} aria-label={cell.title} onclick={() => choose(cell.id)}>
					{cell.icon}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.view-tools-3d {
		position: absolute;
		right: 8px;
		bottom: 8px;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.presets {
		position: absolute;
		right: 0;
		bottom: 36px;
		display: grid;
		grid-template-columns: repeat(3, 28px);
		gap: 2px;
		padding: 4px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
	}
	.preset {
		min-width: 28px;
		padding: 0;
		font-size: 12px;
	}
	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
