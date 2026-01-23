<script lang="ts">
	import { formatValue } from '$lib/utils/formatting';
	import { OZONE_WARNING_THRESHOLD_PPB } from '$lib/constants/safety';

	interface Props {
		ozoneValue: number | null;
		airChanges: number;
		ozoneDecayConstant: number;
	}

	let { ozoneValue, airChanges, ozoneDecayConstant }: Props = $props();
</script>

<div class="ozone-inputs">
	<div class="input-row">
		<label>Air changes/hr</label>
		<span class="input-value">{airChanges}</span>
	</div>
	<div class="input-row">
		<label>Decay constant</label>
		<span class="input-value">{ozoneDecayConstant}</span>
	</div>
</div>

{#if ozoneValue !== null}
	<div class="summary-row">
		<span class="summary-label">Estimated O₃ Increase</span>
		<span class="summary-value" class:warning={ozoneValue > OZONE_WARNING_THRESHOLD_PPB} class:ok={ozoneValue <= OZONE_WARNING_THRESHOLD_PPB}>
			{formatValue(ozoneValue, 2)} ppb
		</span>
	</div>
	{#if ozoneValue > OZONE_WARNING_THRESHOLD_PPB}
		<p class="warning-text">Ozone increase exceeds {OZONE_WARNING_THRESHOLD_PPB} ppb threshold</p>
	{/if}
{/if}

<style>
	.ozone-inputs {
		display: flex;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-sm);
	}

	.input-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.input-row label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.input-value {
		font-family: var(--font-mono);
		font-size: 0.875rem;
	}

	.summary-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-xs) 0;
	}

	.summary-label {
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.summary-value {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		font-weight: 600;
	}

	.summary-value.warning {
		color: #dc2626;
	}

	.summary-value.ok {
		color: #3b82f6;
	}

	.warning-text {
		font-size: 0.75rem;
		color: #dc2626;
		margin: var(--spacing-xs) 0 0 0;
	}
</style>
