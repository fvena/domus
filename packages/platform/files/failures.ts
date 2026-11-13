// The errors of the file routes (spec of phase 1d3, «Errores de las rutas de archivos»): each an ORPCError with
// its code and HTTP status, answered as the JSON of `toJSON()` without the RPC envelope, so the app reads the same
// `code` and `data` as from an RPC. None carries anything of the original failure.
import { ORPCError } from "@orpc/server";

import { internalError } from "../actions/failures";

/** The codes of the upload route that oRPC does not know, with their HTTP status. */
const STATUS = {
	LENGTH_REQUIRED: 411,
	FILE_EMPTY: 400,
	FILE_TOO_LARGE: 413,
	INVALID_FILE_NAME: 400,
	FILE_TYPE_NOT_ALLOWED: 415,
	CONTENT_BUSY: 503,
} as const;

export type FileErrorCode = keyof typeof STATUS;

/** An error of the file routes by its code, with the status of the spec's table. */
export function fileError(code: FileErrorCode): ORPCError<FileErrorCode, undefined> {
	return new ORPCError(code, { status: STATUS[code] });
}

/** How long the app waits before it tries a busy content again, in seconds. */
const BUSY_RETRY_AFTER = "1";

/**
 * The answer of a file route to what it threw: an ORPCError as its JSON and status, `CONTENT_BUSY` with
 * `Retry-After`, and anything else as an internal error that says nothing of it.
 */
export function errorResponse(error: unknown): Response {
	const answered = error instanceof ORPCError ? error : internalError();
	const headers = new Headers();
	if (answered.code === "CONTENT_BUSY") headers.set("retry-after", BUSY_RETRY_AFTER);
	return Response.json(answered.toJSON(), { status: answered.status, headers });
}
