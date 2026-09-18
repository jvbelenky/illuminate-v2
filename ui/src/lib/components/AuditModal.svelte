<script lang="ts">
	import { project, room, stateHashes } from '$lib/stores/project';
	import { auditItems, positionWarnings, refreshPositionWarnings, type AuditCategory, type AuditItem } from '$lib/stores/audit';
	import { nudgeIntoBounds } from '$lib/api/client';
	import Modal from './Modal.svelte';

	interface Props {
		onClose: () => void;
		onOpenAdvancedSettings?: (lampId: string) => void;
	}

	let { onClose, onOpenAdvancedSettings }: Props = $props();

	// Position warnings live in the shared audit store; refresh them when the
	// modal opens so a stale list from an earlier check never shows.
	let fixingPositions = $state(false);

	$effect(() => {
		refreshPositionWarnings();
	});

	async function handleFixPositions() {
		fixingPositions = true;
		try {
			const result = await nudgeIntoBounds();

			// Update lamp positions in store (without triggering re-sync)
			for (const lamp of result.lamps) {
				project.updateLampFromAdvanced(lamp.id, {
					x: lamp.x, y: lamp.y, z: lamp.z,
					aimx: lamp.aimx, aimy: lamp.aimy, aimz: lamp.aimz,
				});
			}

			// Update zone positions in store
			for (const zone of result.zones) {
				if (zone.type === 'plane') {
					project.updateZoneFromBackend(zone.id, {
						x1: zone.x1 ?? undefined,
						x2: zone.x2 ?? undefined,
						y1: zone.y1 ?? undefined,
						y2: zone.y2 ?? undefined,
						height: zone.height ?? undefined,
					});
				} else if (zone.type === 'point') {
					project.updateZoneFromBackend(zone.id, {
						x: zone.x ?? undefined,
						y: zone.y ?? undefined,
						z: zone.z ?? undefined,
						aim_x: zone.aim_x ?? undefined,
						aim_y: zone.aim_y ?? undefined,
						aim_z: zone.aim_z ?? undefined,
					});
				} else {
					project.updateZoneFromBackend(zone.id, {
						x_min: zone.x1 ?? undefined,
						x_max: zone.x2 ?? undefined,
						y_min: zone.y1 ?? undefined,
						y_max: zone.y2 ?? undefined,
						z_min: zone.z_min ?? undefined,
						z_max: zone.z_max ?? undefined,
					});
				}
			}

			// Update object positions in store (base-centre moved into the room)
			for (const obj of result.objects ?? []) {
				project.updateObjectFromBackend(obj.id, { x: obj.x, y: obj.y, z: obj.z });
			}

			// Update state hashes
			if (result.state_hashes) {
				stateHashes.update(sh => ({ ...sh, current: result.state_hashes! }));
			}

			await refreshPositionWarnings();
		} catch (err) {
			console.error('Failed to fix positions:', err);
		} finally {
			fixingPositions = false;
		}
	}

	// Group items by category
	const categoryLabels: Record<AuditCategory, string> = {
		design: 'Design',
		safety: 'Safety',
		configuration: 'Configuration',
		staleness: 'Results'
	};

	const categoryOrder: AuditCategory[] = ['safety', 'design', 'configuration', 'staleness'];

	// Categories that always show (with "no issues" fallback when empty)
	const alwaysShowCategories: Set<AuditCategory> = $derived(
		$room.useStandardZones ? new Set(['safety', 'design']) : new Set(['design'])
	);

	const groupedItems = $derived.by(() => {
		const groups: { category: AuditCategory; label: string; items: AuditItem[] }[] = [];
		for (const cat of categoryOrder) {
			const catItems = $auditItems.filter(i => i.category === cat);
			if (catItems.length > 0 || alwaysShowCategories.has(cat)) {
				groups.push({ category: cat, label: categoryLabels[cat], items: catItems });
			}
		}
		return groups;
	});

	// Summary counts
	const errorCount = $derived($auditItems.filter(i => i.level === 'error').length);
	const warningCount = $derived($auditItems.filter(i => i.level === 'warning').length);
	const infoCount = $derived($auditItems.filter(i => i.level === 'info').length);
</script>

<Modal
	title="Design Audit"
	{onClose}
	maxWidth="600px"
>
	{#snippet body()}
		<div class="modal-body">
			{#if $auditItems.length === 0}
				<div class="no-issues">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
						<polyline points="22 4 12 14.01 9 11.01"/>
					</svg>
					<p>No issues found</p>
				</div>
			{:else}
				<div class="summary-bar">
					{#if errorCount > 0}
						<span class="summary-count error">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
					{/if}
					{#if warningCount > 0}
						<span class="summary-count warning">{warningCount} warning{warningCount !== 1 ? 's' : ''}</span>
					{/if}
					{#if infoCount > 0}
						<span class="summary-count info">{infoCount} info</span>
					{/if}
				</div>

				{#each groupedItems as group}
					<section class="audit-section">
						<div class="section-header">
							<h3 class="section-title">{group.label}</h3>
							{#if group.category === 'design' && $positionWarnings.length > 0}
								<button
									class="fix-positions-btn"
									onclick={handleFixPositions}
									disabled={fixingPositions}
								>
									{fixingPositions ? 'Fixing...' : 'Fix Positions'}
								</button>
							{/if}
						</div>
						{#if group.items.length === 0}
							<div class="section-no-issues">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
									<polyline points="22 4 12 14.01 9 11.01"/>
								</svg>
								<span>No issues</span>
							</div>
						{:else}
							<div class="audit-list">
								{#each group.items as item}
									<div class="audit-item level-{item.level}">
										<span class="audit-icon">
											{#if item.level === 'error'}
												<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<circle cx="12" cy="12" r="10"/>
													<line x1="15" y1="9" x2="9" y2="15"/>
													<line x1="9" y1="9" x2="15" y2="15"/>
												</svg>
											{:else if item.level === 'warning'}
												<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
													<line x1="12" y1="9" x2="12" y2="13"/>
													<line x1="12" y1="17" x2="12.01" y2="17"/>
												</svg>
											{:else}
												<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<circle cx="12" cy="12" r="10"/>
													<line x1="12" y1="16" x2="12" y2="12"/>
													<line x1="12" y1="8" x2="12.01" y2="8"/>
												</svg>
											{/if}
										</span>
										<div class="audit-message">
											{item.message}
											{#if item.lamp_id && onOpenAdvancedSettings && item.category === 'safety'}
												<button class="dim-settings-btn" onclick={() => onOpenAdvancedSettings(item.lamp_id!)}>
													Apply dim settings...
												</button>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</section>
				{/each}
			{/if}
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="modal-footer">
			<button type="button" class="close-footer-btn" onclick={onClose}>Close</button>
		</div>
	{/snippet}
</Modal>

<style>
	.modal-body {
		padding: var(--spacing-md);
		overflow-y: auto;
		flex: 1;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		padding: var(--spacing-sm) var(--spacing-md);
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.close-footer-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-md);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
	}

	.close-footer-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	/* No issues state */
	.no-issues {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-lg);
		color: var(--color-success);
	}

	.no-issues p {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	/* Summary bar */
	.summary-bar {
		display: flex;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
		padding-bottom: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
	}

	.summary-count {
		font-size: var(--font-size-sm);
		font-weight: 600;
		padding: 2px 8px;
		border-radius: var(--radius-sm);
	}

	.summary-count.error {
		background: color-mix(in srgb, var(--color-non-compliant) 15%, transparent);
		color: var(--color-non-compliant);
	}

	.summary-count.warning {
		background: color-mix(in srgb, var(--color-near-limit) 15%, transparent);
		color: var(--color-near-limit);
	}

	.summary-count.info {
		background: color-mix(in srgb, var(--color-info, var(--color-text-muted)) 15%, transparent);
		color: var(--color-info, var(--color-text-muted));
	}

	/* Sections */
	.audit-section {
		margin-bottom: var(--spacing-md);
	}

	.audit-section:last-child {
		margin-bottom: 0;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-xs);
	}

	.section-title {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0;
	}

	.fix-positions-btn {
		font-size: var(--font-size-xs);
		padding: 2px var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
	}

	.fix-positions-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.fix-positions-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Section-level no issues */
	.section-no-issues {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm);
		color: var(--color-success);
	}

	/* Audit items */
	.audit-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.audit-item {
		display: flex;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		line-height: 1.4;
		align-items: flex-start;
	}

	.audit-item.level-error {
		background: color-mix(in srgb, var(--color-non-compliant) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-non-compliant) 30%, transparent);
		color: var(--color-non-compliant);
	}

	.audit-item.level-warning {
		background: color-mix(in srgb, var(--color-near-limit) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-near-limit) 30%, transparent);
		color: var(--color-near-limit);
	}

	.audit-item.level-info {
		background: color-mix(in srgb, var(--color-info, var(--color-text-muted)) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-info, var(--color-text-muted)) 30%, transparent);
		color: var(--color-info, var(--color-text-muted));
	}

	.audit-icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		margin-top: 1px;
	}

	.audit-message {
		flex: 1;
	}

	.dim-settings-btn {
		display: block;
		margin-top: var(--spacing-xs);
		padding: 1px var(--spacing-sm);
		font-size: var(--font-size-xs);
		background: var(--color-bg);
		border: 1px solid currentColor;
		border-radius: var(--radius-sm);
		color: inherit;
		cursor: pointer;
		opacity: 0.7;
		transition: opacity 0.15s;
	}

	.dim-settings-btn:hover {
		opacity: 1;
	}
</style>
