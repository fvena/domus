/** The raw value of `X-File-Name`: printable ASCII, since the name travels in UTF-8 encoded as a URL. */
const RAW = /^[\x20-\x7e]*$/;

/** The longest name, in bytes of UTF-8. */
const MAX_BYTES = 255;

/** A path separator or a control character, C0, delete or C1. */
const FORBIDDEN = /[/\\\p{Cc}]/u;

/** What the ASCII fallback of `Content-Disposition` replaces: outside printable ASCII, a quote, a backslash or `%`. */
const NOT_PLAIN = /[^\x20-\x7e]|["\\%]/gu;

/** A file name as it is kept, and as `Content-Disposition` carries it when the file is served. */
export interface FileName {
	readonly name: string;
	readonly disposition: string;
}

/** The name decoded, or `undefined` when its encoding is not valid UTF-8 encoded as a URL. */
function decode(header: string): string | undefined {
	if (!RAW.test(header)) return undefined;
	try {
		return decodeURIComponent(header);
	} catch {
		return undefined;
	}
}

/**
 * The value of `Content-Disposition` for a kept name: an ASCII `filename` where each other character becomes `_`, for
 * old clients, and the whole name in `filename*` as UTF-8 (RFC 8187).
 */
export function contentDisposition(name: string): string {
	const plain = name.replace(NOT_PLAIN, "_");
	const encoded = encodeURIComponent(name).replace(
		/['()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

/**
 * Reads the value of `X-File-Name` (ADR 0028, «Subir»): UTF-8 encoded as a URL, from 1 to 255 bytes once decoded,
 * without a path separator or a control character, and neither `.` nor `..`. Gives the name to keep and its
 * `Content-Disposition`, or `undefined` when the name is absent or not valid. Pure.
 */
export function readFileName(header: string | undefined): FileName | undefined {
	const name = header === undefined ? undefined : decode(header);
	if (name === undefined || name === "" || name === "." || name === "..") return undefined;
	if (new TextEncoder().encode(name).length > MAX_BYTES || FORBIDDEN.test(name)) return undefined;
	return { name, disposition: contentDisposition(name) };
}
