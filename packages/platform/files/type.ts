/** The six classes of content a file may have, by the type it is served with. */
export type FileType =
	| "image/jpeg"
	| "image/png"
	| "image/webp"
	| "image/heic"
	| "application/pdf"
	| "text/plain";

/** The first bytes the detector keeps: enough for every header it reads, an `ftyp` box included. */
const HEAD_LIMIT = 4096;

/** The `ftyp` brands of HEIC itself; `mif1` alone is not one, since AVIF uses it too. */
const HEIC_BRANDS = ["heic", "heix", "heim", "heis", "hevc", "hevx"];
const WEBP_CHUNKS = ["VP8 ", "VP8L", "VP8X"];

/**
 * A class recognized by its signature. A content that opens with its `magic` claims that class: it is of the class
 * when its `header` is whole and well formed, and of none otherwise, never plain text.
 */
interface Signature {
	readonly type: Exclude<FileType, "text/plain">;
	readonly magic: { readonly offset: number; readonly bytes: readonly number[] | string };
	readonly header: (head: Uint8Array) => boolean;
}

/** Whether `bytes` hold `expected` at `offset`, as bytes or as ASCII letters. */
function holds(bytes: Uint8Array, offset: number, expected: readonly number[] | string): boolean {
	const wanted =
		typeof expected === "string"
			? Array.from(expected, (letter) => letter.charCodeAt(0))
			: expected;
	return (
		offset + wanted.length <= bytes.length &&
		wanted.every((byte, index) => bytes[offset + index] === byte)
	);
}

/** Whether the byte at `offset` is an ASCII digit. */
function digitAt(bytes: Uint8Array, offset: number): boolean {
	const byte = bytes[offset];
	return byte !== undefined && byte >= 0x30 && byte <= 0x39;
}

/** Whether `head` opens with a whole `ftyp` box that names a HEIC brand, as its main brand or a compatible one. */
function heicBox(head: Uint8Array): boolean {
	const size = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0);
	if (size < 16 || (size - 16) % 4 !== 0 || size > head.length) return false;
	const brands = [8];
	for (let offset = 16; offset < size; offset += 4) brands.push(offset);
	return brands.some((offset) => HEIC_BRANDS.some((brand) => holds(head, offset, brand)));
}

const SIGNATURES: readonly Signature[] = [
	{
		type: "image/jpeg",
		magic: { offset: 0, bytes: [0xff, 0xd8] },
		header: (head) => head[2] === 0xff,
	},
	{
		type: "image/png",
		magic: { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
		header: (head) => holds(head, 4, [0x0d, 0x0a, 0x1a, 0x0a]),
	},
	{
		type: "image/webp",
		magic: { offset: 0, bytes: "RIFF" },
		header: (head) =>
			holds(head, 8, "WEBP") && WEBP_CHUNKS.some((chunk) => holds(head, 12, chunk)),
	},
	{ type: "image/heic", magic: { offset: 4, bytes: "ftyp" }, header: heicBox },
	{
		type: "application/pdf",
		magic: { offset: 0, bytes: "%PDF-" },
		header: (head) => digitAt(head, 5) && holds(head, 6, ".") && digitAt(head, 7),
	},
];

/**
 * Recognizes the type of a content from its bytes as they arrive (ADR 0028, «Qué promete el tipo»): `push` each
 * chunk in order, then `finish` says its class, or `undefined` when it is of none. It rejects unknown signatures and
 * the truncated or malformed headers it reads; it does not promise the format is whole. Pure: no disk, no clock.
 */
export function detectFileType() {
	let head = new Uint8Array(0);
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let text = true;

	/** Feeds the check of plain text: valid UTF-8 from start to end, without null bytes. */
	function readText(chunk: Uint8Array, stream: boolean) {
		if (!text) return;
		try {
			decoder.decode(chunk, { stream });
		} catch {
			text = false;
		}
		if (chunk.includes(0)) text = false;
	}

	return {
		push(chunk: Uint8Array) {
			readText(chunk, true);
			if (head.length >= HEAD_LIMIT) return;
			const kept = chunk.subarray(0, HEAD_LIMIT - head.length);
			const next = new Uint8Array(head.length + kept.length);
			next.set(head);
			next.set(kept, head.length);
			head = next;
		},
		finish(): FileType | undefined {
			const claimed = SIGNATURES.find(({ magic }) => holds(head, magic.offset, magic.bytes));
			if (claimed) return claimed.header(head) ? claimed.type : undefined;
			readText(new Uint8Array(0), false);
			return text && head.length > 0 ? "text/plain" : undefined;
		},
	};
}
