// `pnpm accounts` (ADR 0023): creates an account or changes its password, from a terminal. In the `api` container
// it runs as `node /app/accounts.mjs`; on a development machine as `pnpm accounts`. Only wiring: the platform
// reads the arguments and does the work, and this file opens the platform and asks for the secret without echo.
import {
	ACCOUNTS_USAGE,
	createPlatform,
	parseAccountsArguments,
	runAccounts,
} from "@domus/platform";

import { readDatabaseFile } from "./config";
import { modules } from "./modules";

const parsed = parseAccountsArguments(process.argv.slice(2));
if ("error" in parsed) {
	console.error(`error: ${parsed.error}\n${ACCOUNTS_USAGE}`);
	process.exit(2);
}
if (!process.stdin.isTTY) {
	console.error("error: accounts asks for the password in a terminal; run it with one");
	process.exit(2);
}

const platform = createPlatform({ databaseFile: readDatabaseFile(), modules });
void runAccounts(platform, parsed.command, {
	askSecret,
	print: (line) => console.log(line),
	fail: (line) => console.error(`error: ${line}`),
})
	.then((code) => {
		process.exitCode = code;
	})
	.finally(() => platform.close());

/** Reads one line from the terminal without showing it. Ctrl+C or Ctrl+D gives up. */
function askSecret(prompt: string): Promise<string> {
	const { stdin, stdout } = process;
	stdout.write(prompt);
	stdin.setRawMode(true);
	stdin.resume();
	stdin.setEncoding("utf8");
	return new Promise((resolve, reject) => {
		let secret = "";
		const done = (error?: Error) => {
			stdin.off("data", onData);
			stdin.setRawMode(false);
			stdin.pause();
			stdout.write("\n");
			if (error) reject(error);
			else resolve(secret);
		};
		const onData = (chunk: string) => {
			for (const character of chunk) {
				if (character === "\r" || character === "\n") return done();
				if (character === "\u0003" || character === "\u0004")
					return done(new Error("cancelled"));
				if (character === "\u007f" || character === "\b") secret = secret.slice(0, -1);
				else secret += character;
			}
		};
		stdin.on("data", onData);
	});
}
