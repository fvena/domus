// restic as a child process (ADR 0026). It always runs with `--no-cache`, and it gets the repository and the
// password file through its environment, never its arguments. Its environment is built here and holds nothing else
// of `api`'s: the session secret never reaches it. `TZ=UTC` makes `--time` read in UTC. A cancelled job ends it
// as any child of the backups.
import { type ChildResult, runChild, type Waiting } from "./child";

/** Where the backups go and how to open them. Both are absolute paths. */
export interface BackupConfig {
	/** The folder of the restic repository. */
	readonly repository: string;
	/** The file that holds the repository's password. */
	readonly passwordFile: string;
}

/** restic as one backup configuration runs it. */
export interface Restic {
	/**
	 * Runs restic with `args` in `cwd`, and settles with its exit code and its standard output once it ended. When
	 * `signal` aborts, restic is ended and the run rejects as cancelled.
	 */
	run(args: readonly string[], signal: AbortSignal, cwd?: string): Promise<ResticResult>;
}

export type ResticResult = ChildResult;

/** The exit code of restic when the repository does not exist (restic 0.17 and later). */
export const REPOSITORY_MISSING = 10;
/** The exit code of restic when another process holds a lock of the repository it needs. */
export const REPOSITORY_LOCKED = 11;

/**
 * A step of restic found the repository locked by another process: a passing error, which the engine retries. The
 * engine keeps only its name and code, so the code says the step and restic's exit code.
 */
export class ResticLockedError extends Error {
	override readonly name = "ResticLockedError";
	readonly code: string;

	constructor(step: string) {
		super(`restic ${step} found the repository locked`);
		this.code = `${step}-${REPOSITORY_LOCKED}`;
	}
}

/**
 * restic from `executable` (a path, or a name the `PATH` finds) on the repository of `config`, waiting on the
 * platform's clock and timer to kill one that ignores SIGTERM.
 */
export function restic(executable: string, config: BackupConfig, waiting: Waiting): Restic {
	const env: NodeJS.ProcessEnv = {
		RESTIC_REPOSITORY: config.repository,
		RESTIC_PASSWORD_FILE: config.passwordFile,
		TZ: "UTC",
	};
	for (const name of ["PATH", "HOME", "TMPDIR"] as const) {
		const value = process.env[name];
		if (value !== undefined) env[name] = value;
	}

	return {
		run: (args, signal, cwd) =>
			runChild(
				executable,
				[...args, "--no-cache"],
				{ env, signal, ...(cwd === undefined ? {} : { cwd }) },
				waiting,
			),
	};
}
