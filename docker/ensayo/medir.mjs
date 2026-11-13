// The measurement of the restore rehearsal (ADR 0026, docs/despliegue.md «Medir la copia»): it runs inside the
// rehearsal's api container with the image's own Node, read from standard input, and never in the real one.
//
//   llenar [MB]       fills /data/domus.db up to about MB megabytes (500 by default) with synthetic entries of the
//                     action log, the table that grows most, under an account no one has
//   medir <correo>    with the password in MEDIR_PASSWORD: a baseline minute, then three whole backups launched
//                     with tasks/launch, while /health and a read with a session go every 100 ms and a write (a
//                     step-up proof) every second, at a fixed pace that never waits for the previous answer
//
// It prints the duration of each backup and, per period and request, the count, the errors and the percentiles.
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { createRequire } from "node:module";

const DATABASE = "/data/domus.db";
const BASE = "http://127.0.0.1:3000";
const ORIGIN = "http://localhost:3001";
const SYNTHETIC_ACCOUNT = "medicion-sintetica";
const LIMIT_MS = 500;

const [command, argument] = process.argv.slice(2);
if (command === "llenar") fill(Number(argument ?? 500));
else if (command === "medir" && argument) await measure(argument);
else {
	console.error("usage: llenar [MB] | medir <correo> (password in MEDIR_PASSWORD)");
	process.exit(2);
}

/** Inserts synthetic action-log entries, 1 KB of input each, in batches of their own transaction. */
function fill(megabytes) {
	const Database = createRequire("/app/main.mjs")("better-sqlite3");
	const db = new Database(DATABASE, { fileMustExist: true });
	db.pragma("busy_timeout = 5000");
	const insert = db.prepare(
		`INSERT INTO platform_action_log (module, action, account, key, fingerprint, at, expires_at, input)
			VALUES ('platform', 'measure', ?, ?, 'synthetic', ?, ?, ?)`,
	);
	const start = db
		.prepare("SELECT count(*) AS n FROM platform_action_log WHERE account = ?")
		.get(SYNTHETIC_ACCOUNT).n;
	const size = () =>
		db.pragma("page_count", { simple: true }) * db.pragma("page_size", { simple: true });
	// Random content, so restic compresses it about as little as real data: repeated text would shrink to nothing.
	const body = () => JSON.stringify({ text: randomBytes(750).toString("base64") });
	const now = Date.now();
	const batch = db.transaction((from) => {
		for (let i = from; i < from + 1000; i++)
			insert.run(SYNTHETIC_ACCOUNT, `medicion-${i}`, now, now + 365 * 86_400_000, body());
	});
	let next = start;
	while (size() < megabytes * 1_000_000) {
		batch(next);
		next += 1000;
	}
	db.pragma("wal_checkpoint(TRUNCATE)");
	db.close();
	console.log(
		`${next - start} entries added, database at ${Math.round(statSync(DATABASE).size / 1_000_000)} MB`,
	);
}

/** Signs in, then measures a baseline and three backups under a steady load. */
async function measure(email) {
	const password = process.env.MEDIR_PASSWORD;
	if (!password) throw new Error("set MEDIR_PASSWORD");
	const cookie = await signIn(email, password);
	const samples = [];
	let period = "base";

	const timed = async (kind, request) => {
		const label = period;
		const started = performance.now();
		let ok = false;
		try {
			ok = (await request()).ok;
		} catch {
			ok = false;
		}
		samples.push({ period: label, kind, ms: performance.now() - started, ok });
	};
	const rpc = (path, json, headers = {}) =>
		fetch(`${BASE}/api/rpc/${path}`, {
			method: "POST",
			headers: { origin: ORIGIN, "content-type": "application/json", cookie, ...headers },
			body: JSON.stringify({ json }),
		});
	const proofFor = async (operation) => {
		const response = await rpc("proofs/request", { password, operation });
		return (await response.json()).json.proof;
	};

	const fast = setInterval(() => {
		void timed("health", () => fetch(`${BASE}/health`));
		void timed("read", () => rpc("tasks/list", undefined));
	}, 100);
	const slow = setInterval(() => {
		void timed("write", () =>
			rpc("proofs/request", {
				password,
				operation: { action: "platform.launchTask", input: { task: "cleanup" } },
			}),
		);
	}, 1000);

	await sleep(60_000);
	const backups = [];
	for (const round of [1, 2, 3]) {
		period = `copia ${round}`;
		const proof = await proofFor({ action: "platform.launchTask", input: { task: "backup" } });
		const since = Date.now();
		const launched = await rpc(
			"tasks/launch",
			{ task: "backup" },
			{
				"idempotency-key": `medicion-${Date.now()}`,
				"step-up-proof": proof,
			},
		);
		if (!launched.ok) throw new Error(`tasks/launch answered ${launched.status}`);
		backups.push(await backupEnd(rpc, since));
		period = "pausa";
		await sleep(5000);
	}
	clearInterval(fast);
	clearInterval(slow);
	await sleep(2000);

	for (const [round, run] of backups.entries())
		console.log(
			`copia ${round + 1}: ${run.result} en ${((run.finishedAt - run.startedAt) / 1000).toFixed(1)} s`,
		);
	report(samples.filter((sample) => sample.period !== "pausa"));
}

/**
 * Waits for the manual backup launched at `since` to end, and returns its run. A manual run is planned at its launch,
 * so an older one, such as the one the restored copy brought, never counts.
 */
async function backupEnd(rpc, since) {
	for (;;) {
		await sleep(500);
		const tasks = (await (await rpc("tasks/list", undefined)).json()).json;
		const last = tasks.find((task) => task.id === "backup")?.lastRun;
		if (last?.manual && last.plannedAt >= since && last.result !== null) return last;
	}
}

async function signIn(email, password) {
	const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { origin: ORIGIN, "content-type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
	if (!response.ok) throw new Error(`sign-in answered ${response.status}`);
	return response.headers
		.getSetCookie()
		.map((line) => line.split(";")[0])
		.join("; ");
}

function report(samples) {
	const groups = Map.groupBy(samples, (sample) => `${sample.period}\t${sample.kind}`);
	let worst = 0;
	let errors = 0;
	console.log("periodo\tpetición\tn\terrores\tp50\tp95\tp99\tmáx (ms)");
	for (const [key, group] of groups) {
		const times = group.map((sample) => sample.ms).sort((a, b) => a - b);
		const at = (q) =>
			times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(0);
		const failed = group.filter((sample) => !sample.ok).length;
		worst = Math.max(worst, times.at(-1));
		errors += failed;
		console.log(
			`${key}\t${group.length}\t${failed}\t${at(0.5)}\t${at(0.95)}\t${at(0.99)}\t${times.at(-1).toFixed(0)}`,
		);
	}
	const passed = worst < LIMIT_MS && errors === 0;
	console.log(
		`${passed ? "PASA" : "NO PASA"}: máximo ${worst.toFixed(0)} ms (límite ${LIMIT_MS}), ${errors} errores`,
	);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
