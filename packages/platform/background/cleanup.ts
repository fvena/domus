// The cleanup (ADR 0025, ADR 0022): maintenance of the platform, without actions and without an actor. It never
// changes an answer: in the action log it empties the content (input and inverse) of the entries whose
// `expiresAt` passed, which nothing reads any more, and keeps their annotation, key and fingerprint, so a
// repeated write is still acknowledged and every account still reads its annotations. Cleaning twice changes
// nothing.
import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import type { ScheduledTask } from "./scheduler";

export const CLEANUP_TASK = "cleanup";

export function cleanupTask(connection: Database.Database, clock: Clock): ScheduledTask {
	const emptyExpiredContent = connection.prepare(
		`UPDATE platform_action_log SET input = NULL, inverse = NULL
			WHERE expires_at <= ? AND (input IS NOT NULL OR inverse IS NOT NULL)`,
	);
	return {
		id: CLEANUP_TASK,
		frequency: { every: "day", at: "04:30" },
		job: {
			lane: "maintenance",
			run({ signal }) {
				signal.throwIfAborted();
				emptyExpiredContent.run(clock());
			},
		},
	};
}
