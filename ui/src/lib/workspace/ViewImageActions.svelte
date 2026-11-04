<script lang="ts">
	// Open in new tab | Save as image, bottom-right of the main view (2D and 3D alike).
	import Glyph from './Glyph.svelte';

	interface Props {
		onOpen: () => void;
		onSave: () => void;
		/** A save is under way: its button waits. */
		saving?: boolean;
	}

	let { onOpen, onSave, saving = false }: Props = $props();
</script>

<div class="mv-seg view-image-actions" role="group" aria-label="Image">
	<button type="button" class="mv-btn view-open" aria-label="Open in new tab" title="Open in new tab" onclick={onOpen}>
		<Glyph name="external" />
	</button>
	<button type="button" class="mv-btn view-save" aria-label="Save as image" title="Save as image" disabled={saving} onclick={onSave}>
		<Glyph name="download" />
	</button>
</div>
