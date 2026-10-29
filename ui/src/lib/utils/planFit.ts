/**
 * The plan canvas's view window and how Fit and a resize set it. A view is a
 * window onto the plan in room units: (x, y) its bottom-left corner and `size`
 * its shorter side, with the canvas's aspect ratio.
 */
import { polygonBoundingBox, type Vertex } from './roomGeometry';

export interface PlanView {
	x: number;
	y: number;
	size: number;
}

export interface FitBox {
	/** Canvas size in CSS pixels. */
	width: number;
	height: number;
	/** Pixels kept clear at the top and bottom (controls drawn over the canvas). */
	insetY: number;
	/** Pixels kept clear at the left and right (centred fit only). */
	insetX?: number;
	/**
	 * Centre the outline in the space left by the insets (the phone). Otherwise
	 * anchor it bottom-left: coordinates can't go negative, so spare space belongs
	 * top and right (the desktop).
	 */
	centre?: boolean;
}

/** Extra room around the outline for the rulers and labels, as a fraction of its larger side. */
export const FIT_MARGIN = 1.14;

/** The view that fits `points` in a canvas of the given size. */
export function fitPlanView(points: Vertex[], box: FitBox): PlanView {
	const pts = points.length >= 2 ? points : ([[0, 0], [1, 1]] as Vertex[]);
	const bb = polygonBoundingBox(pts);
	const w = bb.xMax - bb.xMin;
	const h = bb.yMax - bb.yMin;
	const pad = (Math.max(w, h, 1) * (FIT_MARGIN - 1)) / 2;
	const wp = w + 2 * pad;
	const hp = h + 2 * pad;
	const canvasW = Math.max(box.width, 1);
	const canvasH = Math.max(box.height, 1);
	const aspect = canvasW / canvasH;
	const inset = Math.min(Math.max(box.insetY, 0), canvasH * 0.4);

	if (box.centre) {
		const insetX = Math.min(Math.max(box.insetX ?? 0, 0), canvasW * 0.4);
		// Room units per pixel: the outline fits both the clear width and the clear height
		let upp = Math.max(wp / (canvasW - 2 * insetX), hp / (canvasH - 2 * inset));
		const shortPx = aspect >= 1 ? canvasH : canvasW;
		upp = Math.max(upp, (1 + 2 * pad) / shortPx);
		const viewW = upp * canvasW;
		const viewH = upp * canvasH;
		const cx = (bb.xMin + bb.xMax) / 2;
		const cy = (bb.yMin + bb.yMax) / 2;
		return { x: cx - viewW / 2, y: cy - viewH / 2, size: aspect >= 1 ? viewH : viewW };
	}

	// The window takes the canvas's shape, so only the difference between the
	// outline's shape and the canvas's is spare.
	const hNeeded = (hp * canvasH) / (canvasH - 2 * inset);
	const short = aspect >= 1 ? Math.max(hNeeded, wp / aspect) : Math.max(wp, hNeeded * aspect);
	const size = Math.max(short, 1 + 2 * pad);
	const viewHeight = aspect >= 1 ? size : size / aspect;
	return { x: bb.xMin - pad, y: bb.yMin - pad - (inset * viewHeight) / canvasH, size };
}

/**
 * The view after the canvas changes size (from `prev` to `next` px). Until the
 * user pans or zooms (`canRefit`), any change of size refits; after that the
 * view keeps its centre and zoom. An unchanged size keeps the view.
 */
export function resizePlanView(
	view: PlanView,
	prev: { width: number; height: number },
	next: { width: number; height: number },
	canRefit: boolean,
	refit: () => PlanView
): PlanView {
	if (Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5) return view;
	if (canRefit) return refit();
	const a0 = prev.width / prev.height;
	const a1 = next.width / next.height;
	if (Math.abs(a0 - a1) < 1e-3) return view;
	const w0 = a0 >= 1 ? view.size * a0 : view.size;
	const h0 = a0 >= 1 ? view.size : view.size / a0;
	const cx = view.x + w0 / 2;
	const cy = view.y + h0 / 2;
	const w1 = a1 >= 1 ? view.size * a1 : view.size;
	const h1 = a1 >= 1 ? view.size : view.size / a1;
	return { x: cx - w1 / 2, y: cy - h1 / 2, size: view.size };
}
