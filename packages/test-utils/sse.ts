// A reader of the live channel's stream for tests (ADR 0029): it gives whole events, each with its name and its
// data parsed as JSON, and comments such as the heartbeat, whatever way the bytes arrive split. It reads only when
// asked, so a test that stops asking is a client that stops reading.
import type { TestBrowser } from "./browser";
import { TEST_ORIGIN } from "./platform";

/** Where a browser opens its live channel. */
const EVENTS_PATH = "/api/events";

/** An event of the channel, or a comment line. */
export type ChannelItem =
	| { readonly event: string; readonly data: unknown }
	| { readonly comment: string };

export interface EventReader {
	/** The next event or comment, or `end` once the stream ended. */
	next(): Promise<ChannelItem | "end">;
	/** Stops reading, as a closed tab does: the stream is cancelled. */
	cancel(): Promise<void>;
}

/** Reads the events of `stream`, such as the body of `GET /api/events`. */
export function readEvents(stream: ReadableStream<Uint8Array>): EventReader {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let ended = false;
	const ready: ChannelItem[] = [];

	/** Moves every whole block of the buffer, up to a blank line, into `ready`. */
	function parseBlocks(): void {
		buffer = buffer.replace(/\r\n?/g, "\n");
		let end = buffer.indexOf("\n\n");
		while (end !== -1) {
			const item = itemOf(buffer.slice(0, end));
			if (item) ready.push(item);
			buffer = buffer.slice(end + 2);
			end = buffer.indexOf("\n\n");
		}
	}

	return {
		async next() {
			while (ready.length === 0 && !ended) {
				const { done, value } = await reader.read();
				if (done) {
					ended = true;
					buffer += decoder.decode();
				} else buffer += decoder.decode(value, { stream: true });
				// A carriage return at the very end may be half of a CRLF: wait for what follows.
				if (!ended && buffer.endsWith("\r")) continue;
				parseBlocks();
			}
			return ready.shift() ?? "end";
		},
		cancel: () => reader.cancel(),
	};
}

/** A live channel a browser opened: the door's answer and the reader of its stream. */
export interface OpenChannel extends EventReader {
	readonly response: Response;
}

/**
 * Opens the live channel of `browser`'s session through the door, as the app's `EventSource` does. A refused one,
 * such as without a session, throws with the door's answer.
 */
export async function openChannel(browser: TestBrowser): Promise<OpenChannel> {
	const response = await browser.fetch(
		new Request(new URL(EVENTS_PATH, TEST_ORIGIN), {
			headers: { accept: "text/event-stream" },
		}),
	);
	if (response.status !== 200 || !response.body)
		throw new Error(`the channel was refused: ${response.status} ${await response.text()}`);
	return { response, ...readEvents(response.body) };
}

/** One block of lines: an event with its name and data, or a comment. */
function itemOf(block: string): ChannelItem | undefined {
	let event: string | undefined;
	const data: string[] = [];
	const comments: string[] = [];
	for (const line of block.split("\n")) {
		if (line.startsWith(":")) comments.push(line.slice(1).trimStart());
		else if (line.startsWith("event:")) event = line.slice(6).trimStart();
		else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
	}
	if (event !== undefined || data.length > 0)
		return { event: event ?? "message", data: JSON.parse(data.join("\n")) as unknown };
	return comments.length > 0 ? { comment: comments.join("\n") } : undefined;
}
