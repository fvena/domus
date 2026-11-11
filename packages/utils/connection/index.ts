// Keeps checking whether another program can be used: connecting (it does not answer), ready, or
// incompatible (it answers, but in a version this program cannot speak). Callers act only when ready.

export type ConnectionState = "connecting" | "ready" | "incompatible";

export interface WatchOptions {
	/** Resolves with what the other side answered; throws when it cannot be reached. */
	check: () => Promise<"ready" | "incompatible">;
	onChange?: (state: ConnectionState) => void;
	/** How to wait; tests pass one that returns at once. */
	sleep?: (ms: number) => Promise<void>;
}

export interface ConnectionWatch {
	readonly state: ConnectionState;
	stop(): void;
	/** Settles once stopped. */
	readonly done: Promise<void>;
}

/** Waits after each failed attempt; the last one repeats. */
const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
/** Wait before checking again once it answered, ready or incompatible. */
const RECHECK_MS = 30_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function watchConnection({
	check,
	onChange = () => {},
	sleep = wait,
}: WatchOptions): ConnectionWatch {
	let state: ConnectionState = "connecting";
	let stopped = false;
	let failures = 0;

	const set = (next: ConnectionState) => {
		if (next === state) return;
		state = next;
		onChange(next);
	};

	const run = async () => {
		while (!stopped) {
			let delay: number;
			try {
				set(await check());
				failures = 0;
				delay = RECHECK_MS;
			} catch {
				set("connecting");
				delay = RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length - 1)] ?? RECHECK_MS;
				failures++;
			}
			if (!stopped) await sleep(delay);
		}
	};

	return {
		get state() {
			return state;
		},
		stop() {
			stopped = true;
		},
		done: run(),
	};
}
