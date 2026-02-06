/**
 * Store for tracking calculation progress across the app.
 * Used to show a global progress bar at the bottom of the screen.
 */
import { writable, derived, get } from 'svelte/store';

interface CalculationProgressState {
	isCalculating: boolean;
	estimatedSeconds: number;
	startTime: number | null;
}

const initialState: CalculationProgressState = {
	isCalculating: false,
	estimatedSeconds: 0,
	startTime: null
};

function createCalculationProgressStore() {
	const { subscribe, set, update } = writable<CalculationProgressState>(initialState);

	let intervalId: ReturnType<typeof setInterval> | null = null;
	const elapsedSeconds = writable(0);

	function startCalculation(estimatedSeconds: number) {
		// Clear any existing interval
		if (intervalId) {
			clearInterval(intervalId);
		}

		// Reset elapsed time
		elapsedSeconds.set(0);

		// Start tracking
		update((state) => ({
			...state,
			isCalculating: true,
			estimatedSeconds: Math.max(1, estimatedSeconds),
			startTime: Date.now()
		}));

		// Update elapsed time every 100ms
		intervalId = setInterval(() => {
			elapsedSeconds.update((n) => n + 0.1);
		}, 100);
	}

	function stopCalculation() {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}

		set(initialState);
		elapsedSeconds.set(0);
	}

	// Derived store for progress percentage (capped at 95% until complete)
	const progressPercent = derived(
		[{ subscribe }, elapsedSeconds],
		([$state, $elapsed]) => {
			if (!$state.isCalculating || $state.estimatedSeconds <= 0) return 0;
			const percent = ($elapsed / $state.estimatedSeconds) * 100;
			return Math.min(95, percent);
		}
	);

	// Derived store for time remaining text
	const timeRemaining = derived(
		[{ subscribe }, elapsedSeconds],
		([$state, $elapsed]) => {
			if (!$state.isCalculating || $state.estimatedSeconds <= 0) return '';
			const remaining = Math.max(0, $state.estimatedSeconds - $elapsed);
			if (remaining < 1) return 'Almost done...';
			if (remaining < 60) return `~${Math.ceil(remaining)}s remaining`;
			const minutes = Math.floor(remaining / 60);
			const seconds = Math.ceil(remaining % 60);
			return `~${minutes}m ${seconds}s remaining`;
		}
	);

	return {
		subscribe,
		startCalculation,
		stopCalculation,
		progressPercent,
		timeRemaining,
		elapsedSeconds: { subscribe: elapsedSeconds.subscribe }
	};
}

export const calculationProgress = createCalculationProgressStore();
