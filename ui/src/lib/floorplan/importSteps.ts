/**
 * The import window's four steps: what counts as done, where Next or a step
 * card may go, and the text in the open step card.
 */

export type ImportStep = 1 | 2 | 3 | 4;
export const STEP_LABELS: Record<ImportStep, string> = { 1: 'Check axes', 2: 'Set origin', 3: 'Set scale', 4: 'Trace outline' };

export interface StepFacts {
  /** Looks good, Done, Straighten, Rotate or Next was used on Check axes. */
  aligned: boolean;
  origin: boolean;
  scale: boolean;
  /** A closed, valid outline exists (or the current one is kept). */
  outline: boolean;
}

export function stepDone(f: StepFacts, n: ImportStep): boolean {
  return n === 1 ? f.aligned : n === 2 ? f.origin : n === 3 ? f.scale : f.outline;
}

export const NEED_TEXT: Record<2 | 3 | 4, { title: string; body: string }> = {
  2: { title: 'Set the origin first', body: 'Click on the plan to place the origin (0, 0) before moving on.' },
  3: { title: 'Set the scale first', body: 'Click two points on the plan and enter the distance between them before moving on.' },
  4: { title: 'Finish the outline first', body: 'Trace the outline or use Auto-detect, and close it, before creating the room.' },
};

export type StepMove =
  | { kind: 'go'; step: ImportStep; aligned: boolean }
  | { kind: 'need'; step: 2 | 3 | 4; aligned: boolean }
  | { kind: 'create'; aligned: boolean };

/**
 * Going to step `to` (a card click): every earlier step must be done. Check
 * axes never blocks; passing it marks it done.
 */
export function moveTo(f: StepFacts, to: ImportStep): StepMove {
  let aligned = f.aligned;
  for (let k = 1 as ImportStep; k < to; k = (k + 1) as ImportStep) {
    if (k === 1) { aligned = true; continue; }
    if (!stepDone(f, k)) return { kind: 'need', step: k as 2 | 3 | 4, aligned };
  }
  return { kind: 'go', step: to, aligned };
}

/** Next from step `at`: the current step must be done (Check axes is, by pressing Next). On step 4, Create room. */
export function moveNext(f: StepFacts, at: ImportStep): StepMove {
  const aligned = f.aligned || at === 1;
  const facts = { ...f, aligned };
  // Earlier steps can be undone by going back and clearing; check them all
  for (let k = 2 as ImportStep; k <= at; k = (k + 1) as ImportStep) {
    if (!stepDone(facts, k)) return { kind: 'need', step: k as 2 | 3 | 4, aligned };
  }
  if (at === 4) return { kind: 'create', aligned };
  return { kind: 'go', step: (at + 1) as ImportStep, aligned };
}

export type AlignTool = 'pan' | 'rotate' | 'straighten' | null;

export const CHECK_AXES_QUESTION = 'Do the walls line up with the grid?';
export const ORIGIN_TEXT = 'Click to place the origin (0, 0).';
/** Auto-detect found nothing: shown in the Auto-detect dialog, by mode. */
export const DETECT_FAILED = { room: 'No room found there.', floor: 'No outline found.' } as const;

export interface CardContext {
  step: ImportStep;
  /** Check axes: the align tools are open. */
  aligning: boolean;
  tool: AlignTool;
  /** Straighten points placed so far. */
  wallPoints: number;
  scaleA: boolean;
  scaleB: boolean;
  /** Trace outline: a click picks the room to detect. */
  picking: boolean;
  detecting: boolean;
  tracing: boolean;
}

/** The instruction in the open step card, or null when the card shows only its controls. */
export function cardText(c: CardContext): string | null {
  if (c.step === 1) {
    if (!c.aligning) return CHECK_AXES_QUESTION;
    if (c.tool === 'straighten') return c.wallPoints ? 'Now click a second point on the same wall.' : 'Click two points along a wall to align it to an axis.';
    if (c.tool === 'rotate') return 'Drag on the image to rotate it until the walls follow the grid.';
    if (c.tool === 'pan') return 'Drag to move the image.';
    return 'Use the tools above the image to line up the walls with the grid.';
  }
  if (c.step === 2) return ORIGIN_TEXT;
  if (c.step === 3) return c.scaleB ? null : c.scaleA ? 'Click the second point.' : 'Click two points a known distance apart.';
  if (c.detecting) return 'Detecting walls…';
  if (c.picking) return 'Click inside the room to detect it.';
  if (c.tracing) return 'Click each vertex; click the first one to close.';
  return null;
}
