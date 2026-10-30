/**
 * Navigation catalogue for the workspace editor: the three stages, the four
 * Room parts, and what the 2D pane edits at each step.
 */

export type EditorStage = 'room' | 'lamps' | 'zones';
export type RoomPart = 'floorplan' | 'structures' | 'ceiling' | 'reflectance';
export type PlanContext = 'outline' | 'obstacles' | 'ceiling' | 'reflectance' | 'lamps' | 'zones' | 'view';
export type WorkspaceMode = 'editor' | 'summary';

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

/** What a stage's completion depends on. */
export interface StageProgress {
  hasOutline: boolean;
  lamps: { has_ies_file?: boolean; enabled?: boolean }[];
  userZoneCount: number;
}

/**
 * A stage is complete (its tab's number becomes a checkmark): Room once the
 * outline is a room, Lamps once there is a lamp and every included one has
 * photometry, Zones once there is a zone of your own.
 */
export function stageDone(stage: EditorStage, p: StageProgress): boolean {
  if (stage === 'room') return p.hasOutline;
  if (stage === 'lamps') return p.lamps.length > 0 && p.lamps.every((l) => l.enabled === false || !!l.has_ies_file);
  return p.userZoneCount > 0;
}
