import { describe, it, expect } from 'vitest';
import { fitPlanView, resizePlanView, type PlanView } from './planFit';
import type { Vertex } from './roomGeometry';

const room: Vertex[] = [[0, 0], [6, 0], [6, 4], [0, 4]];

/** The room's box on screen, in px from the canvas's left and top. */
function onScreen(v: PlanView, w: number, h: number) {
	const upp = (w / h >= 1 ? v.size / h : v.size / w);
	return { left: (0 - v.x) / upp, right: w - (6 - v.x) / upp, bottom: (0 - v.y) / upp, top: h - (4 - v.y) / upp };
}

describe('fitPlanView', () => {
	it('desktop: anchored bottom-left as before, spare space top and right', () => {
		// 1000 x 500 canvas, 52 px inset: the same numbers as the old in-canvas fit
		const v = fitPlanView(room, { width: 1000, height: 500, insetY: 52 });
		const pad = 6 * 0.07;
		expect(v.x).toBeCloseTo(-pad);
		const hp = 4 + 2 * pad;
		const size = (hp * 500) / (500 - 104);
		expect(v.size).toBeCloseTo(size);
		expect(v.y).toBeCloseTo(-pad - (52 * size) / 500);
	});

	it('phone: centred, clear of the top and bottom controls, with equal side margins', () => {
		for (const [w, h] of [[390, 337], [390, 744]] as const) {
			const v = fitPlanView(room, { width: w, height: h, insetY: 52, insetX: 20, centre: true });
			const s = onScreen(v, w, h);
			expect(s.left).toBeCloseTo(s.right, 6);
			expect(s.top).toBeCloseTo(s.bottom, 6);
			expect(Math.min(s.left, s.right)).toBeGreaterThanOrEqual(20);
			expect(Math.min(s.top, s.bottom)).toBeGreaterThanOrEqual(52);
		}
	});
});

describe('resizePlanView', () => {
	const view: PlanView = { x: 1, y: 2, size: 10 };
	const fitted: PlanView = { x: -1, y: -1, size: 8 };
	const refit = () => fitted;

	it('refits on any change of size until the user pans or zooms', () => {
		expect(resizePlanView(view, { width: 390, height: 337 }, { width: 390, height: 744 }, true, refit)).toBe(fitted);
		// Same shape, new size (the first layout at the default aspect)
		expect(resizePlanView(view, { width: 560, height: 560 }, { width: 400, height: 400 }, true, refit)).toBe(fitted);
	});

	it('an unchanged size keeps the view', () => {
		expect(resizePlanView(view, { width: 390, height: 337 }, { width: 390, height: 337 }, true, refit)).toBe(view);
	});

	it('after a pan or zoom it keeps the centre and zoom', () => {
		const next = resizePlanView(view, { width: 200, height: 100 }, { width: 100, height: 200 }, false, refit);
		expect(next.size).toBe(10);
		// Centre before: (1 + 20/2, 2 + 10/2) = (11, 7); after, the window is 10 x 20
		expect(next.x + 5).toBeCloseTo(11);
		expect(next.y + 10).toBeCloseTo(7);
	});
});
