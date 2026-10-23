import { describe, test, expect } from 'vitest';
import { paneOrder, largeView, calculateHost, swapped, clampSplit, clampInset } from './layoutGeometry';

describe('layoutGeometry', () => {
	test('paneOrder', () => {
		expect(paneOrder('side', false)).toEqual(['2d', '3d']);
		expect(paneOrder('side', true)).toEqual(['3d', '2d']);
		expect(paneOrder('stack', true)).toEqual(['3d', '2d']);
		expect(paneOrder('pip-3d', false)).toEqual(['3d', '2d']);
		expect(paneOrder('pip-2d', true)).toEqual(['2d', '3d']);
	});
	test('largeView', () => {
		expect(largeView('pip-2d')).toBe('2d');
		expect(largeView('pip-3d')).toBe('3d');
		expect(largeView('side')).toBeNull();
	});
	test('calculateHost follows the 3D view unless 2D is large', () => {
		expect(calculateHost('side')).toBe('3d');
		expect(calculateHost('pip-3d')).toBe('3d');
		expect(calculateHost('pip-2d')).toBe('2d');
	});
	test('swapped trades PiP layouts and toggles swap otherwise', () => {
		expect(swapped('pip-2d', false)).toEqual({ layout: 'pip-3d', swap: false });
		expect(swapped('pip-3d', true)).toEqual({ layout: 'pip-2d', swap: true });
		expect(swapped('stack', false)).toEqual({ layout: 'stack', swap: true });
		expect(swapped('side', true)).toEqual({ layout: 'side', swap: false });
	});
	test('clamps the split', () => {
		expect(clampSplit(0.05)).toBe(0.2);
		expect(clampSplit(0.95)).toBe(0.8);
		expect(clampSplit(0.4)).toBe(0.4);
	});
	test('keeps the inset inside the area when it shrinks', () => {
		expect(clampInset({ x: 900, y: 700 }, { w: 300, h: 250 }, { w: 800, h: 600 })).toEqual({ x: 500, y: 350 });
		expect(clampInset({ x: -20, y: 10 }, { w: 300, h: 250 }, { w: 800, h: 600 })).toEqual({ x: 0, y: 10 });
		expect(clampInset({ x: 50, y: 50 }, { w: 900, h: 700 }, { w: 800, h: 600 })).toEqual({ x: 0, y: 0 });
	});
});
