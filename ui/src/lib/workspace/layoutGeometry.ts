import type { WorkspaceLayout } from '$lib/stores/settings';

export type ViewId = '2d' | '3d';

export function largeView(layout: WorkspaceLayout): ViewId | null {
	return layout === 'pip-2d' ? '2d' : layout === 'pip-3d' ? '3d' : null;
}

/** Order of the two views: [first/large, second/inset]. */
export function paneOrder(layout: WorkspaceLayout, swap: boolean): [ViewId, ViewId] {
	const large = largeView(layout);
	if (large) return large === '2d' ? ['2d', '3d'] : ['3d', '2d'];
	return swap ? ['3d', '2d'] : ['2d', '3d'];
}

export function calculateHost(layout: WorkspaceLayout): ViewId {
	return layout === 'pip-2d' ? '2d' : '3d';
}

export function swapped(layout: WorkspaceLayout, swap: boolean): { layout: WorkspaceLayout; swap: boolean } {
	if (layout === 'pip-2d') return { layout: 'pip-3d', swap };
	if (layout === 'pip-3d') return { layout: 'pip-2d', swap };
	return { layout, swap: !swap };
}

export function clampSplit(v: number): number {
	return Math.min(0.8, Math.max(0.2, v));
}

export function clampInset(
	pos: { x: number; y: number },
	box: { w: number; h: number },
	area: { w: number; h: number }
): { x: number; y: number } {
	const maxX = Math.max(0, area.w - box.w);
	const maxY = Math.max(0, area.h - box.h);
	return { x: Math.min(maxX, Math.max(0, pos.x)), y: Math.min(maxY, Math.max(0, pos.y)) };
}
