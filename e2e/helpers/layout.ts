import { type Page, expect } from '@playwright/test';

/**
 * Switch the sidebar between the guided layout (default: next-step card,
 * numbered steps, standard zones without per-row toggles) and the expert
 * layout (flat, everything open, every toggle visible) through the View menu.
 */
export async function setSidebarLayout(page: Page, layout: 'guided' | 'expert'): Promise<void> {
  await page.locator('.menu-bar-item').filter({ hasText: 'View' }).locator('span').first().click();
  const submenuParent = page.locator('.menu-item.has-submenu[data-submenu="layout"]');
  await submenuParent.hover();
  await submenuParent.locator('.menu-submenu .menu-item').filter({ hasText: layout === 'expert' ? 'Expert' : 'Guided' }).click();
  await expect(page.locator('.steps')).toHaveClass(layout === 'expert' ? /expert/ : /^(?!.*expert).*$/);
  // Toggle-style menu items leave the menu open; close it so the next call starts clean.
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-dropdown')).toHaveCount(0);
}
