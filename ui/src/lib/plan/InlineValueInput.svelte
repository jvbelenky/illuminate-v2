<script module lang="ts">
	/** One field of an inline input: its value as text, and an optional short label (X, Y, Z). */
	export interface InlineField {
		value: string;
		label?: string;
		/** Text fields (a name) are wider than number fields. */
		text?: boolean;
	}
</script>

<script lang="ts">
	// A small input opened in place over the 2D plan: a wall length, a corner's
	// X / Y, a lamp's X / Y / Z, a name. Enter applies, Escape cancels, Tab moves
	// between the fields, and focus leaving it applies (or cancels, for inputs
	// that a click on the canvas should simply close). A value the host refuses
	// keeps it open, marked invalid. It stays fully inside its positioned parent.
	import { onMount, untrack } from 'svelte';

	interface Props {
		fields: InlineField[];
		/** The anchor, in CSS pixels within the positioned parent; the input centres on it. */
		x: number;
		y: number;
		/** The group's name; each field is named "<ariaLabel> <label>" (or just ariaLabel when it is the only field). */
		ariaLabel: string;
		/** Return true when the values were applied (the host closes the input), false to mark them invalid. */
		onApply: (values: string[]) => boolean;
		onCancel: () => void;
		/** Focus leaving the input applies it; otherwise it cancels. */
		applyOnBlur?: boolean;
		/** Select the first field's text on opening; otherwise the caret goes to its end. */
		selectOnOpen?: boolean;
	}

	let { fields, x, y, ariaLabel, onApply, onCancel, applyOnBlur = true, selectOnOpen = true }: Props = $props();

	let values = $state<string[]>(untrack(() => fields.map((f) => f.value)));
	let invalid = $state(false);
	let wrap = $state<HTMLDivElement | undefined>(undefined);
	let inputs = $state<HTMLInputElement[]>([]);
	let closed = false;
	// Measured size of the input and of its parent, to keep it on screen
	let size = $state({ w: 0, h: 0, pw: 0, ph: 0 });

	const EDGE = 4;
	const left = $derived.by(() => {
		const l = x - size.w / 2;
		return size.pw > 0 ? Math.min(Math.max(l, EDGE), Math.max(EDGE, size.pw - size.w - EDGE)) : l;
	});
	const top = $derived.by(() => {
		const t = y - size.h / 2;
		return size.ph > 0 ? Math.min(Math.max(t, EDGE), Math.max(EDGE, size.ph - size.h - EDGE)) : t;
	});

	onMount(() => {
		const el = wrap;
		if (el) {
			const parent = el.offsetParent as HTMLElement | null;
			size = { w: el.offsetWidth, h: el.offsetHeight, pw: parent?.clientWidth ?? 0, ph: parent?.clientHeight ?? 0 };
		}
		const first = inputs[0];
		if (!first) return;
		first.focus();
		if (selectOnOpen) first.select();
		else first.setSelectionRange(first.value.length, first.value.length);
	});

	function apply() {
		if (closed) return;
		// Closed while the host applies: its refocus must not apply a second time
		closed = true;
		if (onApply(values.map((v) => v.trim()))) return;
		closed = false;
		invalid = true;
	}

	function cancel() {
		if (closed) return;
		closed = true;
		onCancel();
	}

	function onKeyDown(event: KeyboardEvent) {
		// Keys typed here are the input's own, never the plan's shortcuts
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			apply();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
		} else if (event.key === 'Tab' && inputs.length > 1) {
			event.preventDefault();
			const i = inputs.indexOf(event.target as HTMLInputElement);
			const next = inputs[(i + (event.shiftKey ? inputs.length - 1 : 1)) % inputs.length];
			next.focus();
			next.select();
		}
	}

	function onFocusOut(event: FocusEvent) {
		// Already applied or cancelled: the host's refocus is not a blur to act on
		if (closed) return;
		const to = event.relatedTarget as Node | null;
		if (to && wrap?.contains(to)) return;
		if (applyOnBlur) apply();
		else cancel();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={wrap}
	class="inline-input"
	class:multi={fields.length > 1}
	style="left: {left}px; top: {top}px"
	role="group"
	aria-label={ariaLabel}
	onkeydown={onKeyDown}
	onfocusout={onFocusOut}
	onpointerdown={(e) => e.stopPropagation()}
	ondblclick={(e) => e.stopPropagation()}
>
	{#each fields as f, i (i)}
		{#if f.label}<span class="field-label" aria-hidden="true">{f.label}</span>{/if}
		<input
			bind:this={inputs[i]}
			class:text={f.text}
			class:invalid
			type="text"
			autocomplete="off"
			spellcheck="false"
			aria-label={fields.length > 1 || f.label ? `${ariaLabel} ${f.label ?? i + 1}` : ariaLabel}
			aria-invalid={invalid}
			bind:value={values[i]}
			oninput={() => (invalid = false)}
		/>
	{/each}
</div>

<style>
	.inline-input {
		position: absolute;
		z-index: 6;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.inline-input.multi {
		padding: 3px 6px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
	}
	.field-label {
		font: 12px var(--font-mono, monospace);
		color: var(--color-text-muted);
	}
	.field-label:not(:first-child) {
		margin-left: 4px;
	}
	input {
		width: 9ch;
		padding: 3px 6px;
		font: 13px var(--font-mono, monospace);
		text-align: center;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		outline: none;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
	}
	.multi input {
		box-shadow: none;
		background: var(--color-bg-secondary);
	}
	input.text {
		width: 18ch;
		text-align: left;
		font-family: inherit;
	}
	input:focus {
		border-color: var(--color-scene-selected);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-scene-selected) 45%, transparent);
	}
	input.invalid {
		border-color: var(--color-error, #e5484d);
		background: color-mix(in srgb, var(--color-error, #e5484d) 14%, var(--color-bg));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-error, #e5484d) 40%, transparent);
	}
</style>
