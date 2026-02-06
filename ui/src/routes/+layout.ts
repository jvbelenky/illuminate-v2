// When building for desktop (adapter-static with fallback),
// disable SSR so all pages are rendered client-side.
// This file is harmless for the web build (adapter-auto ignores these).
export const ssr = false;
