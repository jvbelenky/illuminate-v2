/**
 * Flows that need a particular view bring it to the main view. A 3D pick
 * (point, aim or direction, requested from an editor) needs the 3D view main,
 * since the docked mini view ignores clicks.
 */
import { get, type Readable, type Writable } from 'svelte/store';
import type { PickRequest } from '$lib/stores/pickMode';
import { withMain, type DockLayout, type MainView } from './dockLayout';

/** A point zone's Place and Aim can be picked on the 2D plan too. */
export function pickableOn2d(req: PickRequest): boolean {
	return !!req && (req.type === 'point_position' || req.type === 'aim_point');
}

/**
 * While subscribed: a pick request makes 3D the main view, except a point's Place and
 * Aim while 2D is already the main view (they pick on the plan). Returns the unsubscriber.
 */
export function followPickMode(
	pickMode: Readable<PickRequest>,
	getDock: () => DockLayout,
	setDock: (l: DockLayout) => void,
	enabled: () => boolean = () => true
): () => void {
	return pickMode.subscribe((req) => {
		if (!req || !enabled()) return;
		const dock = getDock();
		if (dock.main === '2d' && pickableOn2d(req)) return;
		const next = withMain(dock, '3d');
		if (next !== dock) setDock(next);
	});
}

/** A pick still running when 3D stops being the main view (the views swapped back) is cancelled, unless it can pick on the plan. */
export function cancelPickOffMain(main: MainView, pickMode: Writable<PickRequest>): void {
	const req = get(pickMode);
	if (main !== '3d' && req && !(main === '2d' && pickableOn2d(req))) pickMode.set(null);
}
