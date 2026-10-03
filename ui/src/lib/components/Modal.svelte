<script lang="ts">
	import type { Snippet } from 'svelte';
	import { autoFocus } from '$lib/actions/autoFocus';
	import { dockModal, undockModal } from '$lib/stores/modalDock.svelte';

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
		/** Stable ID for dock registration. If provided, callers can use restoreById() to restore this modal. */
		dockId?: string;
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
		titleFontSize,
		dockId
	}: Props = $props();

	// Unique ID for dock registration (use stable dockId if provided)
	const modalId = dockId ?? `modal-${Math.random().toString(36).slice(2, 9)}`;

	// Under 768 px a modal is a full-screen sheet: no backdrop margins, no
	// dragging or minimizing, a back button in the header, and the body scrolls.
	const MOBILE_QUERY = '(max-width: 767px)';
	let isMobile = $state(typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_QUERY).matches : false);
	$effect(() => {
		if (typeof window === 'undefined' || !window.matchMedia) return;
		const mq = window.matchMedia(MOBILE_QUERY);
		const update = () => { isMobile = mq.matches; };
		update();
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	});

	let minimized = $state(false);
	let offsetX = $state(0);
	let offsetY = $state(0);
	let isDragging = $state(false);
	let dragStartX = 0;
	let dragStartY = 0;
	let dragStartOffsetX = 0;
	let dragStartOffsetY = 0;
	let contentEl: HTMLDivElement;

	let mouseDownTarget: EventTarget | null = null;

	function handleBackdropMousedown(e: MouseEvent) {
		mouseDownTarget = e.target;
	}

	function handleBackdropClick(e: MouseEvent) {
		if (minimized) return;
		if (e.target === e.currentTarget && mouseDownTarget === e.currentTarget) {
			onClose();
		}
		mouseDownTarget = null;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (minimized) return;
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
		if (minimized) {
			offsetX = 0;
			offsetY = 0;
			dockModal({
				id: modalId,
				title,
				restore: () => toggleMinimize(),
				close: () => { undockModal(modalId); onClose(); }
			});
		} else {
			undockModal(modalId);
			requestAnimationFrame(() => clampToViewport());
		}
	}

	// Clean up dock registration if modal is closed while minimized
	$effect(() => {
		return () => undockModal(modalId);
	});

	// While a sheet is open the app's bottom bars (tab bar, calculate bar) get out
	// of the way: they live in a higher stacking context than the panel the
	// modal renders in, so z-index alone cannot put the sheet above them.
	$effect(() => {
		if (typeof document === 'undefined' || !isMobile || minimized) return;
		document.body.classList.add('sheet-open');
		return () => document.body.classList.remove('sheet-open');
	});

	function onPointerDown(e: PointerEvent) {
		if (!draggable || isMobile) return;
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
		if (isMobile) return '';
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

{#if minimized}
	<!-- Hidden container to preserve state when minimized -->
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
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-backdrop" class:sheet={isMobile} style="z-index: {isMobile ? Math.max(zIndex, 1200) : zIndex}" onmousedown={handleBackdropMousedown} onclick={handleBackdropClick}>
		<div
			class="modal-content {contentClass || ''}"
			class:sheet={isMobile}
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
				class:draggable={draggable && !isMobile}
				class:dragging={isDragging}
				onpointerdown={draggable && !isMobile ? onPointerDown : undefined}
				onpointermove={draggable && !isMobile ? onPointerMove : undefined}
				onpointerup={draggable && !isMobile ? onPointerUp : undefined}
			>
				{#if isMobile && showCloseButton}
					<button type="button" class="header-btn back-btn" onclick={onClose} title="Back" aria-label="Back">
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M15 18l-6-6 6-6"/>
						</svg>
					</button>
				{/if}
				<h2 class="modal-title" style="{titleStyle || ''}{titleFontSize ? `; font-size: ${titleFontSize}` : ''}">{title}</h2>
				{#if headerExtra}
					{@render headerExtra()}
				{/if}
				<div class="header-buttons">
					{#if minimizable && !isMobile}
						<button type="button" class="header-btn minimize-btn" onclick={toggleMinimize} title="Minimize">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
								<line x1="5" y1="12" x2="19" y2="12" />
							</svg>
						</button>
					{/if}
					{#if showCloseButton && !isMobile}
						<button type="button" class="header-btn close-btn" onclick={onClose} title="Close">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M18 6L6 18M6 6l12 12"/>
							</svg>
						</button>
					{/if}
				</div>
			</div>

			<div class="modal-body-scroll">
				{@render body()}
			</div>
			{#if footer}
				{@render footer()}
			{/if}
		</div>
	</div>
{/if}

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
		overflow: hidden;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
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

	/* Full-screen sheet on phones */
	.modal-backdrop.sheet {
		padding: 0;
		background: var(--color-bg);
		align-items: stretch;
		justify-content: stretch;
	}

	.modal-content.sheet {
		width: 100%;
		max-width: none;
		height: 100dvh;
		max-height: none;
		border: none;
		border-radius: 0;
		box-shadow: none;
		transform: none;
	}

	.modal-content.sheet .modal-header {
		padding: var(--spacing-sm);
		padding-top: calc(var(--spacing-sm) + env(safe-area-inset-top, 0px));
		min-height: 48px;
	}

	.modal-content.sheet .modal-title {
		font-size: 1.05rem;
		white-space: normal;
		line-height: 1.2;
	}

	.modal-content.sheet .modal-body-scroll {
		padding-bottom: env(safe-area-inset-bottom, 0px);
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
	}

	.back-btn {
		margin-right: var(--spacing-xs);
		padding: var(--spacing-xs);
	}

	.modal-body-scroll {
		overflow-y: auto;
		min-height: 0;
		flex: 1;
	}

	.modal-body-hidden {
		display: none;
	}

	.modal-footer-hidden {
		display: none;
	}
</style>
