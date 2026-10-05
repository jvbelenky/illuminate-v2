/**
 * Viewport breakpoints as stores.
 *
 * `isMobile` is true below 768 px, the same breakpoint the modal sheet
 * (`Modal.svelte`) and the page layout use. It is false during SSR and in
 * environments without `matchMedia`, and follows live viewport changes.
 */
import { readable } from 'svelte/store';

export const MOBILE_QUERY = '(max-width: 767px)';

export const isMobile = readable<boolean>(false, (set) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mql = window.matchMedia(MOBILE_QUERY);
  set(mql.matches);
  const onChange = (e: { matches: boolean }) => set(e.matches);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
});
