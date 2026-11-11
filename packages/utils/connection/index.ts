// Keeps checking whether another program can be used: connecting (it does not answer), ready, or
// incompatible (it answers, but in a version this program cannot speak). Callers act only when ready.

export type ConnectionState = "connecting" | "ready" | "incompatible";

/** What a check found: the other side answered in a version this program speaks, or in another. */
export type CheckResult = "ready" | "incompatible";

export interface WatchOptions {
	/**
	 * Asks the other side once. Throws when it cannot be reached. The signal aborts when the check
	 * takes too long; the watch stops waiting then even if the check ignores it.
	 */
	check: (signal: AbortSignal) => Promise<CheckResult>;
	onChange?: (state: ConnectionState) => void;
	/** How to wait between checks; tests pass one that returns at once. */
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
/** A check that has not answered by then counts as unreachable. */
const CHECK_TIMEOUT_MS = 10_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function checkWithTimeout(check: WatchOptions["check"]): Promise<CheckResult> {
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new Error("check timed out")),
		CHECK_TIMEOUT_MS,
	);
	try {
		return await new Promise<CheckResult>((resolve, reject) => {
			controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
				once: true,
			});
			check(controller.signal).then(resolve, reject);
		});
	} finally {
		clearTimeout(timer);
	}
}

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
				set(await checkWithTimeout(check));
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
