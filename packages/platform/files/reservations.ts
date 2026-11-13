// The reservations of the uploads in progress (spec of phase 1d3, «Reservas de espacio»): before its first byte, an
// upload reserves its declared size in the memory of `api` against the limit of its session, counting its uploads
// in progress and its prepared files still usable, and against the free space of the volume, less every live
// reservation. A reservation ends when its upload does, however it ends; its temporary file is removed first, so a
// temporary file outside every live reservation is one an upload left behind.
import { statfsSync } from "node:fs";

import { fileError } from "./failures";

/** The most a session may hold at once, in uploads in progress and prepared files still usable. */
const SESSION_FILES = 20;
const SESSION_BYTES = 200 * 1024 * 1024;

/** What the volume must keep free once every reservation is counted: 2 GB. */
const KEPT_FREE = 2 * 1024 * 1024 * 1024;

/** The free bytes of the volume of `directory`, for an unprivileged process. */
export type FreeSpace = (directory: string) => number;

/** The free space of the volume as `statfs` tells it. */
export const volumeFreeSpace: FreeSpace = (directory) => {
	const { bavail, bsize } = statfsSync(directory);
	return bavail * bsize;
};

/** What a session holds in prepared files still usable: neither expired nor consumed. */
export type PreparedHeld = (session: string) => { readonly files: number; readonly bytes: number };

/** The space an upload holds while it is received: ends once, also when it never started. */
export interface Reservation {
	release(): void;
}

export interface Reservations {
	/**
	 * Reserves `size` bytes for the upload of `session` whose temporary file is named `temporary`, or throws the
	 * error of the limit it passes: the session's first, then the volume's.
	 */
	reserve(upload: {
		readonly session: string;
		readonly temporary: string;
		readonly size: number;
	}): Reservation;
	/** Whether the temporary file named `temporary` belongs to a live reservation: an upload still in progress. */
	holds(temporary: string): boolean;
}

export function createReservations({
	directory,
	prepared,
	freeSpace = volumeFreeSpace,
}: {
	/** A folder on the volume the uploads are written to. */
	readonly directory: () => string;
	readonly prepared: PreparedHeld;
	readonly freeSpace?: FreeSpace;
}): Reservations {
	/** The live reservations, by the name of their temporary file. */
	const live = new Map<string, { readonly session: string; readonly size: number }>();
	const sum = (sizes: readonly number[]) => sizes.reduce((total, size) => total + size, 0);

	return {
		reserve: ({ session, temporary, size }) => {
			const own = [...live.values()].filter((reservation) => reservation.session === session);
			const held = prepared(session);
			if (
				held.files + own.length + 1 > SESSION_FILES ||
				held.bytes + sum(own.map((reservation) => reservation.size)) + size > SESSION_BYTES
			)
				throw fileError("UPLOAD_LIMIT");
			const reserved = sum([...live.values()].map((reservation) => reservation.size));
			if (freeSpace(directory()) - reserved - size < KEPT_FREE)
				throw fileError("INSUFFICIENT_STORAGE");
			live.set(temporary, { session, size });
			return { release: () => live.delete(temporary) };
		},
		holds: (temporary) => live.has(temporary),
	};
}
