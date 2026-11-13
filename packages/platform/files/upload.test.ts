// Publishing an upload checks again, in the transaction of its rows, what it checked before receiving the bytes
// (spec of phase 1d3, «Subir»): its session lives and its account may still upload. Who may upload can change
// while the bytes arrive, and no path of the product changes a role yet, so the test changes it in the database.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { connectionOf, filesOf, openPlatform, type Platform } from "../platform";
import { prepareAccount, prepareSession, syntheticContext } from "../testing";

const NOW = Date.UTC(2026, 10, 13, 9, 30);

/** The start of a JPEG and a few bytes of it: enough for its signature. */
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00);

let platform: Platform | undefined;
let folder: string | undefined;
afterEach(() => {
	platform?.close();
	platform = undefined;
	if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
	folder = undefined;
});

describe("publishing an upload", () => {
	it("answers FORBIDDEN once its account may no longer upload, and prepares nothing", async () => {
		folder = mkdtempSync(join(tmpdir(), "domus-upload-"));
		const opened = openPlatform(
			{ databaseFile: ":memory:", modules: [], filesDirectory: folder },
			{
				clock: () => NOW,
				freeSpace: () => Number.MAX_SAFE_INTEGER,
				// Between the file in its place and its rows, Ana stops being a person who may upload.
				interleave: () => {
					connectionOf(opened)
						.prepare("DELETE FROM platform_roles WHERE account = 'ana'")
						.run();
				},
			},
		);
		platform = opened;
		prepareAccount(opened, { id: "ana", role: "member", name: "Ana", email: "ana@domus.test" });
		const { session, device } = prepareSession(opened, "ana");
		const context = syntheticContext({
			account: "ana",
			device,
			session,
			deviceAccount: "ana",
			channel: "app",
			identity: "password",
		});

		await expect(
			filesOf(opened)!.upload(
				context,
				new Request("http://domus/api/files", {
					method: "POST",
					body: JPEG,
					headers: { "content-length": String(JPEG.length), "x-file-name": "foto.jpg" },
				}),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(
			connectionOf(opened)
				.prepare("SELECT count(*) AS count FROM platform_prepared_files")
				.get(),
		).toEqual({ count: 0 });
	});
});
