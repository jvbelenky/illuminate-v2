/**
 * The import window's five steps: what counts as done, where Next or a step
 * card may go, and the text in the open step card.
 */

export type ImportStep = 1 | 2 | 3 | 4 | 5;
export const STEP_LABELS: Record<ImportStep, string> = { 1: 'Select floor plan file', 2: 'Check axes', 3: 'Set origin', 4: 'Set scale', 5: 'Trace outline' };

export interface StepFacts {
  /** A floor plan file is loaded. */
  file: boolean;
  /** Looks good, Done, Straighten, Rotate or Next was used on Check axes. */
  aligned: boolean;
  origin: boolean;
  scale: boolean;
  /** A closed, valid outline exists (or the current one is kept). */
  outline: boolean;
}

export function stepDone(f: StepFacts, n: ImportStep): boolean {
  return n === 1 ? f.file : n === 2 ? f.aligned : n === 3 ? f.origin : n === 4 ? f.scale : f.outline;
}

/** The steps a move can be stopped at (Check axes never stops one). */
export type BlockingStep = 1 | 3 | 4 | 5;

/** The file formats as the window names them (WebP and GIF are read too). */
export const FILE_FORMATS = 'PNG, JPEG, SVG or PDF';
export const CHOOSE_FILE_TEXT = `Choose a floor plan file (${FILE_FORMATS}).`;

export const NEED_TEXT: Record<BlockingStep, { title: string; body: string }> = {
  1: { title: 'Choose a floor plan file first', body: `Choose a floor plan file (${FILE_FORMATS}) before moving on.` },
  3: { title: 'Set the origin first', body: 'Click on the plan to place the origin (0, 0) before moving on.' },
  4: { title: 'Set the scale first', body: 'Click two points on the plan and enter the distance between them before moving on.' },
  5: { title: 'Finish the outline first', body: 'Trace the outline or use Auto-detect, and close it, before creating the room.' },
};

export type StepMove =
  | { kind: 'go'; step: ImportStep; aligned: boolean }
  | { kind: 'need'; step: BlockingStep; aligned: boolean }
  | { kind: 'create'; aligned: boolean };

/**
 * Going to step `to` (a card click): every earlier step must be done. Check
 * axes never blocks; passing it marks it done.
 */
export function moveTo(f: StepFacts, to: ImportStep): StepMove {
  let aligned = f.aligned;
  for (let k = 1 as ImportStep; k < to; k = (k + 1) as ImportStep) {
    if (k === 2) { aligned = true; continue; }
    if (!stepDone(f, k)) return { kind: 'need', step: k as BlockingStep, aligned };
  }
  return { kind: 'go', step: to, aligned };
}

/** Next from step `at`: the current step must be done (Check axes is, by pressing Next). On step 5, Create room. */
export function moveNext(f: StepFacts, at: ImportStep): StepMove {
  const aligned = f.aligned || (at === 2 && f.file);
  const facts = { ...f, aligned };
  // Earlier steps can be undone by going back and clearing; check them all
  for (let k = 1 as ImportStep; k <= at; k = (k + 1) as ImportStep) {
    if (k === 2) continue;
    if (!stepDone(facts, k)) return { kind: 'need', step: k as BlockingStep, aligned };
  }
  if (at === 5) return { kind: 'create', aligned };
  return { kind: 'go', step: (at + 1) as ImportStep, aligned };
}

export type AlignTool = 'pan' | 'rotate' | 'straighten' | null;

export const CHECK_AXES_QUESTION = 'Do the walls line up with the grid?';
export const ORIGIN_TEXT = 'Click to place the origin (0, 0).';
/** Auto-detect, One room: the prompt over the image while a room is picked. */
export const PICK_ROOM_TEXT = 'Click inside a room to detect it';
/** Auto-detect found nothing: shown in the Auto-detect dialog, by mode. */
export const DETECT_FAILED = { room: 'No room found there.', floor: 'No outline found.' } as const;

export interface CardContext {
  step: ImportStep;
  /** A floor plan file is loaded. */
  file: boolean;
  /** Check axes: the align tools are open. */
  aligning: boolean;
  tool: AlignTool;
  /** Straighten points placed so far. */
  wallPoints: number;
  scaleA: boolean;
  scaleB: boolean;
  detecting: boolean;
  tracing: boolean;
  /** Vertices placed so far (Trace outline). */
  vertices: number;
}

/** The instruction in the open step card, or null when the card shows only its controls. */
export function cardText(c: CardContext): string | null {
  if (c.step === 1) return c.file ? null : CHOOSE_FILE_TEXT;
  if (c.step === 2) {
    if (!c.aligning) return CHECK_AXES_QUESTION;
    if (c.tool === 'straighten') return c.wallPoints ? 'Now click a second point on the same wall.' : 'Click two points along a wall to align it to an axis.';
    if (c.tool === 'rotate') return 'Drag on the image to rotate it until the walls follow the grid.';
    if (c.tool === 'pan') return 'Drag to move the image.';
    return 'Use the tools above the image to line up the walls with the grid.';
  }
  if (c.step === 3) return ORIGIN_TEXT;
  if (c.step === 4) return c.scaleB ? null : c.scaleA ? 'Click the second point.' : 'Click two points a known distance apart.';
  if (c.detecting) return 'Detecting walls…';
  if (c.tracing && c.vertices === 0) return 'Click on the image to place the first vertex.';
  return null;
}
