<script lang="ts">
	// Stand-in for FixtureEditor in unit tests: exposes the draft and buttons that edit it.
	let { value, onchange }: { value: any; onchange: (v: any) => void; [key: string]: unknown } = $props();
</script>

<div data-testid="fixture-stub">
	<span data-testid="axis">{value.axis}</span>
	<span data-testid="face">{value.face}</span>
	<span data-testid="roll">{value.roll}</span>
	<span data-testid="offset">{value.offset.join(',')}</span>
	<button type="button" data-testid="pick-up" onclick={() => onchange({ ...value, axis: 'up' })}>up</button>
	<button type="button" data-testid="face-top" onclick={() => onchange({ ...value, face: 'top' })}>top</button>
	<button type="button" data-testid="face-left" onclick={() => onchange({ ...value, face: 'left' })}>left</button>
	<button type="button" data-testid="roll-90" onclick={() => onchange({ ...value, roll: 90 })}>roll</button>
	<button type="button" data-testid="protrude" onclick={() => onchange({ ...value, offset: [0, 0, -0.01] })}>protrude</button>
</div>
