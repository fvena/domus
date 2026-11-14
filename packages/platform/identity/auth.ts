// Signing in with Better Auth (ADR 0023): email and password only, open sign-up off, no session cached in the
// cookie, over the platform's one connection through the Drizzle adapter. Each session is born on a device:
// the device cookie names it when it is known, and a new device is created otherwise. Which device a session
// belongs to is kept on the server; the cookie is not a credential. Each session entering a device writes a new
// `entry` on it before it is created, and the same value as its own `deviceEntry`: the session the device has
// enabled for notices is the one that matches (ADR 0029).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { account, session, user, verification } from "../schema";
import { randomId } from "./accounts";
import type { SessionsEnded } from "./sessions";

/** The cookie that names the device; another one than the session's, and it outlives signing out. */
export const DEVICE_COOKIE = "domus.device";

/** As long as browsers keep a cookie: 400 days, in seconds. */
const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** Where Better Auth's routes live. */
export const AUTH_PREFIX = "/api/auth";

export interface AuthOptions {
	/** The secret that signs the session cookie: at least 32 characters, never in the repository. */
	readonly secret: string;
	/**
	 * The origins the app is served from, such as `http://kira.local:3000`. Better Auth answers on these hosts
	 * only, and a request that carries cookies must come from one of them.
	 */
	readonly origins: readonly string[];
}

/** One session as the door needs it: its id, its account and its device. */
export interface SessionRecord {
	readonly id: string;
	readonly account: string;
	readonly device: string;
}

/** What signing in and out tells the rest of the platform about a session entering a device or leaving it. */
export interface EntryHooks {
	/**
	 * After Better Auth deleted a session: signing out, the way of ending a session that does not go through
	 * `endSessions`. Better Auth also deletes here one it found expired, which had already ended.
	 */
	readonly ended?: SessionsEnded;
	/**
	 * Once the device's new `entry` is written, with no transaction open, and before the session is created: where a
	 * test waits.
	 */
	readonly entering?: () => Promise<void> | void;
	/** After the session was created, by its id. */
	readonly entered?: (session: string) => void;
}

export interface Auth {
	/** Better Auth's own handler, for the routes the door lets through. */
	handler(request: Request): Promise<Response>;
	/**
	 * The session the request's cookie names, read from the database on every call, or `null`. `headers`
	 * collects what Better Auth wants to set in the response, such as a refreshed cookie.
	 */
	sessionOf(request: Request, headers: Headers): Promise<SessionRecord | null>;
}

const MIN_SECRET_LENGTH = 32;

export function createAuth(
	connection: Database.Database,
	{ secret, origins }: AuthOptions,
	{ entering, entered, ended }: EntryHooks = {},
): Auth {
	if (secret.length < MIN_SECRET_LENGTH)
		throw new Error(`the auth secret must have at least ${MIN_SECRET_LENGTH} characters`);
	const [fallback] = origins;
	if (fallback === undefined) throw new Error("the auth needs at least one origin");

	const deviceExists = connection.prepare<[string], 1>(
		"SELECT 1 FROM platform_devices WHERE id = ?",
	);
	const insertDevice = connection.prepare<[string, number]>(
		"INSERT INTO platform_devices (id, created_at) VALUES (?, ?)",
	);
	const writeEntry = connection.prepare<[string, string]>(
		"UPDATE platform_devices SET entry = ? WHERE id = ?",
	);

	const tables = {
		platform_user: user,
		platform_session: session,
		platform_account: account,
		platform_verification: verification,
	};

	const auth = betterAuth({
		secret,
		basePath: AUTH_PREFIX,
		baseURL: {
			allowedHosts: origins.map((origin) => new URL(origin).host),
			fallback,
		},
		trustedOrigins: [...origins],
		database: drizzleAdapter(drizzle({ client: connection, schema: tables }), {
			provider: "sqlite",
			schema: tables,
		}),
		emailAndPassword: { enabled: true, disableSignUp: true },
		user: { modelName: "platform_user" },
		account: { modelName: "platform_account" },
		verification: { modelName: "platform_verification" },
		session: {
			modelName: "platform_session",
			// Every request reads its session from the database: a revoked one fails on the next request.
			cookieCache: { enabled: false },
			additionalFields: {
				deviceId: { type: "string", required: true, input: false, returned: true },
				deviceEntry: { type: "string", required: true, input: false, returned: false },
			},
		},
		telemetry: { enabled: false },
		databaseHooks: {
			session: {
				create: {
					before: async (data, context) => {
						if (!context) throw new Error("a session is born only from a request");
						const known = context.getCookie(DEVICE_COOKIE);
						let device = known;
						if (device === null || deviceExists.get(device) === undefined) {
							device = randomId();
							insertDevice.run(device, Date.now());
						}
						context.setCookie(DEVICE_COOKIE, device, {
							httpOnly: true,
							sameSite: "lax",
							path: "/",
							maxAge: DEVICE_COOKIE_MAX_AGE,
							secure: new URL(context.request?.url ?? fallback).protocol === "https:",
						});
						// Written before the session exists and never given back: from here no earlier session of the
						// device is enabled, and if the creation fails, none is.
						const entry = randomId();
						writeEntry.run(entry, device);
						await entering?.();
						return { data: { ...data, deviceId: device, deviceEntry: entry } };
					},
					after: async (created) => {
						entered?.(created.id);
					},
				},
				delete: {
					after: async (deleted) => {
						ended?.([deleted.id], "sign-out");
					},
				},
			},
		},
	});

	return {
		handler: (request) => auth.handler(request),
		sessionOf: async (request, headers) => {
			const found = await auth.api.getSession({
				headers: request.headers,
				returnHeaders: true,
			});
			for (const cookie of found.headers.getSetCookie()) headers.append("set-cookie", cookie);
			const current = found.response;
			if (!current) return null;
			return {
				id: current.session.id,
				account: current.user.id,
				device: current.session.deviceId,
			};
		},
	};
}
