import { describe, it, expect } from 'vitest';
import { moveNext, moveTo, stepDone, guideMessage, type GuideContext, type StepFacts } from './importSteps';

const none: StepFacts = { aligned: false, origin: false, scale: false, outline: false };
const all: StepFacts = { aligned: true, origin: true, scale: true, outline: true };

describe('step completion and gating', () => {
  it('each step is done when its data exists', () => {
    expect(stepDone(none, 1)).toBe(false);
    expect(stepDone({ ...none, origin: true }, 2)).toBe(true);
    expect(stepDone(all, 4)).toBe(true);
  });

  it('Next on Align axes always goes on, and marks it done', () => {
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

  it('a later step card asks for the first unfinished step before it; Align axes never blocks', () => {
    expect(moveTo(none, 2)).toEqual({ kind: 'go', step: 2, aligned: true });
    expect(moveTo(none, 4)).toEqual({ kind: 'need', step: 2, aligned: true });
    expect(moveTo({ ...none, origin: true }, 4)).toMatchObject({ kind: 'need', step: 3 });
    expect(moveTo({ ...none, origin: true, scale: true }, 4)).toMatchObject({ kind: 'go', step: 4 });
    // Going back is always allowed and does not mark anything
    expect(moveTo(none, 1)).toEqual({ kind: 'go', step: 1, aligned: false });
  });
});

describe('instruction box', () => {
  const base: GuideContext = { step: 1, tool: 'straighten', wallPoints: 0, origin: false, scaleA: false, scaleB: false, how: null, tracing: false, detected: null, detecting: false };
  it('uses the mockup wording', () => {
    expect(guideMessage(base)).toBe('Click two points along a wall that should line up with the grid.');
    expect(guideMessage({ ...base, wallPoints: 1 })).toBe('Now click a second point on the same wall.');
    expect(guideMessage({ ...base, tool: 'rotate' })).toBe('Drag on the image to rotate it until the walls follow the grid.');
    expect(guideMessage({ ...base, step: 2 })).toBe('Click or drag to place the origin (0, 0).');
    expect(guideMessage({ ...base, step: 2, origin: true })).toBe('Origin placed. Drag it to adjust, or press Next.');
    expect(guideMessage({ ...base, step: 3 })).toBe('Click two points a known distance apart.');
    expect(guideMessage({ ...base, step: 3, scaleA: true })).toBe('Now click the second point.');
    expect(guideMessage({ ...base, step: 3, scaleA: true, scaleB: true })).toBe('Enter the distance between the two points.');
    expect(guideMessage({ ...base, step: 4 })).toBe('Choose Trace or Auto-detect.');
    expect(guideMessage({ ...base, step: 4, how: 'trace', tracing: true })).toBe('Click each vertex; click the first one to close.');
    expect(guideMessage({ ...base, step: 4, how: 'trace' })).toBe('Drag vertices or type their values to adjust.');
  });
  it('auto-detect: click a room, then edit; a miss says to trace', () => {
    expect(guideMessage({ ...base, step: 4, how: 'auto' })).toBe('Click inside the room to detect it.');
    expect(guideMessage({ ...base, step: 4, how: 'auto', detected: 'found' })).toBe('Drag vertices or type their values to adjust.');
    expect(guideMessage({ ...base, step: 4, how: 'auto', detected: 'none' })).toBe('No outline found; trace it instead.');
  });
});
