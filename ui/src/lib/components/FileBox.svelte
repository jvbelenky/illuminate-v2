<script lang="ts">
	// A lamp file (IES, spectrum) shown two ways: a one-line link row for the
	// overview cards, or a box for the detail pages (a dashed drop target when
	// empty). Picking a file is left to the caller's own hidden input.
	interface Props {
		name: string | null;
		badge: string;
		variant: 'link' | 'box';
		addLabel: string;
		emptyText?: string;
		onpick: () => void;
		onremove?: () => void;
		replaceTitle?: string;
		removeTitle?: string;
	}

	let { name, badge, variant, addLabel, emptyText, onpick, onremove, replaceTitle, removeTitle }: Props = $props();
</script>

{#if variant === 'link'}
	<div class="file-link">
		{#if name}
			<span class="badge">{badge}</span>
			<span class="name" title={name}>{name}</span>
			<button type="button" class="link-btn" title={replaceTitle} onclick={onpick}>Replace</button>
		{:else}
			{#if emptyText}<span class="muted">{emptyText}</span>{/if}
			<button type="button" class="link-btn" onclick={onpick}>{addLabel}</button>
		{/if}
	</div>
{:else if name}
	<div class="file-box">
		<span class="badge">{badge}</span>
		<span class="name" title={name}>{name}</span>
		<button type="button" class="link-btn" title={replaceTitle} onclick={onpick}>Replace</button>
		{#if onremove}
			<button type="button" class="link-btn" title={removeTitle} onclick={onremove}>Remove</button>
		{/if}
	</div>
{:else}
	<button type="button" class="dropzone" onclick={onpick}><span class="plus" aria-hidden="true">+</span>{addLabel}</button>
{/if}

<style>
	.file-link,
	.file-box {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		min-width: 0;
		font-size: var(--font-size-sm);
	}

	.file-box {
		gap: var(--spacing-sm);
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
	}

	.badge {
		flex: none;
		padding: 1px 5px;
		border-radius: 4px;
		font-size: 10px;
		font-weight: 700;
		color: var(--color-bg);
		background: var(--facet-color, var(--color-text-muted));
	}

	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-box .name {
		flex: 1;
	}

	.muted {
		color: var(--color-text-muted);
	}

	.link-btn {
		flex: none;
		width: auto;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-accent);
		font-size: var(--font-size-sm);
		text-decoration: underline;
		cursor: pointer;
	}

	.dropzone {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm);
		width: 100%;
		padding: 14px;
		border: 1.5px dashed var(--color-border);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text);
		font-size: var(--font-size-base);
		cursor: pointer;
		transition: border-color 120ms, background 120ms;
	}

	.dropzone:hover {
		border-color: var(--facet-color, var(--color-accent));
		background: color-mix(in srgb, var(--facet-color, var(--color-accent)) 8%, transparent);
	}

	.plus {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--facet-color, var(--color-accent)) 18%, transparent);
		color: var(--facet-color, var(--color-accent));
		font-weight: 700;
		line-height: 1;
	}
</style>
