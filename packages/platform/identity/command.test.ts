import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHttpHandler } from "../http";
import { createPlatform, type Platform } from "../platform";
import { parseAccountsArguments, runAccounts } from "./command";

const SECRET = "a-very-secret-passphrase";
const NEW_SECRET = "the-new-passphrase";
const auth = { secret: "a-secret-only-for-the-tests-of-accounts", origins: ["http://domus"] };
const createAna = ["create", "--email", "ana@domus.test", "--name", "Ana", "--role", "member"];

/** A terminal that answers each request for the secret from `answers`, and keeps every line written. */
function fakeTerminal(answers: string[]) {
	const lines: string[] = [];
	const asked: string[] = [];
	return {
		lines,
		asked,
		terminal: {
			askSecret: (prompt: string) => {
				asked.push(prompt);
				const answer = answers.shift();
				return answer === undefined
					? Promise.reject(new Error("no more answers"))
					: Promise.resolve(answer);
			},
			print: (line: string) => lines.push(line),
			fail: (line: string) => lines.push(`error: ${line}`),
		},
	};
}

/** Runs `args` against the platform as the wrapper does, parse then run, answering with `answers`. */
async function run(platform: Platform, args: string[], ...answers: string[]) {
	const parsed = parseAccountsArguments(args);
	if ("error" in parsed) throw new Error(parsed.error);
	const fake = fakeTerminal(answers);
	const code = await runAccounts(platform, parsed.command, fake.terminal);
	return { code, lines: fake.lines, asked: fake.asked };
}

describe("runAccounts", () => {
	let platform: Platform;
	beforeEach(() => {
		platform = createPlatform({ databaseFile: ":memory:", modules: [] });
	});
	afterEach(() => platform.close());

	const door = () => createHttpHandler({ platform, modules: [], auth });

	function signIn(email: string, password: string): Promise<Response> {
		return door().fetch(
			new Request("http://domus/api/auth/sign-in/email", {
				method: "POST",
				headers: { origin: "http://domus", "content-type": "application/json" },
				body: JSON.stringify({ email, password }),
			}),
		);
	}

	/** Whether the cookies a sign-in set still name a live session. */
	async function stillSignedIn(signedIn: Response): Promise<boolean> {
		const cookie = signedIn.headers
			.getSetCookie()
			.map((line) => line.split(";")[0])
			.join("; ");
		const response = await door().fetch(
			new Request("http://domus/api/rpc/sessions/list", {
				method: "POST",
				headers: { origin: "http://domus", cookie },
			}),
		);
		return response.status === 200;
	}

	it.each(["admin", "member"] as const)(
		"creates an account with the role %s that signs in with the password asked for",
		async (role) => {
			const created = await run(
				platform,
				["create", "--email", "Ana@Domus.test", "--name", "Ana", "--role", role],
				SECRET,
				SECRET,
			);

			expect(created.code).toBe(0);
			expect(created.asked).toHaveLength(2);
			expect(created.lines).toEqual([expect.stringMatching(/created .*ana@domus\.test/)]);
			expect((await signIn("ana@domus.test", SECRET)).status).toBe(200);
		},
	);

	it("refuses a repeated email before asking for a password", async () => {
		await run(platform, createAna, SECRET, SECRET);

		const again = await run(
			platform,
			["create", "--email", "ANA@domus.test", "--name", "Otra", "--role", "admin"],
			NEW_SECRET,
			NEW_SECRET,
		);

		expect(again.code).toBe(1);
		expect(again.asked).toEqual([]);
		expect(again.lines).toEqual([expect.stringMatching(/^error: .*already exists/)]);
		expect((await signIn("ana@domus.test", SECRET)).status).toBe(200);
	});

	it.each([
		["two different answers", [SECRET, `${SECRET}!`], /do not match/],
		["a short password", ["short", "short"], /at least 8/],
		["a password too long", ["x".repeat(129), "x".repeat(129)], /at most 128/],
	])("creates nothing with %s", async (_case, answers, message) => {
		const created = await run(platform, createAna, ...answers);

		expect(created.code).toBe(1);
		expect(created.lines).toEqual([expect.stringMatching(message)]);
		for (const answer of answers) expect(created.lines.join("\n")).not.toContain(answer);
		expect((await run(platform, createAna, SECRET, SECRET)).code).toBe(0);
	});

	it("changes a password and revokes every session of that account, and only of it", async () => {
		await run(platform, createAna, SECRET, SECRET);
		await run(
			platform,
			["create", "--email", "luis@domus.test", "--name", "Luis", "--role", "member"],
			SECRET,
			SECRET,
		);
		const first = await signIn("ana@domus.test", SECRET);
		const second = await signIn("ana@domus.test", SECRET);
		const luis = await signIn("luis@domus.test", SECRET);
		expect(await stillSignedIn(first)).toBe(true);

		const changed = await run(
			platform,
			["password", "--email", "ana@domus.test"],
			NEW_SECRET,
			NEW_SECRET,
		);

		expect(changed.code).toBe(0);
		expect(changed.lines).toEqual([expect.stringMatching(/changed .*2 sessions/)]);
		expect(await stillSignedIn(first)).toBe(false);
		expect(await stillSignedIn(second)).toBe(false);
		expect(await stillSignedIn(luis)).toBe(true);
		expect((await signIn("ana@domus.test", SECRET)).status).toBe(401);
		expect((await signIn("ana@domus.test", NEW_SECRET)).status).toBe(200);
	});

	it.each([
		["an unknown email", "nadie@domus.test", /no account/],
		["the device account, which has no password", "device@domus.invalid", /device account/],
	])("changes no password for %s", async (_case, email, message) => {
		const changed = await run(platform, ["password", "--email", email], SECRET, SECRET);

		expect(changed.code).toBe(1);
		expect(changed.asked).toEqual([]);
		expect(changed.lines).toEqual([expect.stringMatching(message)]);
	});

	it("keeps the old password and the sessions when the new one is refused", async () => {
		await run(platform, createAna, SECRET, SECRET);
		const session = await signIn("ana@domus.test", SECRET);

		const changed = await run(
			platform,
			["password", "--email", "ana@domus.test"],
			"short",
			"short",
		);

		expect(changed.code).toBe(1);
		expect(await stillSignedIn(session)).toBe(true);
		expect((await signIn("ana@domus.test", SECRET)).status).toBe(200);
	});

	it("never writes the secret, in what it prints or in its errors", async () => {
		const [one, two, three] = ["first-secret-pass", "second-secret-pass", "third-secret-pass"];
		const transcript: string[] = [];
		const steps: [string[], ...string[]][] = [
			[["create", "--email", "ana@domus.test", "--name", "Ana", "--role", "admin"], one, one],
			[createAna, two, two],
			[
				["create", "--email", "luis@domus.test", "--name", "Luis", "--role", "member"],
				two,
				three,
			],
			[["password", "--email", "ana@domus.test"], two, two],
			[["password", "--email", "ana@domus.test"], three, one],
			[["password", "--email", "ana@domus.test"], three],
		];
		for (const [args, ...answers] of steps)
			transcript.push(...(await run(platform, args, ...answers)).lines);

		expect(transcript).toHaveLength(steps.length);
		for (const secret of [one, two, three]) expect(transcript.join("\n")).not.toContain(secret);
	});
});

describe("parseAccountsArguments", () => {
	it("reads creating an account and changing a password", () => {
		expect(
			parseAccountsArguments([
				"create",
				"--email",
				"ana@domus.test",
				"--name=Ana",
				"--role",
				"admin",
			]),
		).toEqual({
			command: { kind: "create", email: "ana@domus.test", name: "Ana", role: "admin" },
		});
		expect(parseAccountsArguments(["password", "--email", "ana@domus.test"])).toEqual({
			command: { kind: "password", email: "ana@domus.test" },
		});
	});

	it.each([
		[
			[
				"create",
				"--email",
				"a@b.c",
				"--name",
				"Ana",
				"--role",
				"member",
				"--password",
				"s3cret-value",
			],
		],
		[
			[
				"create",
				"--email",
				"a@b.c",
				"--name",
				"Ana",
				"--role",
				"member",
				"--password=s3cret-value",
			],
		],
		[["password", "--email", "a@b.c", "-p", "s3cret-value"]],
		[["password", "--email", "a@b.c", "--secret=s3cret-value"]],
		[["password", "--email", "a@b.c", "--pass", "s3cret-value"]],
	])("refuses the password as an argument, without repeating it: %j", (args) => {
		const parsed = parseAccountsArguments(args);
		expect(parsed).toEqual({ error: expect.stringMatching(/never an argument/) });
		expect(JSON.stringify(parsed)).not.toContain("s3cret-value");
	});

	it.each([
		[[], /a subcommand/],
		[["delete"], /unknown subcommand/],
		[["create", "--email", "a@b.c", "--name", "Ana"], /--role/],
		[["create", "--email", "a@b.c", "--name", "Ana", "--role", "device"], /admin or member/],
		[["create", "--email", "not-an-email", "--name", "Ana", "--role", "member"], /email/],
		[["create", "--email", "a@b.c", "--name", " ", "--role", "member"], /--name/],
		[["password"], /--email/],
		[["password", "--email"], /--email needs a value/],
		[["password", "--email", "a@b.c", "--email", "d@e.f"], /twice/],
		[["password", "--email", "a@b.c", "--name", "Ana"], /--name/],
		[["password", "--email", "a@b.c", "--color=s3cret-value"], /unknown option --color/],
		[["password", "--email", "a@b.c", "s3cret-value"], /unexpected argument/],
	])("refuses %j", (args, message) => {
		const parsed = parseAccountsArguments(args);
		expect(parsed).toEqual({ error: expect.stringMatching(message) });
		expect(JSON.stringify(parsed)).not.toContain("s3cret-value");
	});
});
