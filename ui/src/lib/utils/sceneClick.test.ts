import { describe, test, expect, vi } from 'vitest';
import { guardedClick } from './sceneClick';

describe('guardedClick', () => {
	test('stays one attached function and ignores clicks only while blocked', () => {
		let blocked = false;
		const handler = vi.fn();
		const click = guardedClick(handler, () => blocked);
		expect(typeof click).toBe('function');
		click('a');
		expect(handler).toHaveBeenCalledWith('a');
		blocked = true; // a pick starts
		click('b');
		expect(handler).toHaveBeenCalledTimes(1);
		blocked = false; // the pick ends: the same function works again
		click('c');
		expect(handler).toHaveBeenCalledTimes(2);
		expect(handler).toHaveBeenLastCalledWith('c');
	});
});
