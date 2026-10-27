import { describe, test, expect, vi } from 'vitest';
import { writable } from 'svelte/store';
import { followPickMode } from './viewDemands';
import { DEFAULT_DOCK, withMain, type DockLayout } from './dockLayout';
import type { PickRequest } from '$lib/stores/pickMode';

function setup(main: '2d' | '3d', enabled = true) {
	const pick = writable<PickRequest>(null);
	let dock: DockLayout = { ...DEFAULT_DOCK, main };
	const setDock = vi.fn((l: DockLayout) => (dock = l));
	const stop = followPickMode(pick, () => dock, setDock, () => enabled);
	return { pick, setDock, stop, get dock() { return dock; } };
}

describe('withMain', () => {
	test('sets the main view, returning the same layout when it already is', () => {
		const l = { ...DEFAULT_DOCK, main: '2d' as const };
		expect(withMain(l, '2d')).toBe(l);
		const next = withMain(l, '3d');
		expect(next.main).toBe('3d');
		expect(next.left).toEqual(l.left);
		expect(l.main).toBe('2d');
	});
});

describe('followPickMode', () => {
	test('a pick request while 3D is the mini view makes 3D the main view', () => {
		const s = setup('2d');
		expect(s.setDock).not.toHaveBeenCalled();
		s.pick.set({ type: 'lamp_position' });
		expect(s.setDock).toHaveBeenCalledTimes(1);
		expect(s.dock.main).toBe('3d');
		// Clearing the pick leaves the main view as it is
		s.pick.set(null);
		expect(s.dock.main).toBe('3d');
		s.stop();
	});

	test('does nothing when 3D is already main, or when disabled (the phone)', () => {
		const a = setup('3d');
		a.pick.set({ type: 'target' });
		expect(a.setDock).not.toHaveBeenCalled();
		a.stop();
		const b = setup('2d', false);
		b.pick.set({ type: 'target' });
		expect(b.setDock).not.toHaveBeenCalled();
		b.stop();
	});

	test('stops following once unsubscribed', () => {
		const s = setup('2d');
		s.stop();
		s.pick.set({ type: 'target' });
		expect(s.setDock).not.toHaveBeenCalled();
	});
});
