import { type Page, expect } from '@playwright/test';
import { finishEditing, openStep } from './workspace';

/** Open Room > Floorplan, where the size and units live. */
export async function expandRoomPanel(page: Page): Promise<void> {
  await openStep(page, 'room', 'floorplan');
}

const DIM_LABEL = { X: 'Width', Y: 'Length', Z: 'Height' } as const;

/** A room dimension input of the Floorplan part: X is Width, Y Length, Z Height. */
function dimInput(page: Page, label: 'X' | 'Y' | 'Z') {
  return page.locator('.floorplan-part').getByLabel(DIM_LABEL[label], { exact: true });
}

/** Set room dimensions. Only changes dimensions that are provided. */
export async function setRoomDimensions(
  page: Page,
  dims: { x?: number; y?: number; z?: number }
): Promise<void> {
  await openGeometry(page);
  for (const [label, value] of Object.entries(dims)) {
    if (value == null) continue;
    const input = dimInput(page, label.toUpperCase() as 'X' | 'Y' | 'Z');
    await input.click({ clickCount: 3 });
    await input.fill(String(value));
    await input.press('Tab');
  }
}

/** Read the current value of a room dimension input. */
export async function getRoomDimension(page: Page, label: 'X' | 'Y' | 'Z'): Promise<string> {
  await openGeometry(page);
  return dimInput(page, label).inputValue();
}

/** The Floorplan part's units select (inside Geometry: call openGeometry first). */
export function unitsSelect(page: Page) {
  return page.locator('.floorplan-part').getByLabel('Units', { exact: true });
}

/** Open the Floorplan part's Geometry disclosure (no-op when open). */
export async function openGeometry(page: Page): Promise<void> {
  await expandRoomPanel(page);
  const toggle = page.locator('.floorplan-part button.ep-disc');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** Leave the editor for the summary. Edits apply as they are made, so Done only switches view. */
export async function closePlan(page: Page): Promise<void> {
  await finishEditing(page);
}
