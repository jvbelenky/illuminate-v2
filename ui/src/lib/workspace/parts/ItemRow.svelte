<script lang="ts">
	// One item in an editor list: a lead mark, the name (renamed with the
	// pencil once the row is open), and the eye and calculator toggles. The open
	// row shows its editor beneath, passed in as children.
	import type { Snippet } from 'svelte';

	interface Props {
		id: string;
		name: string;
		subtitle?: string;
		italicSubtitle?: boolean;
		/** The row's editor is showing. */
		open: boolean;
		/** Several rows can be selected without any of them being open. */
		selected?: boolean;
		hidden: boolean;
		/** Included in calculations. */
		enabled: boolean;
		onToggleOpen: (event: MouseEvent) => void;
		onRename: (name: string) => void;
		onToggleHidden: () => void;
		onToggleEnabled: () => void;
		/** Wavelength dot or type icon. */
		lead?: Snippet;
		/** The open row's editor. */
		children?: Snippet;
	}

	let { id, name, subtitle, italicSubtitle = false, open, selected = false, hidden, enabled, onToggleOpen, onRename, onToggleHidden, onToggleEnabled, lead, children }: Props = $props();

	const label = $derived(name || id);

	let renaming = $state(false);
	let draft = $state('');
	// Enter and Esc end the edit first; the blur that follows must not save again
	let finished = false;

	function startRename() {
		draft = name;
		finished = false;
		renaming = true;
	}

	function finish(save: boolean) {
		if (finished) return;
		finished = true;
		renaming = false;
		const next = draft.trim();
		if (save && next && next !== name) onRename(next);
	}

	function onRenameKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			finish(true);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			finish(false);
		}
	}

	function focusAndSelect(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	// Closing the row ends a rename in progress
	$effect(() => {
		if (!open && renaming) finish(false);
	});
</script>

<div class="editor-row" class:open class:selected class:off={!enabled} data-id={id}>
	<div class="row-head">
		{#if renaming}
			<div class="row-main">
				{#if lead}<span class="lead">{@render lead()}</span>{/if}
				<input type="text" class="rename-input" bind:value={draft} onkeydown={onRenameKey} onblur={() => finish(true)} aria-label="Name" use:focusAndSelect />
			</div>
		{:else}
			<button type="button" class="row-main" aria-expanded={open} onclick={onToggleOpen}>
				{#if lead}<span class="lead">{@render lead()}</span>{/if}
				<span class="text">
					<span class="name">{label}</span>
					{#if subtitle}<span class="subtitle" class:italic={italicSubtitle}>{subtitle}</span>{/if}
				</span>
			</button>
			{#if open}
				<button type="button" class="rename" onclick={startRename} aria-label="Rename {label}" title="Rename">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
						<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
						<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
					</svg>
				</button>
			{/if}
		{/if}
		<button
			type="button"
			class="icon-toggle"
			class:pressed={!hidden}
			onclick={onToggleHidden}
			aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
			title={hidden ? 'Show' : 'Hide'}
		>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				{#if !hidden}
					<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
					<circle cx="12" cy="12" r="3" />
				{:else}
					<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
					<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
					<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
					<line x1="1" y1="1" x2="23" y2="23" />
				{/if}
			</svg>
		</button>
		<button
			type="button"
			class="icon-toggle"
			class:pressed={enabled}
			onclick={onToggleEnabled}
			aria-label={enabled ? `Exclude ${label} from calculations` : `Include ${label} in calculations`}
			title={enabled ? 'Exclude from calc' : 'Include in calc'}
		>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<rect x="4" y="2" width="16" height="20" rx="2" />
				<line x1="8" y1="6" x2="16" y2="6" />
				<line x1="8" y1="10" x2="10" y2="10" />
				<line x1="14" y1="10" x2="16" y2="10" />
				<line x1="8" y1="14" x2="10" y2="14" />
				<line x1="14" y1="14" x2="16" y2="14" />
				<line x1="8" y1="18" x2="10" y2="18" />
				<line x1="14" y1="18" x2="16" y2="18" />
				{#if !enabled}
					<line x1="1" y1="1" x2="23" y2="23" />
				{/if}
			</svg>
		</button>
	</div>
	{#if open && children}
		<div class="row-body">{@render children()}</div>
	{/if}
</div>

<style>
	.editor-row {
		display: flex;
		flex-direction: column;
		background: var(--color-bg-tertiary);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
	}
	.editor-row.open,
	.editor-row.selected {
		border-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 10%, var(--color-bg-tertiary));
	}
	.row-head {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px;
	}
	.row-main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		padding: 2px 0;
		background: none;
		border: none;
		color: var(--color-text);
		font-size: var(--font-size-base);
		text-align: left;
		cursor: pointer;
	}
	.lead {
		display: inline-flex;
		align-items: center;
		flex: none;
	}
	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.name,
	.subtitle {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.subtitle {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.subtitle.italic {
		font-style: italic;
	}
	.editor-row.off .text {
		opacity: 0.55;
	}
	.rename-input {
		flex: 1;
		min-width: 0;
		height: 1.6rem;
		padding: 0 6px;
		font-size: var(--font-size-base);
	}
	.rename,
	.icon-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 22px;
		height: 22px;
		padding: 0;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.rename {
		background: none;
		border-color: transparent;
	}
	.rename:hover,
	.icon-toggle:hover {
		color: var(--color-text);
	}
	.icon-toggle.pressed {
		background: color-mix(in srgb, var(--color-primary) 20%, var(--color-bg-secondary));
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
	.row-body {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) 8px 8px;
		border-top: 1px solid var(--color-border);
	}
</style>
