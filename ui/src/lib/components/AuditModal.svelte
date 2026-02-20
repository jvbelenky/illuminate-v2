<script lang="ts">
	import { zones, results, room, lamps, project, stateHashes, lampsStale, roomStale, needsCalculation } from '$lib/stores/project';
	import type { Project, CalcZone, LampInstance, SafetyWarning, LampComplianceResult } from '$lib/types/project';
	import Modal from './Modal.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// Subscribe to full project for staleness detection
	let currentProject = $state<Project | null>(null);
	$effect(() => {
		const unsubscribe = project.subscribe(p => currentProject = p);
		return unsubscribe;
	});

	// Audit item types
	type AuditLevel = 'error' | 'warning' | 'info';
	type AuditCategory = 'geometry' | 'safety' | 'configuration' | 'staleness';

	interface AuditItem {
		level: AuditLevel;
		category: AuditCategory;
		message: string;
	}

	// Compute all audit items
	const auditItems = $derived.by(() => {
		const items: AuditItem[] = [];
		const r = $room;
		const lampList = $lamps;
		const zoneList = $zones;
		const res = $results;

		// --- No lamps check ---
		if (lampList.length === 0) {
			items.push({
				level: 'info',
				category: 'configuration',
				message: 'No lamps have been added to the project.'
			});
		}

		// NOTE: Lamp outside-room checks are handled by the backend's check_lamps
		// endpoint, which checks fixture bounding boxes (not just the source point).
		// Those warnings appear under the 'safety' category via checkLamps.warnings.

		// --- Zone geometry: outside room bounds ---
		for (const zone of zoneList) {
			if (zone.isStandard) continue;
			if (zone.enabled === false) continue;
			const issues: string[] = [];

			if (zone.type === 'plane') {
				if (zone.x1 !== undefined && zone.x1 < 0) issues.push('x1 < 0');
				if (zone.x2 !== undefined && zone.x2 > r.x) issues.push(`x2 > room width (${r.x})`);
				if (zone.y1 !== undefined && zone.y1 < 0) issues.push('y1 < 0');
				if (zone.y2 !== undefined && zone.y2 > r.y) issues.push(`y2 > room depth (${r.y})`);
				if (zone.height !== undefined && (zone.height < 0 || zone.height > r.z)) {
					issues.push(`height=${zone.height} outside room height`);
				}
			} else if (zone.type === 'volume') {
				if (zone.x_min !== undefined && zone.x_min < 0) issues.push('x_min < 0');
				if (zone.x_max !== undefined && zone.x_max > r.x) issues.push(`x_max > room width (${r.x})`);
				if (zone.y_min !== undefined && zone.y_min < 0) issues.push('y_min < 0');
				if (zone.y_max !== undefined && zone.y_max > r.y) issues.push(`y_max > room depth (${r.y})`);
				if (zone.z_min !== undefined && zone.z_min < 0) issues.push('z_min < 0');
				if (zone.z_max !== undefined && zone.z_max > r.z) issues.push(`z_max > room height (${r.z})`);
			}

			if (issues.length > 0) {
				items.push({
					level: 'warning',
					category: 'geometry',
					message: `${zone.name || zone.id} extends outside the room.`
				});
			}
		}

		// Build a lookup from lamp_id to user-facing name
		const lampNameById: Record<string, string> = {};
		for (const lamp of lampList) {
			lampNameById[lamp.id] = lamp.name || lamp.id;
		}

		// Also map backend lamp_name -> user-facing name via lamp_results
		const backendNameToUserName: Record<string, string> = {};
		if (res?.checkLamps?.lamp_results) {
			for (const [id, lr] of Object.entries(res.checkLamps.lamp_results)) {
				const result = lr as LampComplianceResult;
				const userName = lampNameById[result.lamp_id] || lampNameById[id];
				if (userName && result.lamp_name && result.lamp_name !== userName) {
					backendNameToUserName[result.lamp_name] = userName;
				}
			}
		}

		// Replace backend lamp names in a warning message with user-facing names
		function rewriteLampNames(msg: string): string {
			let result = msg;
			for (const [backendName, userName] of Object.entries(backendNameToUserName)) {
				result = result.replaceAll(backendName, userName);
			}
			return result;
		}

		// --- Safety warnings from checkLamps ---
		if (res?.checkLamps?.warnings) {
			for (const warning of res.checkLamps.warnings) {
				// Skip "zone not found" warnings when standard zones are intentionally disabled
				if (!r.useStandardZones && warning.message.includes('zone not found')) continue;
				items.push({
					level: warning.level === 'error' ? 'error' : warning.level === 'warning' ? 'warning' : 'info',
					category: 'safety',
					message: rewriteLampNames(warning.message)
				});
			}
		}

		// --- Missing spectrum ---
		if (res?.checkLamps?.lamp_results) {
			for (const lampResult of Object.values(res.checkLamps.lamp_results)) {
				const lr = lampResult as LampComplianceResult;
				if (lr.missing_spectrum) {
					const displayName = lampNameById[lr.lamp_id] || lr.lamp_name;
					items.push({
						level: 'warning',
						category: 'safety',
						message: `Lamp "${displayName}" is missing spectrum data. Safety calculations may be inaccurate.`
					});
				}
			}
		}

		// --- Stale results ---
		if ($needsCalculation && res) {
			const lampsChanged = $lampsStale;
			const roomChanged = $roomStale;
			// Check if any zone hashes changed
			const sh = $stateHashes;
			let zonesChanged = false;
			if (sh.current && sh.lastCalculated) {
				const currentZones = sh.current.calc_state.calc_zones;
				const lastZones = sh.lastCalculated.calc_state.calc_zones;
				for (const id of Object.keys(currentZones)) {
					if (currentZones[id] !== lastZones[id]) { zonesChanged = true; break; }
				}
				if (!zonesChanged) {
					for (const id of Object.keys(lastZones)) {
						if (!(id in currentZones)) { zonesChanged = true; break; }
					}
				}
			}

			if (lampsChanged || roomChanged || zonesChanged) {
				const changed: string[] = [];
				if (lampsChanged) changed.push('lamps');
				if (roomChanged) changed.push('room');
				if (zonesChanged) changed.push('zones');
				items.push({
					level: 'info',
					category: 'staleness',
					message: `Results are stale. The ${changed.join(', ')} ${changed.length === 1 ? 'has' : 'have'} changed since the last calculation.`
				});
			}
		}

		return items;
	});

	// Group items by category
	const categoryLabels: Record<AuditCategory, string> = {
		geometry: 'Geometry',
		safety: 'Safety',
		configuration: 'Configuration',
		staleness: 'Results'
	};

	const categoryOrder: AuditCategory[] = ['safety', 'geometry', 'configuration', 'staleness'];

	const groupedItems = $derived.by(() => {
		const groups: { category: AuditCategory; label: string; items: AuditItem[] }[] = [];
		for (const cat of categoryOrder) {
			const catItems = auditItems.filter(i => i.category === cat);
			if (catItems.length > 0) {
				groups.push({ category: cat, label: categoryLabels[cat], items: catItems });
			}
		}
		return groups;
	});

	// Summary counts
	const errorCount = $derived(auditItems.filter(i => i.level === 'error').length);
	const warningCount = $derived(auditItems.filter(i => i.level === 'warning').length);
	const infoCount = $derived(auditItems.filter(i => i.level === 'info').length);
</script>

<Modal
	title="Design Audit"
	{onClose}
	maxWidth="600px"
>
	{#snippet body()}
		<div class="modal-body">
			{#if auditItems.length === 0}
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
						<h3 class="section-title">{group.label}</h3>
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
									<span class="audit-message">{item.message}</span>
								</div>
							{/each}
						</div>
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

	.section-title {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--spacing-xs) 0;
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
</style>
