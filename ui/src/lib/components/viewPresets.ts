import type { ViewPreset } from './ViewSnapOverlay.svelte';

export interface ViewPresetCell {
  id: ViewPreset;
  icon: string;
  title: string;
}

/** The 3D view presets as a 3x3 grid: corners are isometric, edges face a wall, the centre is the plan. */
export const VIEW_PRESET_GRID: ViewPresetCell[][] = [
  [
    { id: 'iso-back-left', icon: '↘', title: 'Isometric (back-left)' },
    { id: 'back', icon: '↓', title: 'Back wall' },
    { id: 'iso-back-right', icon: '↙', title: 'Isometric (back-right)' },
  ],
  [
    { id: 'left', icon: '→', title: 'Left wall' },
    { id: 'top', icon: '▢', title: 'Top (plan view)' },
    { id: 'right', icon: '←', title: 'Right wall' },
  ],
  [
    { id: 'iso-front-left', icon: '↗', title: 'Isometric (front-left)' },
    { id: 'front', icon: '↑', title: 'Front wall' },
    { id: 'iso-front-right', icon: '↖', title: 'Isometric (front-right)' },
  ],
];
