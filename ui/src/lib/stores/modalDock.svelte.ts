/**
 * Store for tracking minimized modals in the dock bar.
 * Modals can be docked (in the bar) or floating (dragged out).
 */

export interface DockedModal {
  id: string;
  title: string;
  restore: () => void;
  close: () => void;
  /** Whether the tab is docked in the bar or floating freely */
  docked: boolean;
  /** Floating position (only used when docked === false) */
  x: number;
  y: number;
  /** Tab width in pixels */
  width: number;
}

const DEFAULT_TAB_WIDTH = 160;

let dockedModals = $state<DockedModal[]>([]);

export function getDockedModals(): DockedModal[] {
  return dockedModals;
}

export function dockModal(modal: Omit<DockedModal, 'docked' | 'x' | 'y' | 'width'>) {
  // Avoid duplicates
  if (!dockedModals.some(m => m.id === modal.id)) {
    dockedModals = [...dockedModals, { ...modal, docked: true, x: 0, y: 0, width: DEFAULT_TAB_WIDTH }];
  }
}

export function undockModal(id: string) {
  dockedModals = dockedModals.filter(m => m.id !== id);
}

export function restoreByTitle(title: string): boolean {
  const modal = dockedModals.find(m => m.title === title);
  if (modal) {
    modal.restore();
    return true;
  }
  return false;
}

export function restoreById(id: string): boolean {
  const modal = dockedModals.find(m => m.id === id);
  if (modal) {
    modal.restore();
    return true;
  }
  return false;
}

export function updateModal(id: string, updates: Partial<Pick<DockedModal, 'docked' | 'x' | 'y' | 'width'>>) {
  dockedModals = dockedModals.map(m =>
    m.id === id ? { ...m, ...updates } : m
  );
}
