import { type Page, expect } from '@playwright/test';

/** Get a room dimension input by its label (X, Y, or Z) */
function dimInput(page: Page, label: 'X' | 'Y' | 'Z') {
  return page
    .locator('.room-editor .input-with-label')
    .filter({ has: page.locator(`.input-label:text-is("${label}")`) })
    .locator('input');
}

/** Set room dimensions. Only changes dimensions that are provided. */
export async function setRoomDimensions(
  page: Page,
  dims: { x?: number; y?: number; z?: number }
): Promise<void> {
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
  return dimInput(page, label).inputValue();
}
