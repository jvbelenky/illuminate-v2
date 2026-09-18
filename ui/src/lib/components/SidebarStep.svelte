<script lang="ts">
	import type { Snippet } from 'svelte';

	export type StepStatus = 'done' | 'attention' | 'idle';

	interface Props {
		/** Step number; omitted for unnumbered (optional) sections. */
		number?: number;
		title: string;
		/** One-line summary shown while collapsed. */
		summary?: string;
		status?: StepStatus;
		open?: boolean;
		/** Expert layout: no number, always open, no chevron. */
		flat?: boolean;
		/** Hook for tests and scrolling. */
		id?: string;
		headerExtra?: Snippet;
		children: Snippet;
	}

	let {
		number,
		title,
		summary,
		status = 'idle',
		open = $bindable(true),
		flat = false,
		id,
		headerExtra,
		children
	}: Props = $props();

	const isOpen = $derived(flat || open);

	function toggle() {
		if (flat) return;
		open = !open;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			toggle();
		}
	}
</script>

<section class="step" class:open={isOpen} class:flat class:attention={status === 'attention'} data-step={id}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="panel-header step-header"
		class:clickable={!flat}
		role={flat ? undefined : 'button'}
		tabindex={flat ? undefined : 0}
		aria-expanded={flat ? undefined : isOpen}
		onclick={toggle}
		onkeydown={onKey}
	>
		{#if number != null && !flat}
			<span class="step-number" class:done={status === 'done'} class:attention={status === 'attention'} aria-hidden="true">
				{#if status === 'done'}
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
				{:else}
					{number}
				{/if}
			</span>
		{/if}
		<div class="step-text">
			<h3 class="step-title mb-0">{title}</h3>
			{#if summary && !isOpen}
				<span class="step-summary">{summary}</span>
			{/if}
		</div>
		{@render headerExtra?.()}
		{#if !flat}
			<svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
		{/if}
	</div>
	{#if isOpen}
		<div class="panel-content step-body">
			{@render children()}
		</div>
	{/if}
</section>

<style>
	.step {
		padding: var(--spacing-sm) 0;
		border-bottom: 1px solid var(--color-border);
	}
	.step:last-child {
		border-bottom: none;
	}

	.step-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin: 0;
		padding: var(--spacing-xs) 0;
		border: none;
		background: none;
		color: inherit;
		text-align: left;
		min-height: 32px;
	}
	.step-header.clickable {
		cursor: pointer;
		border-radius: var(--radius-sm);
	}
	.step-header.clickable:hover .step-title {
		color: var(--color-primary);
	}

	.step-number {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		flex-shrink: 0;
		font-size: var(--font-size-sm);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.step-number.done {
		background: color-mix(in srgb, var(--color-success) 18%, transparent);
		border-color: color-mix(in srgb, var(--color-success) 50%, transparent);
		color: var(--color-success);
	}
	.step-number.attention {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
	}

	.step-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.step-title {
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.2;
		transition: color 0.15s;
	}
	.step-summary {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chevron {
		flex-shrink: 0;
		color: var(--color-text-muted);
		transition: transform 0.15s;
	}
	.step.open .chevron {
		transform: rotate(180deg);
	}

	.step-body {
		padding: var(--spacing-sm) 0 var(--spacing-xs) 0;
	}
	.step:not(.flat) .step-body {
		padding-left: calc(22px + var(--spacing-sm));
	}
	.step.flat .step-body {
		padding-top: var(--spacing-xs);
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron, .step-title {
			transition: none;
		}
	}
</style>
