/**
 * A click handler that stays attached and ignores clicks while `blocked()` is
 * true. Threlte registers an object's `onclick` when the object is created, so
 * switching a handler from undefined to a function later never takes effect:
 * keep one function and gate it instead.
 */
export function guardedClick<A extends unknown[]>(handler: (...args: A) => void, blocked: () => boolean): (...args: A) => void {
	return (...args: A) => {
		if (!blocked()) handler(...args);
	};
}
