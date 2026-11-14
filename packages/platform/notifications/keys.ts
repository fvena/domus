// The VAPID keys of the platform (ADR 0029, «Las claves VAPID»): one pair, generated the first time the platform
// opens and kept in its database, so it travels with the backup. Not a secret of Docker: losing it only makes the
// devices subscribe again. The server hands out the public one; the private one never leaves here but to sign.
import { createECDH } from "node:crypto";

import type Database from "better-sqlite3";

/** The length of a P-256 private key, in bytes. */
const PRIVATE_KEY_LENGTH = 32;

/** The pair of VAPID keys, each in base64url: the public one as an uncompressed P-256 point. */
export interface PushKeys {
	readonly publicKey: string;
	readonly privateKey: string;
}

/** Creates the pair of VAPID keys when there is none yet, and returns the one kept. */
export function ensurePushKeys(connection: Database.Database, now: number): PushKeys {
	const ecdh = createECDH("prime256v1");
	ecdh.generateKeys();
	// The private key may come shorter when it starts with zeros: VAPID wants all 32 bytes.
	const privateKey = Buffer.alloc(PRIVATE_KEY_LENGTH);
	const raw = ecdh.getPrivateKey();
	raw.copy(privateKey, PRIVATE_KEY_LENGTH - raw.length);
	connection
		.prepare(
			`INSERT INTO platform_push_keys (id, public_key, private_key, created_at)
			VALUES (1, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
		)
		.run(ecdh.getPublicKey().toString("base64url"), privateKey.toString("base64url"), now);
	const kept = connection
		.prepare<[], PushKeys>(
			"SELECT public_key AS publicKey, private_key AS privateKey FROM platform_push_keys WHERE id = 1",
		)
		.get();
	if (!kept) throw new Error("the VAPID keys were not kept");
	return kept;
}

/**
 * The subject of VAPID: the first `https` origin the app is served from, never a personal mail address. Without
 * one the platform does not send.
 */
export function vapidSubject(origins: readonly string[]): string | undefined {
	return origins
		.filter((origin) => URL.canParse(origin))
		.map((origin) => new URL(origin))
		.find((url) => url.protocol === "https:")?.origin;
}
