<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		side: 'left' | 'right';
		defaultWidth?: number;
		minWidth?: number;
		maxWidth?: number;
		collapsed?: boolean;
		collapsedWidth?: number;
		children?: import('svelte').Snippet;
	}

	let {
		side,
		defaultWidth = 350,
		minWidth = 200,
		maxWidth = 600,
		collapsed = $bindable(false),
		collapsedWidth = 0,
		children
	}: Props = $props();

	let width = $state(defaultWidth);
	let isDragging = $state(false);
	let panelElement: HTMLElement;

	function startDrag(e: MouseEvent) {
		if (collapsed) return;
		isDragging = true;
		e.preventDefault();
		document.addEventListener('mousemove', onDrag);
		document.addEventListener('mouseup', stopDrag);
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	}

	function onDrag(e: MouseEvent) {
		if (!isDragging) return;

		let newWidth: number;
		if (side === 'left') {
			newWidth = e.clientX;
		} else {
			newWidth = window.innerWidth - e.clientX;
		}

		width = Math.max(minWidth, Math.min(maxWidth, newWidth));
	}

	function stopDrag() {
		isDragging = false;
		document.removeEventListener('mousemove', onDrag);
		document.removeEventListener('mouseup', stopDrag);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}

	function toggleCollapse() {
		collapsed = !collapsed;
	}

	// Compute actual width based on collapsed state
	let actualWidth = $derived(collapsed ? collapsedWidth : width);

	onMount(() => {
		return () => {
			document.removeEventListener('mousemove', onDrag);
			document.removeEventListener('mouseup', stopDrag);
		};
	});
</script>

<aside
	bind:this={panelElement}
	class="resizable-panel {side}"
	class:collapsed
	class:dragging={isDragging}
	style="--panel-width: {actualWidth}px;"
>
	{#if !collapsed}
		<div class="panel-content">
			{@render children?.()}
		</div>
	{/if}

	<!-- Resize handle -->
	<div
		class="resize-handle"
		onmousedown={startDrag}
		role="separator"
		aria-orientation="vertical"
		tabindex="0"
	></div>

	<!-- Collapse toggle button -->
	<button class="collapse-toggle" onclick={toggleCollapse} title={collapsed ? 'Expand panel' : 'Collapse panel'}>
		{#if side === 'left'}
			{collapsed ? '\u25B6' : '\u25C0'}
		{:else}
			{collapsed ? '\u25C0' : '\u25B6'}
		{/if}
	</button>
</aside>

<style>
	.resizable-panel {
		position: relative;
		width: var(--panel-width);
		min-width: var(--panel-width);
		max-width: var(--panel-width);
		min-height: 0;
		height: 100%;
		background: var(--color-bg);
		overflow: visible;
		transition: width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease;
		display: flex;
		flex-direction: column;
	}

	.resizable-panel.dragging {
		transition: none;
	}

	.resizable-panel.left {
		border-right: 1px solid var(--color-border);
	}

	.resizable-panel.right {
		border-left: 1px solid var(--color-border);
	}

	.resizable-panel.collapsed {
		width: 0;
		min-width: 0;
		max-width: 0;
	}

	.panel-content {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		padding: var(--spacing-md);
		min-height: 0;
		background: var(--color-bg);
	}

	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 6px;
		background: transparent;
		cursor: col-resize;
		z-index: 10;
		transition: background 0.15s;
	}

	.resizable-panel.left .resize-handle {
		right: -3px;
	}

	.resizable-panel.right .resize-handle {
		left: -3px;
	}

	.resize-handle:hover,
	.resizable-panel.dragging .resize-handle {
		background: var(--color-accent);
	}

	.resizable-panel.collapsed .resize-handle {
		display: none;
	}

	.collapse-toggle {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		width: 20px;
		height: 48px;
		padding: 0;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 0.65rem;
		cursor: pointer;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s, color 0.15s;
	}

	.collapse-toggle:hover {
		background: var(--color-accent);
		color: white;
	}

	.resizable-panel.left .collapse-toggle {
		right: -20px;
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		border-left: none;
	}

	.resizable-panel.right .collapse-toggle {
		left: -20px;
		border-radius: var(--radius-sm) 0 0 var(--radius-sm);
		border-right: none;
	}

	.resizable-panel.collapsed.left .collapse-toggle {
		right: auto;
		left: 0;
	}

	.resizable-panel.collapsed.right .collapse-toggle {
		left: auto;
		right: 0;
	}
</style>
