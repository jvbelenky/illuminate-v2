import { describe, it, expect } from 'vitest';
import { moveNext, moveTo, stepDone, cardText, STEP_LABELS, NEED_TEXT, type CardContext, type StepFacts } from './importSteps';

const none: StepFacts = { file: false, aligned: false, origin: false, scale: false, outline: false };
const file: StepFacts = { ...none, file: true };
const all: StepFacts = { file: true, aligned: true, origin: true, scale: true, outline: true };

describe('step completion and gating', () => {
  it('each step is done when its data exists', () => {
    expect(stepDone(none, 1)).toBe(false);
    expect(stepDone(file, 1)).toBe(true);
    expect(stepDone(none, 2)).toBe(false);
    expect(stepDone({ ...none, origin: true }, 3)).toBe(true);
    expect(stepDone(all, 5)).toBe(true);
  });

  it('without a file every move asks for it first', () => {
    expect(moveNext(none, 1)).toEqual({ kind: 'need', step: 1, aligned: false });
    expect(moveTo(none, 2)).toEqual({ kind: 'need', step: 1, aligned: false });
    expect(moveTo(none, 5)).toMatchObject({ kind: 'need', step: 1 });
    expect(NEED_TEXT[1].title).toBe('Choose a floor plan file first');
  });

  it('Next on the file step goes to Align axes', () => {
    expect(moveNext(file, 1)).toEqual({ kind: 'go', step: 2, aligned: false });
  });

  it('Next on Align axes always goes on, and marks it done', () => {
    expect(moveNext(file, 2)).toEqual({ kind: 'go', step: 3, aligned: true });
  });

  it('Next without an origin asks for it', () => {
    expect(moveNext({ ...file, aligned: true }, 3)).toEqual({ kind: 'need', step: 3, aligned: true });
  });

  it('Next without a scale asks for it; with both goes to the outline', () => {
    expect(moveNext({ ...file, aligned: true, origin: true }, 4)).toMatchObject({ kind: 'need', step: 4 });
    expect(moveNext({ ...file, aligned: true, origin: true, scale: true }, 4)).toMatchObject({ kind: 'go', step: 5 });
  });

  it('Create room needs the outline, and every earlier step', () => {
    expect(moveNext({ ...all, outline: false }, 5)).toMatchObject({ kind: 'need', step: 5 });
    expect(moveNext({ ...all, origin: false }, 5)).toMatchObject({ kind: 'need', step: 3 });
    expect(moveNext({ ...all, file: false }, 5)).toMatchObject({ kind: 'need', step: 1 });
    expect(moveNext(all, 5)).toMatchObject({ kind: 'create' });
  });

  it('a later step card asks for the first unfinished step before it; Align axes never blocks', () => {
    expect(moveTo(file, 3)).toEqual({ kind: 'go', step: 3, aligned: true });
    expect(moveTo(file, 5)).toEqual({ kind: 'need', step: 3, aligned: true });
    expect(moveTo({ ...file, origin: true }, 5)).toMatchObject({ kind: 'need', step: 4 });
    expect(moveTo({ ...file, origin: true, scale: true }, 5)).toMatchObject({ kind: 'go', step: 5 });
    // Going back is always allowed and does not mark anything
    expect(moveTo(file, 2)).toEqual({ kind: 'go', step: 2, aligned: false });
    expect(moveTo(none, 1)).toEqual({ kind: 'go', step: 1, aligned: false });
  });
});

describe('step cards', () => {
  const base: CardContext = { step: 2, file: true, aligning: false, tool: null, wallPoints: 0, scaleA: false, scaleB: false, detecting: false, tracing: false, vertices: 0 };
  it('the steps are Select floor plan file, Align axes, Set origin, Set scale, Trace outline', () => {
    expect(Object.values(STEP_LABELS)).toEqual(['Select floor plan file', 'Align axes', 'Set origin', 'Set scale', 'Trace outline']);
  });
  it('the file step asks for a file until there is one', () => {
    expect(cardText({ ...base, step: 1, file: false })).toBe('Choose a floor plan file (PNG, JPEG, SVG or PDF).');
    expect(cardText({ ...base, step: 1 })).toBeNull();
  });
  it('Align axes asks first; Straighten shows the live tool text', () => {
    expect(cardText(base)).toBe('Do the walls line up with the grid?');
    expect(cardText({ ...base, aligning: true, tool: 'straighten' })).toBe('Click two points along a wall to align it to an axis.');
    expect(cardText({ ...base, aligning: true, tool: 'straighten', wallPoints: 1 })).toBe('Now click a second point on the same wall.');
    expect(cardText({ ...base, aligning: true, tool: 'rotate' })).toBe('Drag on the image to rotate it until the walls follow the grid.');
  });
  it('Set origin never changes its text', () => {
    expect(cardText({ ...base, step: 3 })).toBe('Click to place the origin (0, 0).');
  });
  it('Set scale: two clicks, then the fields alone', () => {
    expect(cardText({ ...base, step: 4 })).toBe('Click two points a known distance apart.');
    expect(cardText({ ...base, step: 4, scaleA: true })).toBe('Click the second point.');
    expect(cardText({ ...base, step: 4, scaleA: true, scaleB: true })).toBeNull();
  });
  it('Trace outline: detecting, then tracing until the first vertex is placed (the room pick prompt is on the image)', () => {
    expect(cardText({ ...base, step: 5 })).toBeNull();
    expect(cardText({ ...base, step: 5, detecting: true })).toBe('Detecting walls…');
    expect(cardText({ ...base, step: 5, tracing: true })).toBe('Click on the image to place the first vertex.');
    expect(cardText({ ...base, step: 5, tracing: true, vertices: 1 })).toBeNull();
  });
});
