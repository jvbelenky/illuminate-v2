<script lang="ts">
	import { calculationProgress } from '$lib/stores/calculationProgress';

	const { progressPercent, timeRemaining } = calculationProgress;

	let isCalculating = $state(false);
	let progress = $state(0);
	let remaining = $state('');

	$effect(() => {
		const unsubscribe = calculationProgress.subscribe((state) => {
			isCalculating = state.isCalculating;
		});
		return unsubscribe;
	});

	$effect(() => {
		const unsubscribe = progressPercent.subscribe((value) => {
			progress = value;
		});
		return unsubscribe;
	});

	$effect(() => {
		const unsubscribe = timeRemaining.subscribe((value) => {
			remaining = value;
		});
		return unsubscribe;
	});
</script>

{#if isCalculating}
	<div class="progress-line">
		<div class="progress-fill" style="width: {progress}%"></div>
	</div>
{/if}

<style>
	.progress-line {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: var(--color-bg-tertiary);
		z-index: 1000;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent);
		transition: width 0.1s linear;
	}
</style>
