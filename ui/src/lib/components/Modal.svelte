<script lang="ts">
	import type { Snippet } from 'svelte';
	import { autoFocus } from '$lib/actions/autoFocus';

	interface Props {
		title: string;
		onClose: () => void;
		body: Snippet;
		footer?: Snippet;
		headerExtra?: Snippet;
		width?: string;
		maxWidth?: string;
		maxHeight?: string;
		zIndex?: number;
		minimizable?: boolean;
		draggable?: boolean;
		showCloseButton?: boolean;
		contentClass?: string;
		preserveOnMinimize?: boolean;
		onEscapeKey?: (e: KeyboardEvent) => boolean | void;
		titleStyle?: string;
		titleFontSize?: string;
	}

	let {
		title,
		onClose,
		body,
		footer,
		headerExtra,
		width,
		maxWidth,
		maxHeight = '90vh',
		zIndex = 1000,
		minimizable = true,
		draggable = true,
		showCloseButton = true,
		contentClass,
		preserveOnMinimize = false,
		onEscapeKey,
		titleStyle,
		titleFontSize
	}: Props = $props();

	let minimized = $state(false);
	let offsetX = $state(0);
	let offsetY = $state(0);
	let isDragging = $state(false);
	let dragStartX = 0;
	let dragStartY = 0;
	let dragStartOffsetX = 0;
	let dragStartOffsetY = 0;
	let contentEl: HTMLDivElement;

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (onEscapeKey) {
				const handled = onEscapeKey(e);
				if (handled === true) return;
			}
			onClose();
		}
	}

	function toggleMinimize() {
		minimized = !minimized;
	}

	function onPointerDown(e: PointerEvent) {
		if (!draggable) return;
		// Don't start drag on button clicks
		if ((e.target as HTMLElement).closest('button')) return;

		isDragging = true;
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		dragStartOffsetX = offsetX;
		dragStartOffsetY = offsetY;

		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		offsetX = dragStartOffsetX + (e.clientX - dragStartX);
		offsetY = dragStartOffsetY + (e.clientY - dragStartY);
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		clampToViewport();
	}

	function clampToViewport() {
		if (!contentEl) return;
		const rect = contentEl.getBoundingClientRect();
		const headerHeight = 40; // approximate min header height
		const margin = 8;

		// Ensure the header stays within the viewport
		if (rect.left < margin) {
			offsetX += margin - rect.left;
		} else if (rect.right > window.innerWidth - margin) {
			offsetX -= rect.right - window.innerWidth + margin;
		}

		if (rect.top < margin) {
			offsetY += margin - rect.top;
		} else if (rect.top + headerHeight > window.innerHeight - margin) {
			offsetY -= (rect.top + headerHeight) - window.innerHeight + margin;
		}
	}

	// Re-clamp on window resize
	function onWindowResize() {
		if (offsetX !== 0 || offsetY !== 0) {
			clampToViewport();
		}
	}

	const contentStyle = $derived.by(() => {
		const parts: string[] = [];
		if (width) parts.push(`width: ${width}`);
		if (maxWidth) parts.push(`max-width: ${maxWidth}`);
		if (!minimized) parts.push(`max-height: ${maxHeight}`);
		if (offsetX !== 0 || offsetY !== 0) {
			parts.push(`transform: translate(${offsetX}px, ${offsetY}px)`);
		}
		return parts.join('; ');
	});
</script>

<svelte:window onkeydown={handleKeydown} onresize={onWindowResize} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" style="z-index: {zIndex}" onclick={handleBackdropClick}>
	<div
		class="modal-content {contentClass || ''}"
		class:minimized
		role="dialog"
		aria-modal="true"
		aria-label={title}
		style={contentStyle}
		bind:this={contentEl}
		use:autoFocus
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="modal-header"
			class:draggable
			class:dragging={isDragging}
			onpointerdown={draggable ? onPointerDown : undefined}
			onpointermove={draggable ? onPointerMove : undefined}
			onpointerup={draggable ? onPointerUp : undefined}
		>
			<h2 class="modal-title" style="{titleStyle || ''}{titleFontSize ? `; font-size: ${titleFontSize}` : ''}">{title}</h2>
			{#if headerExtra}
				{@render headerExtra()}
			{/if}
			<div class="header-buttons">
				{#if minimizable}
					<button type="button" class="header-btn minimize-btn" onclick={toggleMinimize} title={minimized ? 'Restore' : 'Minimize'}>
						{#if minimized}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<rect x="3" y="3" width="18" height="18" rx="2" />
							</svg>
						{:else}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
								<line x1="5" y1="12" x2="19" y2="12" />
							</svg>
						{/if}
					</button>
				{/if}
				{#if showCloseButton}
					<button type="button" class="header-btn close-btn" onclick={onClose} title="Close">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M18 6L6 18M6 6l12 12"/>
						</svg>
					</button>
				{/if}
			</div>
		</div>

		{#if minimized}
			{#if preserveOnMinimize}
				<div class="modal-body-hidden">
					{@render body()}
				</div>
				{#if footer}
					<div class="modal-footer-hidden">
						{@render footer()}
					</div>
				{/if}
			{/if}
		{:else}
			{@render body()}
			{#if footer}
				{@render footer()}
			{/if}
		{/if}
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-md);
	}

	.modal-content {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		width: 90%;
		display: flex;
		flex-direction: column;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-content.minimized {
		max-height: none !important;
	}

	.modal-header {
		display: flex;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
		gap: var(--spacing-sm);
		user-select: none;
	}

	.modal-header.draggable {
		cursor: grab;
	}

	.modal-header.draggable.dragging {
		cursor: grabbing;
	}

	.modal-title {
		margin: 0;
		font-size: 1.25rem;
		color: var(--color-text);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.header-buttons {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.header-btn {
		background: transparent;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: all 0.15s;
	}

	.header-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.modal-body-hidden {
		display: none;
	}

	.modal-footer-hidden {
		display: none;
	}
</style>
