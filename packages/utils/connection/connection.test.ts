import { afterEach, describe, expect, it, vi } from "vitest";

import { type ConnectionState, watchConnection } from ".";

/** Runs a watch over a scripted list of answers ("down" throws) and records every wait. */
async function script(answers: Array<"ready" | "incompatible" | "down">) {
	const waits: number[] = [];
	const states: ConnectionState[] = [];
	let i = 0;
	const watch = watchConnection({
		check: async () => {
			const answer = answers[i++];
			if (answer === "down" || answer === undefined) throw new Error("down");
			return answer;
		},
		onChange: (state) => states.push(state),
		sleep: async (ms) => {
			waits.push(ms);
			if (i >= answers.length) watch.stop();
		},
	});
	await watch.done;
	return { waits, states, final: watch.state };
}

describe("watchConnection", () => {
	it("waits longer after each failure, up to 30 seconds", async () => {
		const { waits, final } = await script([
			"down",
			"down",
			"down",
			"down",
			"down",
			"down",
			"down",
			"ready",
		]);
		expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
		expect(final).toBe("ready");
	});

	it("stays incompatible and checks again every 30 seconds", async () => {
		const { waits, states, final } = await script([
			"incompatible",
			"incompatible",
			"incompatible",
		]);
		expect(final).toBe("incompatible");
		expect(states).not.toContain("ready");
		expect(waits).toEqual([30_000, 30_000, 30_000]);
	});

	it("becomes ready once the other side speaks the same version", async () => {
		const { states } = await script(["incompatible", "ready"]);
		expect(states).toEqual(["incompatible", "ready"]);
	});

	it("leaves ready when the other side changes version or goes away", async () => {
		const { states } = await script(["ready", "incompatible", "down"]);
		expect(states).toEqual(["ready", "incompatible", "connecting"]);
	});

	it("starts again from one second after a failure that follows an answer", async () => {
		const { waits } = await script(["down", "down", "ready", "down"]);
		expect(waits).toEqual([1_000, 2_000, 30_000, 1_000]);
	});

	describe("a check that never answers", () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it("leaves ready after 10 seconds without an answer, and aborts the check", async () => {
			vi.useFakeTimers();
			const signals: AbortSignal[] = [];
			const states: ConnectionState[] = [];
			let sleeps = 0;
			const watch = watchConnection({
				check: (signal) => {
					signals.push(signal);
					return signals.length === 1 ? Promise.resolve("ready") : new Promise(() => {});
				},
				onChange: (state) => states.push(state),
				sleep: async () => {
					if (++sleeps === 2) watch.stop();
				},
			});
			await vi.advanceTimersByTimeAsync(10_000);
			await watch.done;
			expect(states).toEqual(["ready", "connecting"]);
			expect(signals[1]?.aborted).toBe(true);
		});
	});
});
