<script lang="ts">
	// Undo | Redo for the main view's tool groups: the project history, as Edit › Undo
	// and the keyboard shortcuts (a drawing in progress takes the first look at Undo).
	import { project } from '$lib/stores/project';
	import { undoShortcut, redoShiftShortcut, interceptUndo } from '$lib/utils/undoKeys';
	import Glyph from './Glyph.svelte';

	const history = project.history;

	function run(action: 'undo' | 'redo') {
		if (interceptUndo(action)) return;
		if (action === 'undo') history.undo();
		else history.redo();
	}
</script>

<div class="mv-seg undo-redo" role="group" aria-label="History">
	<button
		type="button"
		class="mv-btn history-undo"
		aria-label="Undo ({undoShortcut})"
		title="Undo ({undoShortcut})"
		disabled={!$history.canUndo}
		onclick={() => run('undo')}
	>
		<Glyph name="undo" />
	</button>
	<button
		type="button"
		class="mv-btn history-redo"
		aria-label="Redo ({redoShiftShortcut})"
		title="Redo ({redoShiftShortcut})"
		disabled={!$history.canRedo}
		onclick={() => run('redo')}
	>
		<Glyph name="redo" />
	</button>
</div>
