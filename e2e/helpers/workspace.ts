import { type Locator, type Page, expect } from '@playwright/test';

export type Stage = 'room' | 'lamps' | 'zones';
export type Part = 'floorplan' | 'structures' | 'ceiling' | 'reflectance';

/** The 2D plan canvas (the main view's, not the docked mini view's). */
export function planSvg(page: Page): Locator {
  return page.locator('.view-slot[data-view="2d"]:not(.mini) .plan-pane svg.plan');
}

/** Choose the main view with the 2D | 3D switch (glyph buttons named "2D view" / "3D view"). */
export async function showMain(page: Page, view: '2d' | '3d'): Promise<void> {
  const button = page.locator('[aria-label="Main view"]').getByRole('button', { name: `${view.toUpperCase()} view`, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/** An edit strip button, bottom left of the main view, by its aria-label (Draw, Copy, Delete, ...). */
export function planTool(page: Page, name: string | RegExp): Locator {
  return page.locator('.plan-toolbar').getByRole('button', { name, exact: typeof name === 'string' });
}

/**
 * Open an editor step. From the read-only summary, the matching section button
 * reopens the editor first. Then the stage tab, and (Room only) the part tab.
 */
export async function openStep(page: Page, stage: Stage, part?: Part): Promise<void> {
  const summary = page.locator('.summary-panel');
  const stageTab = page.locator(`button.editor-stage[data-stage="${stage}"]`);
  await expect(summary.or(stageTab)).toBeVisible({ timeout: 15_000 });
  if (await summary.isVisible()) {
    const edit = stage === 'room' ? `room:${part === 'structures' ? 'structures' : 'floorplan'}` : stage;
    await summary.locator(`button.summary-section[data-edit="${edit}"]`).click();
  }
  await stageTab.click();
  await expect(stageTab).toHaveAttribute('aria-selected', 'true');
  if (part) {
    const partTab = page.locator(`button.editor-part[data-part="${part}"]`);
    await partTab.click();
    await expect(partTab).toHaveAttribute('aria-selected', 'true');
  }
}

/** Done: back to the read-only summary. */
export async function finishEditing(page: Page): Promise<void> {
  await page.locator('.editor-head button.editor-done').click();
  await expect(page.locator('.summary-panel')).toBeVisible();
}

/** Make sure the read-only summary is showing (Done, if the editor is). */
export async function showSummary(page: Page): Promise<void> {
  const summary = page.locator('.summary-panel');
  await expect(summary.or(page.locator('.editor-head button.editor-done'))).toBeVisible({ timeout: 15_000 });
  if (!(await summary.isVisible())) await finishEditing(page);
}

/** The open row's editor (lamp, zone or obstacle), inside the editor list. */
export function openEditor(page: Page): Locator {
  return page.locator('.editor-body .editor-row.open .row-body');
}

/** Click corners given as fractions of the plan canvas, then optionally close with Enter. */
export async function clickPlan(page: Page, corners: [number, number][], opts: { close?: boolean } = {}): Promise<void> {
  const plan = planSvg(page);
  const box = await plan.boundingBox();
  if (!box) throw new Error('plan canvas not visible');
  for (const [fx, fy] of corners) {
    await plan.click({ position: { x: box.width * fx, y: box.height * fy } });
  }
  if (opts.close) await page.keyboard.press('Enter');
}
