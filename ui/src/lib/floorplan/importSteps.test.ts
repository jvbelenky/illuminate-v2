import { describe, it, expect } from 'vitest';
import { moveNext, moveTo, stepDone, cardText, STEP_LABELS, type CardContext, type StepFacts } from './importSteps';

const none: StepFacts = { aligned: false, origin: false, scale: false, outline: false };
const all: StepFacts = { aligned: true, origin: true, scale: true, outline: true };

describe('step completion and gating', () => {
  it('each step is done when its data exists', () => {
    expect(stepDone(none, 1)).toBe(false);
    expect(stepDone({ ...none, origin: true }, 2)).toBe(true);
    expect(stepDone(all, 4)).toBe(true);
  });

  it('Next on Check axes always goes on, and marks it done', () => {
    expect(moveNext(none, 1)).toEqual({ kind: 'go', step: 2, aligned: true });
  });

  it('Next without an origin asks for it', () => {
    expect(moveNext({ ...none, aligned: true }, 2)).toEqual({ kind: 'need', step: 2, aligned: true });
  });

  it('Next without a scale asks for it; with both goes to the outline', () => {
    expect(moveNext({ ...none, aligned: true, origin: true }, 3)).toMatchObject({ kind: 'need', step: 3 });
    expect(moveNext({ ...none, aligned: true, origin: true, scale: true }, 3)).toMatchObject({ kind: 'go', step: 4 });
  });

  it('Create room needs the outline, and every earlier step', () => {
    expect(moveNext({ ...all, outline: false }, 4)).toMatchObject({ kind: 'need', step: 4 });
    expect(moveNext({ ...all, origin: false }, 4)).toMatchObject({ kind: 'need', step: 2 });
    expect(moveNext(all, 4)).toMatchObject({ kind: 'create' });
  });

  it('a later step card asks for the first unfinished step before it; Check axes never blocks', () => {
    expect(moveTo(none, 2)).toEqual({ kind: 'go', step: 2, aligned: true });
    expect(moveTo(none, 4)).toEqual({ kind: 'need', step: 2, aligned: true });
    expect(moveTo({ ...none, origin: true }, 4)).toMatchObject({ kind: 'need', step: 3 });
    expect(moveTo({ ...none, origin: true, scale: true }, 4)).toMatchObject({ kind: 'go', step: 4 });
    // Going back is always allowed and does not mark anything
    expect(moveTo(none, 1)).toEqual({ kind: 'go', step: 1, aligned: false });
  });
});

describe('step cards', () => {
  const base: CardContext = { step: 1, aligning: false, tool: null, wallPoints: 0, scaleA: false, scaleB: false, picking: false, detecting: false, tracing: false };
  it('the steps are Check axes, Set origin, Set scale, Trace outline', () => {
    expect(Object.values(STEP_LABELS)).toEqual(['Check axes', 'Set origin', 'Set scale', 'Trace outline']);
  });
  it('Check axes asks first; Align axes shows the live tool text', () => {
    expect(cardText(base)).toBe('Do the walls line up with the grid?');
    expect(cardText({ ...base, aligning: true, tool: 'straighten' })).toBe('Click two points along a wall to align it to an axis.');
    expect(cardText({ ...base, aligning: true, tool: 'straighten', wallPoints: 1 })).toBe('Now click a second point on the same wall.');
    expect(cardText({ ...base, aligning: true, tool: 'rotate' })).toBe('Drag on the image to rotate it until the walls follow the grid.');
  });
  it('Set origin never changes its text', () => {
    expect(cardText({ ...base, step: 2 })).toBe('Click to place the origin (0, 0).');
  });
  it('Set scale: two clicks, then the fields alone', () => {
    expect(cardText({ ...base, step: 3 })).toBe('Click two points a known distance apart.');
    expect(cardText({ ...base, step: 3, scaleA: true })).toBe('Click the second point.');
    expect(cardText({ ...base, step: 3, scaleA: true, scaleB: true })).toBeNull();
  });
  it('Trace outline: picking a room, detecting, tracing', () => {
    expect(cardText({ ...base, step: 4 })).toBeNull();
    expect(cardText({ ...base, step: 4, picking: true })).toBe('Click inside the room to detect it.');
    expect(cardText({ ...base, step: 4, detecting: true })).toBe('Detecting walls…');
    expect(cardText({ ...base, step: 4, tracing: true })).toBe('Click each vertex; click the first one to close.');
  });
});
