import { describe, expect, it } from "vitest";

import { readFileName } from "./name";

describe("validating the name", () => {
	it("takes a name with accents and emojis, decoded from its URL encoding", () => {
		expect(readFileName(encodeURIComponent("Factura de la luz – León 🧾.pdf"))?.name).toBe(
			"Factura de la luz – León 🧾.pdf",
		);
	});

	it("rejects an absent name", () => {
		expect(readFileName(undefined)).toBeUndefined();
	});

	it("rejects an empty name", () => {
		expect(readFileName("")).toBeUndefined();
	});

	it.each([
		["a cut escape", "nota%2"],
		["an escape that is not hexadecimal", "nota%zz.txt"],
		["escapes that are not UTF-8", "nota%ff%fe.txt"],
		["a character cut in its escapes", "le%C3"],
		["an encoded surrogate", "a%ED%A0%80"],
		["an overlong encoding", "a%C0%AF"],
		["a raw character outside ASCII", "León.pdf"],
		["a raw control character", "nota\t.txt"],
	])("rejects a name with %s", (_case, header) => {
		expect(readFileName(header)).toBeUndefined();
	});

	it("measures the name in bytes once decoded: 255 are taken, 256 are not", () => {
		const of255 = `${"ñ".repeat(127)}a`;
		const of256 = "ñ".repeat(128);
		expect(readFileName(encodeURIComponent(of255))?.name).toBe(of255);
		expect(readFileName(encodeURIComponent(of256))).toBeUndefined();
	});

	it.each([
		["a slash", "fotos/nevera.jpg"],
		["a backslash", "fotos\\nevera.jpg"],
		["a null byte", "nevera\0.jpg"],
		["a new line", "nevera\n.jpg"],
		["a delete", "nevera\u007f.jpg"],
		["a C1 control character", "nevera\u0085.jpg"],
		["only a dot", "."],
		["only two dots", ".."],
	])("rejects a decoded name with %s", (_case, name) => {
		expect(readFileName(encodeURIComponent(name))).toBeUndefined();
	});

	it("gives the name sanitized for Content-Disposition, in ASCII and in UTF-8", () => {
		expect(readFileName(encodeURIComponent(`Factura – León "luz" 100%.pdf`))?.disposition).toBe(
			`attachment; filename="Factura _ Le_n _luz_ 100_.pdf"; filename*=UTF-8''Factura%20%E2%80%93%20Le%C3%B3n%20%22luz%22%20100%25.pdf`,
		);
	});

	it("escapes in Content-Disposition what a URL leaves bare and RFC 8187 does not", () => {
		expect(readFileName(encodeURIComponent("l'ampolla (2)*🍞.txt"))?.disposition).toBe(
			`attachment; filename="l'ampolla (2)*_.txt"; filename*=UTF-8''l%27ampolla%20%282%29%2A%F0%9F%8D%9E.txt`,
		);
	});

	it("takes a name that only begins with dots or holds spaces", () => {
		expect(readFileName(encodeURIComponent("..nota de voz .txt"))?.name).toBe(
			"..nota de voz .txt",
		);
	});
});
