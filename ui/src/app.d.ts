// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			/** The phone's view is full screen (its history entry, so the back button leaves it). */
			mobileFullView?: boolean;
		}
		// interface Platform {}
	}
}

export {};
