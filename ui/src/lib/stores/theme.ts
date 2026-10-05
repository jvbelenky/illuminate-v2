/**
 * Theme store for light/dark mode toggle.
 * Persists user preference to localStorage.
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'illuminate-theme';

function getInitialTheme(): Theme {
	if (!browser) return 'dark';

	// A saved choice wins; otherwise the app is dark regardless of the
	// system preference (light is opt-in from the View menu).
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark') {
		return stored;
	}
	return 'dark';
}

function createThemeStore() {
	const { subscribe, set, update } = writable<Theme>(getInitialTheme());

	return {
		subscribe,
		set: (theme: Theme) => {
			if (browser) {
				localStorage.setItem(STORAGE_KEY, theme);
				document.documentElement.setAttribute('data-theme', theme);
			}
			set(theme);
		},
		toggle: () => {
			update(current => {
				const newTheme = current === 'dark' ? 'light' : 'dark';
				if (browser) {
					localStorage.setItem(STORAGE_KEY, newTheme);
					document.documentElement.setAttribute('data-theme', newTheme);
				}
				return newTheme;
			});
		},
		init: () => {
			if (browser) {
				const theme = getInitialTheme();
				document.documentElement.setAttribute('data-theme', theme);
				set(theme);
			}
		}
	};
}

export const theme = createThemeStore();
