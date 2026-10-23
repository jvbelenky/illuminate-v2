/**
 * Navigation catalogue for the workspace editor: the three stages, the four
 * Room parts, their linear order, and what the 2D pane edits at each step.
 */

export type EditorStage = 'room' | 'lamps' | 'zones';
export type RoomPart = 'floorplan' | 'structures' | 'ceiling' | 'reflectance';
export type PlanContext = 'outline' | 'obstacles' | 'ceiling' | 'reflectance' | 'lamps' | 'zones' | 'view';
export type WorkspaceMode = 'editor' | 'summary';

export interface NavStop {
  stage: EditorStage;
  part: RoomPart | null;
  label: string;
}

export const STAGES: { id: EditorStage; label: string; n: number }[] = [
  { id: 'room', label: 'Room', n: 1 },
  { id: 'lamps', label: 'Lamps', n: 2 },
  { id: 'zones', label: 'Zones', n: 3 },
];

export const ROOM_PARTS: { id: RoomPart; label: string }[] = [
  { id: 'floorplan', label: 'Floorplan' },
  { id: 'structures', label: 'Structures' },
  { id: 'ceiling', label: 'Ceiling' },
  { id: 'reflectance', label: 'Reflectance' },
];

export const NAV_ORDER: NavStop[] = [
  ...ROOM_PARTS.map(p => ({ stage: 'room' as const, part: p.id, label: p.label })),
  { stage: 'lamps', part: null, label: 'Lamps' },
  { stage: 'zones', part: null, label: 'Zones' },
];

export function neighbours(
  stage: EditorStage,
  part: RoomPart | null,
): { prev: NavStop | null; next: NavStop | null } {
  const i = NAV_ORDER.findIndex(s => s.stage === stage && (stage !== 'room' || s.part === part));
  if (i < 0) return { prev: null, next: null };
  return { prev: NAV_ORDER[i - 1] ?? null, next: NAV_ORDER[i + 1] ?? null };
}

const ROOM_CONTEXT: Record<RoomPart, PlanContext> = {
  floorplan: 'outline',
  structures: 'obstacles',
  ceiling: 'ceiling',
  reflectance: 'reflectance',
};

export function planContext(mode: WorkspaceMode, stage: EditorStage, part: RoomPart | null): PlanContext {
  if (mode === 'summary') return 'view';
  if (stage === 'lamps') return 'lamps';
  if (stage === 'zones') return 'zones';
  return part ? ROOM_CONTEXT[part] : 'outline';
}
