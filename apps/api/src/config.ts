import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { BackupConfig } from "@domus/platform";
import { readPort } from "@domus/utils/program";

export interface ApiConfig {
	port: number;
	/** The built web app (apps/web/dist) the API serves as a SPA; unset in development, where Vite serves it. */
	webDir: string | undefined;
	/** `domus.db` inside `DOMUS_DATA_DIR`: `/data` in Docker, `<repo>/data` under `pnpm dev` (ADR 0021). */
	databaseFile: string;
	/** How sessions are signed and where the app is served from (ADR 0023). */
	auth: {
		/** `DOMUS_AUTH_SECRET`: at least 32 characters, kept outside the repository. */
		secret: string;
		/** `DOMUS_ORIGINS`: the origins the app is served from, separated by commas. */
		origins: string[];
	};
	/**
	 * Where the backups go and the file of their password (ADR 0026): `DOMUS_BACKUP_REPOSITORY` and
	 * `DOMUS_BACKUP_PASSWORD_FILE`, both or neither. Unset: off, with neither or with `DOMUS_BACKUPS_OFF=1`.
	 */
	backups: BackupConfig | undefined;
}

const MIN_SECRET_LENGTH = 32;

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
	return {
		port: readPort(env.PORT, 3000),
		webDir: env.DOMUS_WEB_DIR || undefined,
		databaseFile: readDatabaseFile(env),
		auth: {
			secret: readSecret(env.DOMUS_AUTH_SECRET),
			origins: readOrigins(env.DOMUS_ORIGINS),
		},
		backups: readBackups(env),
	};
}

/**
 * The backups' configuration. With the switch they are off whatever else is set; with neither path, off; with one,
 * api does not start. The repository's folder is checked by each backup, not here; the password file must be
 * readable and not empty. Never echoes the password.
 */
function readBackups(env: NodeJS.ProcessEnv): BackupConfig | undefined {
	const off = env.DOMUS_BACKUPS_OFF;
	if (off === "1") return undefined;
	if (off) throw new Error(`DOMUS_BACKUPS_OFF must be 1 or unset, got "${off}"`);

	if (!env.DOMUS_BACKUP_REPOSITORY && !env.DOMUS_BACKUP_PASSWORD_FILE) return undefined;
	return readBackupTarget(env);
}

/** What `restore.mjs` needs of the configuration (ADR 0026). */
export interface RestoreConfig {
	readonly databaseFile: string;
	readonly backups: BackupConfig;
}

/**
 * The database and the repository `restore.mjs` works on: both paths of the backups are required, and the switch
 * does not matter, since it turns off the backup tasks of `api`, not restoring. It needs no session secret.
 */
export function readRestoreConfig(env: NodeJS.ProcessEnv = process.env): RestoreConfig {
	return { databaseFile: readDatabaseFile(env), backups: readBackupTarget(env) };
}

/** The repository and the readable, non-empty password file. Never echoes the password. */
function readBackupTarget(env: NodeJS.ProcessEnv): BackupConfig {
	const repository = backupPath(env, "DOMUS_BACKUP_REPOSITORY", "DOMUS_BACKUP_PASSWORD_FILE");
	const passwordFile = backupPath(env, "DOMUS_BACKUP_PASSWORD_FILE", "DOMUS_BACKUP_REPOSITORY");

	let password: string;
	try {
		password = readFileSync(passwordFile, "utf8");
	} catch {
		throw new Error(
			`DOMUS_BACKUP_PASSWORD_FILE "${passwordFile}" cannot be read: it must be a file this process can read`,
		);
	}
	if (password.trim() === "")
		throw new Error(`DOMUS_BACKUP_PASSWORD_FILE "${passwordFile}" is empty`);
	return { repository, passwordFile };
}

/** One of the two paths of the backups, once the other is set: required and absolute. */
function backupPath(env: NodeJS.ProcessEnv, name: string, other: string): string {
	const value = env[name];
	if (!value)
		throw new Error(
			`${name} is required with ${other}: set both to turn the backups on, or neither (or DOMUS_BACKUPS_OFF=1) to leave them off`,
		);
	if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path, got "${value}"`);
	return value;
}

/** `domus.db` inside `DOMUS_DATA_DIR`: all `pnpm accounts` needs of the configuration. */
export function readDatabaseFile(env: NodeJS.ProcessEnv = process.env): string {
	return join(readDataDir(env.DOMUS_DATA_DIR), "domus.db");
}

function readDataDir(value: string | undefined): string {
	if (!value) {
		throw new Error(
			"DOMUS_DATA_DIR is required: the absolute path of the data folder (for example /data)",
		);
	}
	if (!isAbsolute(value))
		throw new Error(`DOMUS_DATA_DIR must be an absolute path, got "${value}"`);
	return value;
}

/** Never echoes the value: it is a secret. */
function readSecret(value: string | undefined): string {
	if (!value || value.length < MIN_SECRET_LENGTH)
		throw new Error(
			`DOMUS_AUTH_SECRET is required, with at least ${MIN_SECRET_LENGTH} characters (for example the output of: openssl rand -base64 32)`,
		);
	return value;
}

function readOrigins(value: string | undefined): string[] {
	const origins = (value ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin !== "");
	if (origins.length === 0)
		throw new Error(
			"DOMUS_ORIGINS is required: the origins the app is served from, separated by commas (for example http://kira.local:3000)",
		);
	return origins.map((origin) => {
		let url: URL;
		try {
			url = new URL(origin);
		} catch {
			throw new Error(`DOMUS_ORIGINS has "${origin}", which is not a URL`);
		}
		if (url.origin !== origin)
			throw new Error(
				`DOMUS_ORIGINS has "${origin}": write only the origin, such as ${url.origin}`,
			);
		return origin;
	});
}
