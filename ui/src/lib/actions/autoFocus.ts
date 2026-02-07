const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Svelte action that traps focus inside a modal/dialog.
 *
 * - On mount, focuses the first focusable child that isn't a .close-btn
 * - Every Tab / Shift+Tab is intercepted to cycle within the modal
 * - The close button (.close-btn) is placed last in the tab order
 */
export function autoFocus(node: HTMLElement) {
	function getFocusable(): HTMLElement[] {
		const all = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
			.filter((el) => !el.closest('[inert]') && el.offsetParent !== null);

		// Partition: non-close-btn first, close-btn last
		const main: HTMLElement[] = [];
		const close: HTMLElement[] = [];
		for (const el of all) {
			if (el.closest('.close-btn')) {
				close.push(el);
			} else {
				main.push(el);
			}
		}
		return [...main, ...close];
	}

	requestAnimationFrame(() => {
		const items = getFocusable();
		if (items.length > 0) {
			items[0].focus();
		}
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;

		// Always prevent default Tab — we manage all focus movement manually
		event.preventDefault();

		const items = getFocusable();
		if (items.length === 0) return;

		const idx = items.indexOf(document.activeElement as HTMLElement);
		if (event.shiftKey) {
			const prev = idx <= 0 ? items.length - 1 : idx - 1;
			items[prev].focus();
		} else {
			const next = idx === -1 || idx >= items.length - 1 ? 0 : idx + 1;
			items[next].focus();
		}
	}

	node.addEventListener('keydown', handleKeydown);

	return {
		destroy() {
			node.removeEventListener('keydown', handleKeydown);
		}
	};
}
