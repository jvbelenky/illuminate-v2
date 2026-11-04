<script lang="ts">
	// The "Choose a fixture…" dropdown: built-in presets and the custom lamp
	// library, grouped, then "Add custom lamp…" (which opens the lamp manager
	// and leaves the selection as it was).
	import type { FixtureOption } from '$lib/utils/lampFixture';

	interface Props {
		fixtures: FixtureOption[];
		/** The chosen fixture's key ('' for none yet). */
		value: string;
		/** Options outside the list the current lamp may hold (an uploaded file, a preset not offered). */
		extra?: { value: string; label: string }[];
		onChoose: (key: string) => void;
		onAddCustom: () => void;
	}

	let { fixtures, value, extra = [], onChoose, onAddCustom }: Props = $props();

	const groups = $derived([...new Set(fixtures.map((f) => f.group))]);

	function change(select: HTMLSelectElement) {
		if (select.value === '__add_custom__') {
			select.value = value;
			onAddCustom();
			return;
		}
		if (select.value !== value) onChoose(select.value);
	}
</script>

<select class="fixture-select" class:unset={!value} {value} onchange={(e) => change(e.currentTarget)} aria-label="Fixture">
	<option value="" disabled>Choose a fixture…</option>
	{#each extra as o (o.value)}
		<option value={o.value}>{o.label}</option>
	{/each}
	{#each groups as g (g)}
		<optgroup label={g}>
			{#each fixtures.filter((f) => f.group === g) as f (f.key)}
				<option value={f.key}>{f.label}</option>
			{/each}
		</optgroup>
	{/each}
	<option value="__add_custom__">Add custom lamp…</option>
</select>

<style>
	.fixture-select.unset {
		border-color: var(--color-highlight);
	}
</style>
