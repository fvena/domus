// restic as a child process (ADR 0026). It always runs with `--no-cache`, and it gets the repository and the
// password file through its environment, never its arguments. Its environment is built here and holds nothing else
// of `api`'s: the session secret never reaches it. `TZ=UTC` makes `--time` read in UTC.
import { spawn } from "node:child_process";

/** Where the backups go and how to open them. Both are absolute paths. */
export interface BackupConfig {
	/** The folder of the restic repository. */
	readonly repository: string;
	/** The file that holds the repository's password. */
	readonly passwordFile: string;
}

/** restic as one backup configuration runs it. */
export interface Restic {
	/** Runs restic with `args` in `cwd`, and settles with its exit code and its standard output. */
	run(args: readonly string[], cwd?: string): Promise<ResticResult>;
}

export interface ResticResult {
	readonly code: number;
	readonly stdout: string;
}

/** The exit code of restic when the repository does not exist (restic 0.17 and later). */
export const REPOSITORY_MISSING = 10;

/** restic from `executable` (a path, or a name the `PATH` finds) on the repository of `config`. */
export function restic(executable: string, config: BackupConfig): Restic {
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
		run: (args, cwd) =>
			new Promise((resolve, reject) => {
				const child = spawn(executable, [...args, "--no-cache"], {
					env,
					...(cwd === undefined ? {} : { cwd }),
					stdio: ["ignore", "pipe", "ignore"],
				});
				const chunks: Buffer[] = [];
				child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
				child.on("error", reject);
				child.on("close", (code) =>
					resolve({ code: code ?? -1, stdout: Buffer.concat(chunks).toString("utf8") }),
				);
			}),
	};
}
