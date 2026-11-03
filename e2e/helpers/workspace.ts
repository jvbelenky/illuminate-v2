import { type Locator, type Page, expect } from '@playwright/test';

export type Stage = 'room' | 'lamps' | 'zones';
export type Part = 'floorplan' | 'structures' | 'reflectance';

/** The 2D plan canvas (the main view's, not the docked mini view's). */
export function planSvg(page: Page): Locator {
  return page.locator('.view-slot[data-view="2d"]:not(.mini) .plan-pane svg.plan');
}

/** Choose the main view with the 2D | 3D switch (buttons labelled "2D" / "3D"). */
export async function showMain(page: Page, view: '2d' | '3d'): Promise<void> {
  const button = page.locator('[aria-label="Main view"]').getByRole('button', { name: view.toUpperCase(), exact: true });
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

/** The ceiling designer's window. */
export function ceilingDesigner(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Ceiling designer' });
}

/** The ceiling designer's own plan canvas. */
export function designerPlan(page: Page): Locator {
  return ceilingDesigner(page).locator('.cd-plan svg.plan');
}

/** Tools › Ceiling designer… */
export async function openCeilingDesigner(page: Page): Promise<Locator> {
  const tools = page.locator('.menu-bar-item').filter({ hasText: 'Tools' }).locator('span[role="button"]');
  await tools.click();
  await page.getByRole('menuitem', { name: 'Ceiling designer…' }).click();
  const designer = ceilingDesigner(page);
  await expect(designer.locator('.ceiling-part')).toBeVisible();
  return designer;
}

/** Done: back to the read-only summary. */
export async function finishEditing(page: Page): Promise<void> {
  await page.locator('button.editor-done').click();
  await expect(page.locator('.summary-panel')).toBeVisible();
}

/** Make sure the read-only summary is showing (Done, if the editor is). */
export async function showSummary(page: Page): Promise<void> {
  const summary = page.locator('.summary-panel');
  await expect(summary.or(page.locator('button.editor-done'))).toBeVisible({ timeout: 15_000 });
  if (!(await summary.isVisible())) await finishEditing(page);
}

/** The open row's editor (lamp, zone or obstacle), inside the editor list. */
export function openEditor(page: Page): Locator {
  return page.locator('.editor-body .editor-row.open .row-body');
}

/**
 * A point on the selected shape's body (the canvas itself, not a length label
 * or a handle drawn over it), in page pixels: a double-click there edits its corners.
 */
export async function shapeBodyPoint(page: Page, plan: Locator): Promise<[number, number]> {
  const b = (await plan.locator('polygon.outline').boundingBox())!;
  const svg = await plan.elementHandle();
  const hit = await page.evaluate(([x0, y0, w, h, el]) => {
    for (const fy of [0.5, 0.3, 0.7, 0.4, 0.6, 0.2, 0.8]) {
      for (const fx of [0.5, 0.3, 0.7, 0.4, 0.6, 0.2, 0.8]) {
        const x = x0 + w * fx, y = y0 + h * fy;
        if (document.elementFromPoint(x, y) === el) return [x, y];
      }
    }
    return null;
  }, [b.x, b.y, b.width, b.height, svg] as const);
  if (!hit) throw new Error('no free point on the shape body');
  return hit as [number, number];
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
