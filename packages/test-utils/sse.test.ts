// The reader of a live channel's stream: whole events, whatever way the bytes are split.
import { describe, expect, it } from "vitest";

import { readEvents } from "./sse";

/** A stream that hands over `text`'s bytes in pieces of `size`, cutting lines and characters anywhere. */
function streamOf(text: string, size: number): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(text);
	let at = 0;
	return new ReadableStream({
		pull(controller) {
			if (at >= bytes.length) controller.close();
			else {
				controller.enqueue(bytes.slice(at, at + size));
				at += size;
			}
		},
	});
}

const TEXT =
	'event: ready\ndata: {}\n\n: heartbeat\n\nevent: invalidate\ndata: {"records":[{"module":"probe","type":"note","id":1,"body":"leña"}]}\n\r\nevent: purge\r\ndata: {}\r\n\r\n';

describe("the reader of a channel", () => {
	it.each([1, 2, 3, 7, 1000])(
		"reads whole events with the bytes split every %i",
		async (size) => {
			const events = readEvents(streamOf(TEXT, size));
			expect(await events.next()).toEqual({ event: "ready", data: {} });
			expect(await events.next()).toEqual({ comment: "heartbeat" });
			expect(await events.next()).toEqual({
				event: "invalidate",
				data: { records: [{ module: "probe", type: "note", id: 1, body: "leña" }] },
			});
			expect(await events.next()).toEqual({ event: "purge", data: {} });
			expect(await events.next()).toBe("end");
			expect(await events.next()).toBe("end");
		},
	);

	it("leaves out an event cut at the end of the stream", async () => {
		const events = readEvents(streamOf("event: ready\ndata: {}\n\nevent: reset\ndata: {", 4));
		expect(await events.next()).toEqual({ event: "ready", data: {} });
		expect(await events.next()).toBe("end");
	});

	it("stops reading when cancelled", async () => {
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({
			cancel: () => {
				cancelled = true;
			},
		});
		await readEvents(stream).cancel();
		expect(cancelled).toBe(true);
	});
});
