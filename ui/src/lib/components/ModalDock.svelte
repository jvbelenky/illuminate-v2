<script lang="ts">
	import { getDockedModals, updateModal, type DockedModal } from '$lib/stores/modalDock.svelte';

	const modals = $derived(getDockedModals());
	const dockedModals = $derived(modals.filter(m => m.docked));
	const floatingModals = $derived(modals.filter(m => !m.docked));

	// --- Dragging ---
	let dragging: { id: string; startX: number; startY: number; originX: number; originY: number; wasDocked: boolean } | null = $state(null);
	let dragPos = $state({ x: 0, y: 0 });

	/** Bottom region of the viewport where dropping re-docks a floating tab */
	const DOCK_DROP_ZONE = 60;

	/** Whether a floating tab is currently hovering over the drop zone */
	let overDropZone = $state(false);
	/** Whether we're dragging a floating tab at all (to show the drop zone) */
	let draggingFloating = $state(false);

	function onTabPointerDown(e: PointerEvent, modal: DockedModal) {
		if ((e.target as HTMLElement).closest('.dock-tab-close, .dock-tab-restore, .resize-handle')) return;

		if (modal.docked) {
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			dragging = {
				id: modal.id,
				startX: e.clientX,
				startY: e.clientY,
				originX: rect.left,
				originY: rect.top,
				wasDocked: true
			};
			dragPos = { x: rect.left, y: rect.top };
		} else {
			dragging = {
				id: modal.id,
				startX: e.clientX,
				startY: e.clientY,
				originX: modal.x,
				originY: modal.y,
				wasDocked: false
			};
			dragPos = { x: modal.x, y: modal.y };
			draggingFloating = true;
		}
	}

	function onWindowPointerMove(e: PointerEvent) {
		if (resizing) {
			const dx = e.clientX - resizing.startX;
			const newWidth = Math.max(80, Math.min(400, resizing.startWidth + dx));
			updateModal(resizing.id, { width: newWidth });
			return;
		}
		if (!dragging) return;
		const dx = e.clientX - dragging.startX;
		const dy = e.clientY - dragging.startY;
		dragPos = { x: dragging.originX + dx, y: dragging.originY + dy };

		// If it was docked and moved enough, undock it
		if (dragging.wasDocked && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
			updateModal(dragging.id, { docked: false, x: dragPos.x, y: dragPos.y });
			dragging.wasDocked = false;
			draggingFloating = true;
		} else if (!dragging.wasDocked) {
			updateModal(dragging.id, { x: dragPos.x, y: dragPos.y });
		}

		// Track whether cursor is over the dock drop zone
		if (!dragging.wasDocked) {
			overDropZone = e.clientY > window.innerHeight - DOCK_DROP_ZONE;
		}
	}

	function onWindowPointerUp(e: PointerEvent) {
		if (resizing) {
			resizing = null;
			return;
		}
		if (!dragging) return;

		const modal = getModal(dragging.id);
		// If floating and cursor is near the bottom of the viewport, re-dock
		if (modal && !modal.docked && e.clientY > window.innerHeight - DOCK_DROP_ZONE) {
			updateModal(dragging.id, { docked: true, x: 0, y: 0 });
		}

		dragging = null;
		draggingFloating = false;
		overDropZone = false;
	}

	function getModal(id: string): DockedModal | undefined {
		return modals.find(m => m.id === id);
	}

	// --- Resizing ---
	let resizing: { id: string; startX: number; startWidth: number } | null = $state(null);

	function onResizePointerDown(e: PointerEvent, modal: DockedModal) {
		e.stopPropagation();
		resizing = { id: modal.id, startX: e.clientX, startWidth: modal.width };
	}

</script>

<!-- Window-level handlers for drag and resize (survive DOM element destruction) -->
<svelte:window onpointermove={onWindowPointerMove} onpointerup={onWindowPointerUp} />

<!-- Floating tabs -->
{#each floatingModals as modal (modal.id)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="dock-tab floating"
		style="left: {dragging?.id === modal.id ? dragPos.x : modal.x}px; top: {dragging?.id === modal.id ? dragPos.y : modal.y}px; width: {modal.width}px;"
		onpointerdown={(e) => onTabPointerDown(e, modal)}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<span class="dock-tab-title">{modal.title}</span>
		<button class="dock-tab-restore" onclick={modal.restore} title="Restore">
			<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
				<rect x="3" y="3" width="18" height="18" rx="2" />
			</svg>
		</button>
		<button class="dock-tab-close" onclick={modal.close} title="Close">
			<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
				<path d="M18 6L6 18M6 6l12 12"/>
			</svg>
		</button>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="resize-handle"
			onpointerdown={(e) => onResizePointerDown(e, modal)}
		></div>
	</div>
{/each}

<!-- Drop zone highlight when dragging a floating tab near the bottom -->
{#if draggingFloating}
	<div class="dock-drop-zone" class:active={overDropZone}></div>
{/if}

<!-- Dock bar -->
{#if modals.length > 0}
	<div class="modal-dock" class:has-tabs={dockedModals.length > 0}>
		{#each dockedModals as modal (modal.id)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="dock-tab"
				class:dragging-out={dragging?.id === modal.id && !modal.docked}
				style="width: {modal.width}px;"
				onpointerdown={(e) => onTabPointerDown(e, modal)}
			>
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<span class="dock-tab-title">{modal.title}</span>
				<button class="dock-tab-restore" onclick={modal.restore} title="Restore">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<rect x="3" y="3" width="18" height="18" rx="2" />
					</svg>
				</button>
				<button class="dock-tab-close" onclick={modal.close} title="Close">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<path d="M18 6L6 18M6 6l12 12"/>
					</svg>
				</button>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="resize-handle"
					onpointerdown={(e) => onResizePointerDown(e, modal)}
				></div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.dock-drop-zone {
		height: 2px;
		background: transparent;
		flex-shrink: 0;
		transition: all 0.15s;
	}

	.dock-drop-zone.active {
		height: 3px;
		background: var(--color-highlight);
		box-shadow: 0 0 6px var(--color-highlight);
	}

	.modal-dock {
		display: flex;
		gap: 1px;
		background: var(--color-border);
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-dock:not(.has-tabs) {
		display: none;
	}

	.dock-tab {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 18px 4px 10px;
		background: var(--color-bg);
		cursor: grab;
		min-width: 0;
		user-select: none;
		touch-action: none;
	}

	.dock-tab.dragging-out {
		opacity: 0.4;
	}

	.dock-tab.floating {
		position: fixed;
		z-index: 998;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		cursor: grab;
	}

	.dock-tab-title {
		font-size: 0.75rem;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.dock-tab-restore,
	.dock-tab-close {
		background: transparent;
		border: none;
		padding: 1px;
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 2px;
		flex-shrink: 0;
		transition: all 0.1s;
	}

	.dock-tab-restore:hover,
	.dock-tab-close:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.resize-handle {
		position: absolute;
		top: 0;
		right: 0;
		width: 6px;
		height: 100%;
		cursor: col-resize;
	}

	.resize-handle:hover {
		background: var(--color-border);
	}
</style>
