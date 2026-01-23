<script lang="ts">
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		skinMax: number | null | undefined;
		eyeMax: number | null | undefined;
		skinHoursToLimit: number | null;
		eyeHoursToLimit: number | null;
		skinCompliant: boolean;
		eyeCompliant: boolean;
		currentLimits: { skin: number; eye: number };
		standard: string;
	}

	let {
		skinMax,
		eyeMax,
		skinHoursToLimit,
		eyeHoursToLimit,
		skinCompliant,
		eyeCompliant,
		currentLimits,
		standard
	}: Props = $props();
</script>

<div class="safety-grid">
	{#if skinMax !== null && skinMax !== undefined}
		<div class="safety-column">
			<h5>Skin</h5>
			<div class="safety-stat">
				<span class="stat-label">Hours to TLV</span>
				<span class="stat-value" class:compliant={skinCompliant} class:non-compliant={!skinCompliant}>
					{#if skinHoursToLimit && skinHoursToLimit >= 8}
						Indefinite
					{:else if skinHoursToLimit}
						{formatValue(skinHoursToLimit, 1)} hrs
					{:else}
						—
					{/if}
				</span>
			</div>
			<div class="safety-stat">
				<span class="stat-label">Max 8hr Dose</span>
				<span class="stat-value">{formatValue(skinMax, 1)} mJ/cm²</span>
			</div>
			<div class="safety-stat">
				<span class="stat-label">TLV ({standard})</span>
				<span class="stat-value muted">{currentLimits.skin} mJ/cm²</span>
			</div>
		</div>
	{/if}

	{#if eyeMax !== null && eyeMax !== undefined}
		<div class="safety-column">
			<h5>Eye</h5>
			<div class="safety-stat">
				<span class="stat-label">Hours to TLV</span>
				<span class="stat-value" class:compliant={eyeCompliant} class:non-compliant={!eyeCompliant}>
					{#if eyeHoursToLimit && eyeHoursToLimit >= 8}
						Indefinite
					{:else if eyeHoursToLimit}
						{formatValue(eyeHoursToLimit, 1)} hrs
					{:else}
						—
					{/if}
				</span>
			</div>
			<div class="safety-stat">
				<span class="stat-label">Max 8hr Dose</span>
				<span class="stat-value">{formatValue(eyeMax, 1)} mJ/cm²</span>
			</div>
			<div class="safety-stat">
				<span class="stat-label">TLV ({standard})</span>
				<span class="stat-value muted">{currentLimits.eye} mJ/cm²</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.safety-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
	}

	.safety-column {
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
	}

	.safety-column h5 {
		margin: 0 0 var(--spacing-sm) 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.safety-stat {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		padding: 2px 0;
	}

	.safety-stat .stat-label {
		color: var(--color-text-muted);
	}

	.safety-stat .stat-value {
		font-family: var(--font-mono);
	}

	.safety-stat .stat-value.muted {
		color: var(--color-text-muted);
	}

	.safety-stat .stat-value.compliant {
		color: #3b82f6;
	}

	.safety-stat .stat-value.non-compliant {
		color: #dc2626;
	}
</style>
