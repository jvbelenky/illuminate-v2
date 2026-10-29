import { describe, it, expect } from 'vitest';
import { FULL_SCREEN_OFF, followCanvasTool, toggleFullScreen, wantsFullScreen } from './mobileView';

describe('mobile full-screen view', () => {
	it('a drawing or Edit corners wants the full screen; other tools do not', () => {
		expect(wantsFullScreen({ drawing: true, activeTool: null })).toBe(true);
		expect(wantsFullScreen({ drawing: false, activeTool: 'corners' })).toBe(true);
		expect(wantsFullScreen({ drawing: false, activeTool: 'move' })).toBe(false);
		expect(wantsFullScreen({ drawing: false, activeTool: null })).toBe(false);
	});

	it('⤢ and ⤡ toggle, and are never automatic', () => {
		const on = toggleFullScreen(FULL_SCREEN_OFF);
		expect(on).toEqual({ on: true, auto: false });
		expect(toggleFullScreen(on)).toEqual(FULL_SCREEN_OFF);
		expect(toggleFullScreen({ on: true, auto: true })).toEqual(FULL_SCREEN_OFF);
	});

	it('a tool that starts enters full screen automatically and its end leaves it', () => {
		const entered = followCanvasTool(FULL_SCREEN_OFF, false, true);
		expect(entered).toEqual({ on: true, auto: true });
		expect(followCanvasTool(entered, true, false)).toEqual(FULL_SCREEN_OFF);
	});

	it('a tool that ends leaves a full screen the user entered', () => {
		const mine = { on: true, auto: false };
		expect(followCanvasTool(mine, false, true)).toBe(mine);
		expect(followCanvasTool(mine, true, false)).toBe(mine);
	});

	it('leaving full screen during a tool is not undone while it runs', () => {
		// The tool is still on (was and now both true): nothing re-enters
		expect(followCanvasTool(FULL_SCREEN_OFF, true, true)).toBe(FULL_SCREEN_OFF);
		expect(followCanvasTool(FULL_SCREEN_OFF, true, false)).toBe(FULL_SCREEN_OFF);
	});
});
