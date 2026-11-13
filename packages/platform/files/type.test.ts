import { describe, expect, it } from "vitest";

import { detectFileType } from "./type";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The bytes of an ASCII text. */
function ascii(text: string): number[] {
	return Array.from(text, (character) => character.charCodeAt(0));
}

/** The header of a WebP: `RIFF`, its size, `WEBP` and the four letters of its first chunk. */
function webp(firstChunk: string, form = "WEBP"): number[] {
	return [...ascii("RIFF"), 0x24, 0x00, 0x00, 0x00, ...ascii(form), ...ascii(firstChunk)];
}

/** An ISO BMFF `ftyp` box: its size, `ftyp`, the main brand, a minor version and the compatible brands. */
function ftyp(
	main: string,
	compatible: readonly string[],
	size = 16 + 4 * compatible.length,
): number[] {
	return [
		size >>> 24,
		(size >>> 16) & 0xff,
		(size >>> 8) & 0xff,
		size & 0xff,
		...ascii("ftyp"),
		...ascii(main),
		0x00,
		0x00,
		0x00,
		0x00,
		...compatible.flatMap((brand) => ascii(brand)),
	];
}

/** What the detector says for content that arrives in the given chunks. */
function detect(...chunks: readonly (readonly number[] | string)[]) {
	const detector = detectFileType();
	for (const chunk of chunks)
		detector.push(
			typeof chunk === "string" ? new TextEncoder().encode(chunk) : Uint8Array.from(chunk),
		);
	return detector.finish();
}

describe("recognizing the type", () => {
	it("recognizes a JPEG by its header alone", () => {
		expect(detect([0xff, 0xd8, 0xff])).toBe("image/jpeg");
	});

	it("recognizes a PNG by its signature alone", () => {
		expect(detect(PNG)).toBe("image/png");
	});

	it.each(["VP8 ", "VP8L", "VP8X"])(
		"recognizes a WebP whose first chunk is %s by its header alone",
		(chunk) => {
			expect(detect(webp(chunk))).toBe("image/webp");
		},
	);

	it.each(["%PDF-1.7", "%PDF-2.0"])("recognizes a PDF by its header %s alone", (header) => {
		expect(detect(header)).toBe("application/pdf");
	});

	it.each(["heic", "heix", "heim", "heis", "hevc", "hevx"])(
		"recognizes a HEIC whose main brand is %s by its ftyp box alone",
		(brand) => {
			expect(detect(ftyp(brand, ["mif1", brand]))).toBe("image/heic");
		},
	);

	it("recognizes a HEIC whose own brand is only among the compatible ones", () => {
		expect(detect(ftyp("mif1", ["mif1", "miaf", "heic"]))).toBe("image/heic");
	});

	it("does not take an AVIF for a HEIC", () => {
		expect(detect(ftyp("avif", ["avif", "mif1", "miaf"]))).toBeUndefined();
	});

	it("does not take a file with only the mif1 brand for a HEIC", () => {
		expect(detect(ftyp("mif1", ["mif1"]))).toBeUndefined();
	});

	it.each([
		["a JPEG cut after its first marker", [0xff, 0xd8]],
		["a JPEG with no marker after its start", [0xff, 0xd8, 0x00, 0x10]],
		["a PNG cut inside its signature", PNG.slice(0, 6)],
		["a PNG with a wrong signature", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0x0a]],
		["a WebP cut inside its first chunk", ascii("RIFFabcdWEBPVP8")],
		["a WebP with an unknown first chunk", ascii("RIFFabcdWEBPABCD")],
		["a RIFF that is not a WebP", ascii("RIFFabcdWAVEfmt ")],
		["a HEIC cut inside its ftyp box", ftyp("heic", ["mif1", "heic"]).slice(0, 22)],
		["an ftyp box whose size outgrows the content", ascii("    ftypheic")],
		["an ftyp box too small for its brands", ftyp("heic", [], 12)],
		["an ftyp box whose size splits a brand", [...ftyp("heic", ["heic"], 18), 0x20, 0x20]],
		["a PDF cut inside its version", ascii("%PDF-1")],
		["a PDF with a version that is not a number", ascii("%PDF-x.y")],
		["a PDF with a malformed version", ascii("%PDF-1,7")],
	])("rejects %s, and does not take it for text", (_case, bytes) => {
		expect(detect(bytes)).toBeUndefined();
	});

	it("recognizes a header that arrives one byte at a time, followed by the rest of the file", () => {
		const header = ftyp("mif1", ["mif1", "heic"]);
		expect(
			detect(
				...header.map((byte) => [byte]),
				Array.from({ length: 100_000 }, () => 0x00),
				[0xff],
			),
		).toBe("image/heic");
	});

	it("rejects an ftyp box that names HEIC but outgrows 4 KB", () => {
		const brands = [...Array.from({ length: 1020 }, () => "mif1"), "heic"];
		expect(detect(ftyp("mif1", brands))).toBeUndefined();
	});

	it("is no class for random bytes", () => {
		let seed = 2026;
		/** A byte of a small, repeatable generator. */
		const randomByte = () => {
			seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
			return seed >>> 23;
		};
		for (const size of [16, 512, 8192, 70_000])
			expect(
				detect(Array.from({ length: size }, randomByte)),
				`${size} bytes`,
			).toBeUndefined();
	});

	it("does not take for text a long text with a null byte past its first 4 KB", () => {
		expect(detect("a".repeat(10_000), "b\0")).toBeUndefined();
	});

	it("takes valid UTF-8 without null bytes for plain text", () => {
		expect(
			detect(
				"Lista de la compra:\n- leche\n- pan de molde 🍞\n",
				"Llamar al técnico de la nevera.\n",
			),
		).toBe("text/plain");
	});

	it("takes a text whose characters fall split between chunks", () => {
		const bytes = [...new TextEncoder().encode("ñ🍞")];
		expect(
			detect(bytes.slice(0, 1), bytes.slice(1, 3), bytes.slice(3, 4), bytes.slice(4)),
		).toBe("text/plain");
	});

	it.each([
		["a lone continuation byte", [0x61, 0x80, 0x62]],
		["an overlong encoding", [0xc0, 0xaf]],
		["a surrogate", [0xed, 0xa0, 0x80]],
		["a character beyond U+10FFFF", [0xf4, 0x90, 0x80, 0x80]],
		["a character cut at the end", [0x61, 0xe2, 0x82]],
	])("does not take for text invalid UTF-8 with %s", (_case, bytes) => {
		expect(detect(bytes)).toBeUndefined();
	});

	it.each([
		["at the start", ["\0hola"]],
		["in the middle", ["ho", "l\0a"]],
		["at the end", ["hola\0"]],
		["alone in the last chunk", ["hola", "\0"]],
	])("does not take for text a content with a null byte %s", (_case, chunks) => {
		expect(detect(...chunks)).toBeUndefined();
	});

	it("is no class for an empty content", () => {
		expect(detect()).toBeUndefined();
	});
});
