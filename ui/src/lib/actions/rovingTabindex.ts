/**
 * Svelte action implementing the roving tabindex pattern for button groups.
 * Only one item in the group has tabindex="0" at a time; the rest have tabindex="-1".
 * Arrow keys move focus within the group; Tab exits the group.
 *
 * Supports horizontal (Left/Right), vertical (Up/Down), and grid (all arrows) navigation.
 */

export interface RovingTabindexOptions {
	orientation: 'horizontal' | 'vertical' | 'grid';
	/** Number of columns for grid orientation */
	columns?: number;
	/** CSS selector for focusable items within the container */
	selector: string;
}

export function rovingTabindex(node: HTMLElement, options: RovingTabindexOptions) {
	let opts = options;

	function getItems(): HTMLElement[] {
		return Array.from(node.querySelectorAll(opts.selector));
	}

	function initTabindexes() {
		const items = getItems();
		items.forEach((item, i) => {
			item.setAttribute('tabindex', i === 0 ? '0' : '-1');
		});
	}

	function handleKeydown(event: KeyboardEvent) {
		const items = getItems();
		if (items.length === 0) return;

		const target = event.target as HTMLElement;
		const currentIdx = items.indexOf(target);
		if (currentIdx === -1) return;

		let nextIdx: number | null = null;

		if (opts.orientation === 'horizontal') {
			if (event.key === 'ArrowRight') {
				nextIdx = (currentIdx + 1) % items.length;
			} else if (event.key === 'ArrowLeft') {
				nextIdx = (currentIdx - 1 + items.length) % items.length;
			}
		} else if (opts.orientation === 'vertical') {
			if (event.key === 'ArrowDown') {
				nextIdx = (currentIdx + 1) % items.length;
			} else if (event.key === 'ArrowUp') {
				nextIdx = (currentIdx - 1 + items.length) % items.length;
			}
		} else if (opts.orientation === 'grid') {
			const cols = opts.columns ?? 1;
			const row = Math.floor(currentIdx / cols);
			const col = currentIdx % cols;
			const totalRows = Math.ceil(items.length / cols);

			if (event.key === 'ArrowRight') {
				const nextCol = (col + 1) % cols;
				nextIdx = row * cols + nextCol;
			} else if (event.key === 'ArrowLeft') {
				const nextCol = (col - 1 + cols) % cols;
				nextIdx = row * cols + nextCol;
			} else if (event.key === 'ArrowDown') {
				const nextRow = (row + 1) % totalRows;
				nextIdx = nextRow * cols + col;
			} else if (event.key === 'ArrowUp') {
				const nextRow = (row - 1 + totalRows) % totalRows;
				nextIdx = nextRow * cols + col;
			}

			// Clamp to valid index
			if (nextIdx !== null && nextIdx >= items.length) {
				nextIdx = null;
			}
		}

		if (nextIdx !== null) {
			event.preventDefault();
			items[currentIdx].setAttribute('tabindex', '-1');
			items[nextIdx].setAttribute('tabindex', '0');
			items[nextIdx].focus();
		}
	}

	function handleFocusin(event: FocusEvent) {
		const items = getItems();
		const target = event.target as HTMLElement;
		const idx = items.indexOf(target);
		if (idx === -1) return;

		// When an item receives focus, ensure it's the one with tabindex="0"
		items.forEach((item, i) => {
			item.setAttribute('tabindex', i === idx ? '0' : '-1');
		});
	}

	initTabindexes();
	node.addEventListener('keydown', handleKeydown);
	node.addEventListener('focusin', handleFocusin);

	return {
		update(newOptions: RovingTabindexOptions) {
			opts = newOptions;
			initTabindexes();
		},
		destroy() {
			node.removeEventListener('keydown', handleKeydown);
			node.removeEventListener('focusin', handleFocusin);
		}
	};
}
