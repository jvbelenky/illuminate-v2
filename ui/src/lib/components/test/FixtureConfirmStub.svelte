<script lang="ts">
	// Stand-in for FixtureConfirmDialog in unit tests: exposes its two answers.
	let { onaccept, onedit }: { onaccept: () => void; onedit: () => void; [key: string]: unknown } = $props();
</script>

<div data-testid="confirm-stub">
	<button type="button" data-testid="confirm-ok" onclick={onaccept}>ok</button>
	<button type="button" data-testid="confirm-edit" onclick={onedit}>edit</button>
</div>
