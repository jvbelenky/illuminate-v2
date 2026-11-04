import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// One colour per meaning: blue (--color-highlight) for the active category, cyan
// (--color-scene-selected) for one selected object, red for primary actions, amber for warnings.
const src = (path: string) => readFileSync(resolve(__dirname, '..', '..', path), 'utf8');

/** The declarations of the first rule whose selector list ends with `selector {`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

describe('colour roles', () => {
  it('active tabs and pressed controls use the category blue, not red', () => {
    expect(rule(src('lib/components/ViewSnapOverlay.svelte'), '.view-btn.active')).toContain('var(--color-highlight)');
    expect(rule(src('lib/components/SettingsModal.svelte'), '.tab-btn.active')).toContain('var(--color-highlight)');
    const adv = src('lib/components/AdvancedLampSettingsModal.svelte');
    expect(rule(adv, '.tab-btn.active')).toContain('var(--color-highlight)');
    expect(rule(adv, '.lamp-tab.active')).toContain('var(--color-highlight)');
    const editor = src('lib/workspace/EditorPanel.svelte');
    expect(rule(editor, '.editor-stage.on')).toContain('var(--color-highlight)');
    expect(rule(editor, '.editor-part.on')).toContain('var(--color-highlight)');
    expect(rule(src('lib/workspace/zones/zones.css'), ".zone-panel .seg button[aria-pressed='true']")).toContain('var(--color-highlight)');
    // The edit strip's armed tools take the shared .mv-btn pressed fill
    expect(src('lib/plan/PlanEditStrip.svelte')).not.toContain(".tool[aria-pressed='true']");
  });

  it('idle lamps and points on the plan are neutral, not amber or blue', () => {
    const pane = src('lib/plan/PlanPane.svelte');
    for (const sel of ['.plan-lamp', '.plan-aim', '.aim-line', '.plan-zone', '.ceiling-item']) {
      const body = rule(pane, sel);
      expect(body).toContain('var(--color-scene-item)');
      expect(body).not.toContain('--color-warning');
      expect(body).not.toContain('--color-info');
    }
  });

  it('the open row is a raised card with no bar down its side', () => {
    const row = src('lib/workspace/parts/ItemRow.svelte');
    expect(row).not.toContain('inset 3px');
    const open = rule(row, '.editor-row.open');
    expect(open).toContain('var(--color-card-raised)');
    expect(open).toContain('var(--shadow-card-raised)');
  });

  it('calculated zone cards keep the neutral border', () => {
    expect(src('lib/components/ZoneStatsPanel.svelte')).not.toMatch(/\.zone-card\.calculated\s*\{/);
  });
});
