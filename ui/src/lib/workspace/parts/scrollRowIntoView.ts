import { tick } from 'svelte';

/** Scroll the editor row for a new item to the top of its list (a no-op where scrollIntoView is missing, as in jsdom). */
export async function scrollRowIntoView(id: string): Promise<void> {
  await tick();
  const el = document.querySelector(`.editor-row[data-id="${CSS.escape(id)}"]`);
  if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
