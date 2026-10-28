<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { DockPanelId } from './dockLayout';

	interface Props {
		id: DockPanelId;
		title: string;
		minimized: boolean;
		dragging?: boolean;
		onToggleMinimized: () => void;
		onSwap?: () => void;
		onBarPointerDown: (e: PointerEvent) => void;
		/** Compact action in the title bar while minimized. */
		barAction?: Snippet;
		/** Small icon buttons in the title bar, open or minimized. */
		tools?: Snippet;
		/** Pinned above the content while open. */
		top?: Snippet;
		children: Snippet;
	}

	let { id, title, minimized, dragging = false, onToggleMinimized, onSwap, onBarPointerDown, barAction, tools, top, children }: Props =
		$props();
</script>

<section class="dock-panel" class:minimized class:dragging data-panel={id}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="dock-bar" onpointerdown={onBarPointerDown}>
		<span class="dock-grip" aria-hidden="true">⋮⋮</span>
		<span class="dock-title">{title}</span>
		<span class="dock-spacer"></span>
		{#if minimized && barAction}{@render barAction()}{/if}
		{#if tools}{@render tools()}{/if}
		{#if onSwap}
			<button type="button" class="dock-btn" aria-label="Swap views" onclick={onSwap}>⇄</button>
		{/if}
		<button
			type="button"
			class="dock-btn"
			aria-label={minimized ? 'Restore' : 'Minimize'}
			onclick={onToggleMinimized}>{minimized ? '▢' : '–'}</button
		>
	</div>
	{#if !minimized}
		{#if top}<div class="dock-top">{@render top()}</div>{/if}
		<div class="dock-content">{@render children()}</div>
	{/if}
</section>

<style>
	.dock-panel {
		display: flex;
		flex-direction: column;
		flex: 1 1 0;
		min-height: 0;
		overflow: hidden;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.dock-panel[data-panel='mini']:not(.minimized) {
		flex: none;
		aspect-ratio: 4 / 3;
	}
	.dock-panel.minimized {
		flex: none;
	}
	.dock-panel.dragging {
		opacity: 0.35;
	}
	.dock-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
		height: 26px;
		padding: 0 6px;
		background: var(--color-bg-tertiary);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		cursor: grab;
		touch-action: none;
		user-select: none;
	}
	.dock-panel.minimized .dock-bar {
		border-bottom: 0;
	}
	.dock-grip {
		letter-spacing: -2px;
		opacity: 0.6;
	}
	.dock-title {
		color: var(--color-text);
		font-weight: 600;
		font-size: var(--font-size-xs);
	}
	.dock-spacer {
		flex: 1;
	}
	.dock-btn {
		width: 20px;
		height: 18px;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}
	.dock-btn:hover {
		background: var(--color-bg-input);
	}
	.dock-top {
		flex: none;
		padding: var(--spacing-md) var(--spacing-md) 0;
	}
	.dock-content {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
</style>
