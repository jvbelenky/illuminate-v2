<script lang="ts">
	// Stand-in for PhotometricAxisPicker in unit tests: exposes the axis and
	// depth it was given and a button that picks "up".
	let { axis, depth, onAxisChange }: { axis: string; depth?: number; onAxisChange: (a: string) => void; [key: string]: unknown } = $props();
</script>

<div data-testid="picker-stub">
	<span data-testid="axis">{axis}</span>
	<span data-testid="depth">{depth ?? ''}</span>
	<button type="button" data-testid="pick-up" onclick={() => onAxisChange('up')}>up</button>
</div>
