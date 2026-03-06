<script lang="ts">
	interface Props {
		value: number;
		oncommit: (value: number) => void;
		integer?: boolean;
		min?: number;
		max?: number;
		step?: number | 'any';
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
		validate,
		id,
		placeholder,
		disabled = false,
		class: className,
	}: Props = $props();

	function handleChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const raw = target.value;
		const parsed = integer ? parseInt(raw) : parseFloat(raw);

		if (!isFinite(parsed)) {
			target.value = String(value);
			return;
		}
		if (integer && !Number.isInteger(parseFloat(raw))) {
			target.value = String(value);
			return;
		}
		if (min !== undefined && parsed < min) {
			target.value = String(value);
			return;
		}
		if (max !== undefined && parsed > max) {
			target.value = String(value);
			return;
		}
		if (validate && !validate(parsed)) {
			target.value = String(value);
			return;
		}

		oncommit(parsed);
	}
</script>

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
