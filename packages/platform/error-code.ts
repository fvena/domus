/** The `code` of a thrown error, such as `ENOENT` or `SQLITE_BUSY`, when it has one that is a string. */
export function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const { code } = error as { code?: unknown };
	return typeof code === "string" ? code : undefined;
}
