import { get, writable } from 'svelte/store';
import type { CalcZone, LampInstance } from '$lib/types/project';
import type { CeilingItem } from '$lib/ceiling/ceilingLayout';
import type { ObstacleDraft } from '$lib/utils/obstacleDrafts';

/**
 * What Ctrl+C took: a snapshot of the data (not ids), so pasting still works
 * after the originals are deleted. In the app only; the system clipboard is
 * untouched.
 */
export type ClipboardContent =
  | { kind: 'lamps'; lamps: LampInstance[] }
  | { kind: 'zone'; zone: CalcZone }
  | { kind: 'object'; draft: ObstacleDraft }
  | { kind: 'ceiling'; item: CeilingItem };

interface ClipboardState {
  content: ClipboardContent;
  /** Pastes made so far, so each one lands one step further along. */
  pastes: number;
}

export const clipboard = writable<ClipboardState | null>(null);

/** Replace the clipboard with a copy of `content`. */
export function setClipboard(content: ClipboardContent): void {
  clipboard.set({ content: structuredClone(content), pastes: 0 });
}

/** The content to paste and which paste this is (1 for the first), or null when empty. */
export function takePaste(): { content: ClipboardContent; n: number } | null {
  const state = get(clipboard);
  if (!state) return null;
  const n = state.pastes + 1;
  clipboard.set({ ...state, pastes: n });
  return { content: structuredClone(state.content), n };
}

export function clearClipboard(): void {
  clipboard.set(null);
}
