/**
 * Svelte action that allows Enter key to toggle checkbox inputs.
 * By default, only Space toggles checkboxes. This adds Enter support
 * and dispatches both 'change' and 'input' events so bind:checked
 * and onchange handlers both react.
 */
export function enterToggle(node: HTMLInputElement) {
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			node.checked = !node.checked;
			node.dispatchEvent(new Event('change', { bubbles: true }));
			node.dispatchEvent(new Event('input', { bubbles: true }));
		}
	}

	node.addEventListener('keydown', handleKeydown);

	return {
		destroy() {
			node.removeEventListener('keydown', handleKeydown);
		}
	};
}
