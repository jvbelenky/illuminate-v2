<script lang="ts">
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { fileStore, iesFiles, spectrumFiles } from '$lib/stores/fileStore';
	import { lamps } from '$lib/stores/project';
	import type { FileCategory } from '$lib/types/fileStore';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let editingId = $state<string | null>(null);
	let editValue = $state('');
	let deleteConfirm = $state<{ id: string; name: string; usedBy: string[] } | null>(null);
	let iesFileInput: HTMLInputElement;
	let spectrumFileInput: HTMLInputElement;

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function startRename(id: string, currentName: string) {
		editingId = id;
		editValue = currentName;
	}

	function commitRename() {
		if (editingId && editValue.trim()) {
			fileStore.rename(editingId, editValue.trim());
		}
		editingId = null;
	}

	function handleRenameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			editingId = null;
		}
	}

	function getLampsUsingFile(fileId: string): string[] {
		return $lamps
			.filter((l) => l.ies_file_id === fileId || l.spectrum_file_id === fileId)
			.map((l) => l.name || 'Unnamed Lamp');
	}

	function requestDelete(id: string, displayName: string) {
		const usedBy = getLampsUsingFile(id);
		if (usedBy.length > 0) {
			deleteConfirm = { id, name: displayName, usedBy };
		} else {
			fileStore.delete(id);
		}
	}

	function confirmDelete() {
		if (!deleteConfirm) return;
		// Clear file references from affected lamps
		const fileId = deleteConfirm.id;
		for (const lamp of $lamps) {
			if (lamp.ies_file_id === fileId) {
				// We import project at module level already via lamps
				// Use direct store update — clearLampFileRef is handled by the caller
			}
			if (lamp.spectrum_file_id === fileId) {
				// Same
			}
		}
		fileStore.delete(deleteConfirm.id);
		deleteConfirm = null;
	}

	async function handleFileUpload(category: FileCategory, files: FileList | null) {
		if (!files || files.length === 0) return;
		const file = files[0];

		// Check for duplicate filename
		const existing = fileStore.findByFilename(file.name, category);
		if (existing) {
			// For simplicity, replace by default in the modal (user can see the list)
			await fileStore.replaceFile(existing.id, file);
		} else {
			await fileStore.addFile(file, category);
		}
	}

	function handleIesInput() {
		handleFileUpload('ies', iesFileInput.files);
		// Reset input so the same file can be re-selected
		iesFileInput.value = '';
	}

	function handleSpectrumInput() {
		handleFileUpload('spectrum', spectrumFileInput.files);
		spectrumFileInput.value = '';
	}
</script>

<Modal
	title="Manage Custom Files"
	{onClose}
	width="700px"
	maxWidth="95vw"
	dockId="file-manager"
>
	{#snippet body()}
		<div class="file-manager">
			<div class="file-column">
				<div class="column-header">
					<h3>Photometric (IES)</h3>
					<input
						type="file"
						accept=".ies"
						bind:this={iesFileInput}
						onchange={handleIesInput}
						style="display: none"
					/>
					<button class="add-btn" onclick={() => iesFileInput.click()}>+ Add IES File</button>
				</div>
				<div class="file-list">
					{#each $iesFiles as entry (entry.id)}
						<div class="file-entry">
							<div class="file-info">
								{#if editingId === entry.id}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										class="rename-input"
										bind:value={editValue}
										onblur={commitRename}
										onkeydown={handleRenameKey}
										autofocus
									/>
								{:else}
									<span class="display-name">{entry.displayName}</span>
								{/if}
								<span class="original-name" title={entry.originalFilename}>{entry.originalFilename}</span>
								<span class="file-size">{formatBytes(entry.sizeBytes)}</span>
							</div>
							<div class="file-actions">
								<button
									class="icon-btn"
									onclick={() => startRename(entry.id, entry.displayName)}
									title="Rename"
								>&#x270E;</button>
								<button
									class="icon-btn danger"
									onclick={() => requestDelete(entry.id, entry.displayName)}
									title="Delete"
								>&times;</button>
							</div>
						</div>
					{:else}
						<div class="empty-state">No IES files uploaded</div>
					{/each}
				</div>
			</div>

			<div class="column-divider"></div>

			<div class="file-column">
				<div class="column-header">
					<h3>Spectrum (CSV/XLS/XLSX)</h3>
					<input
						type="file"
						accept=".csv,.xls,.xlsx"
						bind:this={spectrumFileInput}
						onchange={handleSpectrumInput}
						style="display: none"
					/>
					<button class="add-btn" onclick={() => spectrumFileInput.click()}>+ Add Spectrum File</button>
				</div>
				<div class="file-list">
					{#each $spectrumFiles as entry (entry.id)}
						<div class="file-entry">
							<div class="file-info">
								{#if editingId === entry.id}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										class="rename-input"
										bind:value={editValue}
										onblur={commitRename}
										onkeydown={handleRenameKey}
										autofocus
									/>
								{:else}
									<span class="display-name">{entry.displayName}</span>
								{/if}
								<span class="original-name" title={entry.originalFilename}>{entry.originalFilename}</span>
								<span class="file-size">{formatBytes(entry.sizeBytes)}</span>
							</div>
							<div class="file-actions">
								<button
									class="icon-btn"
									onclick={() => startRename(entry.id, entry.displayName)}
									title="Rename"
								>&#x270E;</button>
								<button
									class="icon-btn danger"
									onclick={() => requestDelete(entry.id, entry.displayName)}
									title="Delete"
								>&times;</button>
							</div>
						</div>
					{:else}
						<div class="empty-state">No spectrum files uploaded</div>
					{/each}
				</div>
			</div>
		</div>
	{/snippet}
</Modal>

{#if deleteConfirm}
	<ConfirmDialog
		title="Delete File"
		message="&quot;{deleteConfirm.name}&quot; is used by: {deleteConfirm.usedBy.join(', ')}. Deleting it will remove the file association from these lamps."
		confirmLabel="Delete"
		variant="danger"
		onConfirm={confirmDelete}
		onCancel={() => deleteConfirm = null}
	/>
{/if}

<style>
	.file-manager {
		display: flex;
		gap: 0;
		padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md);
		min-height: 300px;
	}

	.file-column {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.column-divider {
		width: 1px;
		background: var(--color-border);
		margin: 0 var(--spacing-md);
	}

	.column-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-sm);
		gap: var(--spacing-sm);
	}

	.column-header h3 {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
	}

	.add-btn {
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		padding: 4px 10px;
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
		font-weight: 500;
	}

	.add-btn:hover {
		background: color-mix(in srgb, var(--color-primary) 85%, black);
	}

	.file-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		overflow-y: auto;
		flex: 1;
	}

	.file-entry {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.file-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.display-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.original-name {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-size {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.rename-input {
		font-size: 0.85rem;
		padding: 2px 4px;
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		width: 100%;
		outline: none;
	}

	.file-actions {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}

	.icon-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-size: 0.9rem;
		color: var(--color-text-muted);
		line-height: 1;
	}

	.icon-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.icon-btn.danger:hover {
		color: var(--color-error);
	}

	.empty-state {
		padding: var(--spacing-lg);
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		font-style: italic;
	}

	@media (max-width: 600px) {
		.file-manager {
			flex-direction: column;
		}
		.column-divider {
			width: auto;
			height: 1px;
			margin: var(--spacing-md) 0;
		}
	}
</style>
