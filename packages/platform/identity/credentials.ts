// What the keys and the mandates of the connected apps share (ADR 0030): the exact form of their random parts and
// the hash the database keeps of them, so a copy of it holds no usable credential.
import { createHash } from "node:crypto";

/** Whether `text` is the one base64url form, without padding, of exactly `bytes` bytes. */
export function encodesBytes(text: string, bytes: number): boolean {
	const decoded = Buffer.from(text, "base64url");
	return decoded.length === bytes && decoded.toString("base64url") === text;
}

/** The SHA-256 of `text`, in hex: what the database keeps of a key's secret or a mandate's id. */
export function sha256Hex(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}
