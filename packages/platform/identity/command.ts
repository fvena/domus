// `pnpm accounts` (ADR 0023): the one procedure that creates accounts and changes their password. Its core takes
// the platform, a way to ask for the secret and an output; the terminal wrapper in apps/api only wires them. The
// password is asked for interactively and never taken as an argument: the parser refuses it, and no line the
// command writes or error it reports carries it. Changing a password with the command ends every session of the
// account.

import { areasOf, clockOf, connectionOf, type Platform } from "../platform";
import {
	accountByEmail,
	createAccountWithPassword,
	passwordProblem,
	replacePassword,
} from "./passwords";

/** How the command talks to the operator. */
export interface AccountsTerminal {
	/** Asks for a secret without echo. Rejects when the operator gives up. */
	askSecret(prompt: string): Promise<string>;
	/** Writes one line of output. */
	print(line: string): void;
	/** Writes one line of error. */
	fail(line: string): void;
}

/**
 * Runs one command on the platform and returns its exit code: 0 when done, 1 when refused. Prints one line in
 * either case, and none carries the secret.
 */
export async function runAccounts(
	platform: Platform,
	command: AccountsCommand,
	terminal: AccountsTerminal,
): Promise<number> {
	const connection = connectionOf(platform);
	const now = clockOf(platform);
	const email = command.email.toLowerCase();
	try {
		const found = accountByEmail(connection, email);
		if (command.kind === "create") {
			if (found) return refuse(terminal, `an account with the email ${email} already exists`);
			const password = await askNewPassword(terminal);
			if (password === undefined) return 1;
			await createAccountWithPassword(
				connection,
				{ name: command.name, email, role: command.role },
				areasOf(platform),
				password,
				now(),
			);
			terminal.print(`created the ${command.role} account ${email}`);
			return 0;
		}

		if (!found) return refuse(terminal, `no account has the email ${email}`);
		if (found.role === "device")
			return refuse(
				terminal,
				"the device account has no password: it is paired, not signed in",
			);
		const password = await askNewPassword(terminal);
		if (password === undefined) return 1;
		const ended = await replacePassword(connection, found.id, password, now());
		terminal.print(`changed the password of ${email} and ended its ${ended} sessions`);
		return 0;
	} catch {
		// An unexpected error's message is not shown: nothing guarantees it leaves the secret out.
		return refuse(terminal, "nothing was changed: the command stopped before finishing");
	}
}

/** Asks for the new password twice. `undefined`, with the reason written, when it is refused. */
async function askNewPassword(terminal: AccountsTerminal): Promise<string | undefined> {
	const password = await terminal.askSecret("New password: ");
	const problem = passwordProblem(password);
	if (problem) {
		terminal.fail(problem);
		return undefined;
	}
	const again = await terminal.askSecret("Repeat it: ");
	if (again !== password) {
		terminal.fail("the two passwords do not match");
		return undefined;
	}
	return password;
}

function refuse(terminal: AccountsTerminal, reason: string): number {
	terminal.fail(reason);
	return 1;
}

/** What the command is asked to do, once its arguments are read. */
export type AccountsCommand =
	| {
			readonly kind: "create";
			readonly email: string;
			readonly name: string;
			readonly role: "admin" | "member";
	  }
	| { readonly kind: "password"; readonly email: string };

/** The arguments read, or why they were refused. An error never repeats an argument's value. */
export type ParsedAccountsArguments =
	| { readonly command: AccountsCommand }
	| { readonly error: string };

/** How the command is called, for the operator. */
export const ACCOUNTS_USAGE = [
	"usage:",
	"  accounts create --email <email> --name <name> --role <admin|member>",
	"  accounts password --email <email>",
	"The password is asked for without echo; it is never an argument.",
].join("\n");

/** The options each subcommand takes. */
const OPTIONS = {
	create: ["email", "name", "role"],
	password: ["email"],
} as const;

/** Names an operator might use to pass a secret on the command line. */
const SECRET_OPTION = /^(p|pass|passwd|password|pwd|secret)$/i;

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** Reads the command's arguments: a subcommand and its options, as `--name value` or `--name=value`. */
export function parseAccountsArguments(args: readonly string[]): ParsedAccountsArguments {
	const [subcommand, ...rest] = args;
	if (subcommand === undefined)
		return { error: "accounts needs a subcommand: create or password" };
	if (subcommand !== "create" && subcommand !== "password")
		return { error: "unknown subcommand: use create or password" };

	const allowed: readonly string[] = OPTIONS[subcommand];
	const values = new Map<string, string>();
	for (let index = 0; index < rest.length; index++) {
		const token = rest[index] ?? "";
		const option = /^--?([^=]*)(?:=([^]*))?$/.exec(token);
		// Never repeat a stray value: it may be the password.
		if (!option) return { error: "unexpected argument: every value follows its option" };
		const name = option[1] ?? "";
		if (SECRET_OPTION.test(name))
			return {
				error: "the password is never an argument: the command asks for it without echo",
			};
		if (!/^[a-z][a-z-]*$/.test(name)) return { error: "unknown option" };
		if (!allowed.includes(name)) return { error: `unknown option --${name} for ${subcommand}` };
		if (values.has(name)) return { error: `--${name} is given twice` };
		let value = option[2];
		if (value === undefined) {
			const next = rest[index + 1];
			if (next === undefined || next.startsWith("-"))
				return { error: `--${name} needs a value` };
			value = next;
			index++;
		}
		values.set(name, value);
	}

	const email = values.get("email")?.trim();
	if (!email) return { error: "--email is required" };
	if (!EMAIL.test(email)) return { error: "--email must be an email address" };
	if (subcommand === "password") return { command: { kind: "password", email } };

	const name = values.get("name")?.trim();
	if (!name) return { error: "--name is required" };
	const role = values.get("role");
	if (role === undefined) return { error: "--role is required: admin or member" };
	if (role !== "admin" && role !== "member") return { error: "--role must be admin or member" };
	return { command: { kind: "create", email, name, role } };
}
