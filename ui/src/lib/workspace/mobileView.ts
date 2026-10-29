/**
 * The phone's Design tab: one view pinned above the editor, which can go full
 * screen (⤢). A canvas tool that needs room (drawing, editing corners) takes
 * the view full screen on its own, and gives it back when it ends, unless the
 * user had gone full screen themselves.
 */

export interface FullScreen {
	on: boolean;
	/** Entered by a canvas tool, so the tool's end leaves it again. */
	auto: boolean;
}

export const FULL_SCREEN_OFF: FullScreen = { on: false, auto: false };

/** A canvas tool that wants the whole screen: a drawing, or Edit corners. */
export function wantsFullScreen(plan: { drawing: boolean; activeTool: string | null }): boolean {
	return plan.drawing || plan.activeTool === 'corners';
}

/** ⤢ / ⤡: the user's own choice, never left automatically. */
export function toggleFullScreen(s: FullScreen): FullScreen {
	return s.on ? FULL_SCREEN_OFF : { on: true, auto: false };
}

/** The full-screen state after a canvas tool starts (`was` false, `now` true) or ends. */
export function followCanvasTool(s: FullScreen, was: boolean, now: boolean): FullScreen {
	if (now && !was && !s.on) return { on: true, auto: true };
	if (!now && was && s.on && s.auto) return FULL_SCREEN_OFF;
	return s;
}
