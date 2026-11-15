// The real gitleaks for the tests, found as the pre-commit hook finds it: the one on PATH only at the version the hook
// pins, or else its Docker image. Without either, the tests fail with what to install, never skip.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const hook = join(import.meta.dirname, "../../.githooks/pre-commit");

/** One finding: the file, relative to the scanned folder, and the id of the rule that flagged it. */
export interface Finding {
	file: string;
	rule: string;
}

export interface Gitleaks {
	/** Scans a folder (not a repository) with a configuration file and returns what it finds. */
	scan(folder: string, config: string): Finding[];
}

/** How one scan runs: the command and its arguments, and the folder as gitleaks sees it. */
interface Invocation {
	command: string;
	args: string[];
	seen: string;
}

/** What the command prints on stdout when it runs and exits 0, or `undefined`. */
function printed(executable: string, args: string[]): string | undefined {
	try {
		return execFileSync(executable, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return undefined;
	}
}

/** Answers when the command runs and exits 0. */
function answers(executable: string, args: string[]): boolean {
	try {
		execFileSync(executable, args, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** The image the hook pins, so the tests, the hook and CI scan with the same version. */
export function pinnedImage(): string {
	const image = /^GITLEAKS_IMAGE=(\S+)$/m.exec(readFileSync(hook, "utf8"))?.[1];
	if (image === undefined) throw new Error(`no GITLEAKS_IMAGE in ${hook}`);
	return image;
}

/** `gitleaks dir`, redacted so a secret never reaches the output, with findings read from a JSON report. */
function dirScan(folder: string, config: string, report: string): string[] {
	return [
		"dir",
		folder,
		"--config",
		config,
		"--redact",
		"--no-banner",
		"--exit-code",
		"0",
		"--report-format",
		"json",
		"--report-path",
		report,
	];
}

/** A scanner from how to invoke one scan, given the folder and the configuration and a folder for the report. */
function scanner(invoke: (folder: string, config: string, output: string) => Invocation): Gitleaks {
	return {
		scan(folder, config) {
			const output = mkdtempSync(join(tmpdir(), "domus-gitleaks-report-"));
			try {
				const { command, args, seen } = invoke(folder, config, output);
				// stderr kept for the error: it is redacted.
				execFileSync(command, args, { stdio: ["ignore", "ignore", "pipe"] });
				const report = JSON.parse(readFileSync(join(output, "report.json"), "utf8")) as {
					File: string;
					RuleID: string;
				}[];
				return report.map(({ File, RuleID }) => ({
					file: relative(seen, File),
					rule: RuleID,
				}));
			} finally {
				rmSync(output, { recursive: true, force: true });
			}
		},
	};
}

/** The version of the image the hook pins, as `gitleaks version` prints it, without the `v`. */
function pinnedVersion(): string {
	return pinnedImage().replace(/^.*:v/, "");
}

/**
 * The gitleaks to scan with: the one on PATH at the pinned version, or else the pinned image. Throws, with what
 * to install, when there is neither.
 */
export function findGitleaks({ gitleaks = "gitleaks", docker = "docker" } = {}): Gitleaks {
	if (printed(gitleaks, ["version"])?.trim().replace(/^v/, "") === pinnedVersion()) {
		return scanner((folder, config, output) => ({
			command: gitleaks,
			args: dirScan(folder, config, join(output, "report.json")),
			seen: folder,
		}));
	}
	if (answers(docker, ["info"])) {
		const image = pinnedImage();
		// Pulled and run here, once, so no scan waits for the download or for the first container to start: on a
		// cold CI runner that first start alone took longer than a test's 5 s.
		if (!answers(docker, ["image", "inspect", image]))
			execFileSync(docker, ["pull", "--quiet", image], { stdio: "ignore" });
		execFileSync(docker, ["run", "--rm", image, "version"], { stdio: "ignore" });
		// As the user running the tests, so the report is theirs and the folders need no wider permissions.
		const user = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
		return scanner((folder, config, output) => ({
			command: docker,
			args: [
				"run",
				"--rm",
				"--user",
				user,
				"-v",
				`${folder}:/scan:ro`,
				"-v",
				`${config}:/config.toml:ro`,
				"-v",
				`${output}:/report`,
				image,
				...dirScan("/scan", "/config.toml", "/report/report.json"),
			],
			seen: "/scan",
		}));
	}
	throw new Error(`gitleaks is required: start Docker, or install gitleaks ${pinnedVersion()}`);
}
