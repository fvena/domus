// How the background waits (ADR 0025): it never sets a timer of its own, it asks the platform's timer to wake it
// at an instant of the platform clock. In production that is a real timer; in tests, one the test controls.
import type { Clock } from "../actions";

export interface Timer {
	/** Calls `wake` once, at `instant` of the platform clock or soon after. Returns what cancels it. */
	at(instant: number, wake: () => void): () => void;
}

/** A real timer over `clock`: it waits from now until `instant`. */
export function realTimer(clock: Clock): Timer {
	return {
		at(instant, wake) {
			const timeout = setTimeout(wake, Math.max(0, instant - clock()));
			return () => clearTimeout(timeout);
		},
	};
}

/** A timer that wakes only when asked: {@link ControlledTimer.fire} wakes what is due by the clock it reads. */
export interface ControlledTimer extends Timer {
	/** Wakes, in order of their instants, every wait due by the clock, also those a wake arms that are already due. */
	fire(): void;
}

export function controlledTimer(clock: Clock): ControlledTimer {
	let waits: { instant: number; wake: () => void }[] = [];
	return {
		at(instant, wake) {
			const wait = { instant, wake };
			waits.push(wait);
			return () => {
				waits = waits.filter((other) => other !== wait);
			};
		},
		fire() {
			for (;;) {
				const now = clock();
				const due = waits
					.filter((wait) => wait.instant <= now)
					.sort((a, b) => a.instant - b.instant)[0];
				if (!due) return;
				waits = waits.filter((wait) => wait !== due);
				due.wake();
			}
		},
	};
}
