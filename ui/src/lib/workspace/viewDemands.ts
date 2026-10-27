/**
 * Flows that need a particular view bring it to the main view. A 3D pick
 * (point, aim or direction, requested from an editor) needs the 3D view main,
 * since the docked mini view ignores clicks.
 */
import type { Readable } from 'svelte/store';
import type { PickRequest } from '$lib/stores/pickMode';
import { withMain, type DockLayout } from './dockLayout';

/** While subscribed: a pick request makes 3D the main view. Returns the unsubscriber. */
export function followPickMode(
	pickMode: Readable<PickRequest>,
	getDock: () => DockLayout,
	setDock: (l: DockLayout) => void,
	enabled: () => boolean = () => true
): () => void {
	return pickMode.subscribe((req) => {
		if (!req || !enabled()) return;
		const dock = getDock();
		const next = withMain(dock, '3d');
		if (next !== dock) setDock(next);
	});
}
