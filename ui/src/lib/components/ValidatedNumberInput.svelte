<script lang="ts">
	import { formatFloat } from '$lib/utils/formatting';

	interface Props {
		value: number;
		oncommit: (value: number) => void;
		integer?: boolean;
		min?: number;
		max?: number;
		step?: number | 'any';
		precision?: number;
		validate?: (value: number) => boolean;
		id?: string;
		placeholder?: string;
		disabled?: boolean;
		class?: string;
	}

	let {
		value,
		oncommit,
		integer = false,
		min,
		max,
		step = 'any',
		precision,
		validate,
		id,
		placeholder,
		disabled = false,
		class: className,
	}: Props = $props();

	// When precision is set, format the display value as a string
	// (type="text" so trailing zeros are preserved)
	const displayValue = $derived(
		precision != null ? formatFloat(value, precision) : undefined
	);

	function handleChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const raw = target.value;
		const parsed = integer ? parseInt(raw) : parseFloat(raw);

		if (!isFinite(parsed)) {
			target.value = displayValue ?? String(value);
			return;
		}
		if (integer && !Number.isInteger(parseFloat(raw))) {
			target.value = displayValue ?? String(value);
			return;
		}
		if (min !== undefined && parsed < min) {
			target.value = displayValue ?? String(value);
			return;
		}
		if (max !== undefined && parsed > max) {
			target.value = displayValue ?? String(value);
			return;
		}
		if (validate && !validate(parsed)) {
			target.value = displayValue ?? String(value);
			return;
		}

		oncommit(parsed);
	}
</script>

{#if precision != null}
	<input
		type="text"
		inputmode="decimal"
		value={displayValue}
		onchange={handleChange}
		{id}
		{placeholder}
		{disabled}
		class={className}
	/>
{:else}
	<input
		type="number"
		{value}
		onchange={handleChange}
		{id}
		{placeholder}
		{disabled}
		class={className}
		min={min !== undefined ? String(min) : undefined}
		max={max !== undefined ? String(max) : undefined}
		step={String(step)}
	/>
{/if}
