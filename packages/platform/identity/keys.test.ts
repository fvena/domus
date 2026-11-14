import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { connectionOf, createPlatform, type Platform } from "../platform";
import {
	checkKey,
	CONNECTED_APPS,
	createKey,
	parseKey,
	readAuthorization,
	revokeKey,
	UnknownAppError,
} from "./keys";

describe("checkKey", () => {
	let platform: Platform;
	beforeEach(() => {
		platform = createPlatform({ databaseFile: ":memory:", modules: [] });
	});
	afterEach(() => platform.close());

	const apps = [...CONNECTED_APPS, { name: "tester", receivesMandates: false }];
	const connection = () => connectionOf(platform);

	it("finds the app of a good key, also of another app of the list", () => {
		const key = createKey(connection(), apps, "tester", 0);
		expect(checkKey(connection(), apps, key)).toEqual({
			ok: true,
			id: parseKey(key)?.id,
			app: "tester",
		});
	});

	it("refuses a key of another form, an unknown id, the wrong secret, a revoked key and an app no longer listed", () => {
		const key = createKey(connection(), apps, "tester", 0);
		const parts = parseKey(key);
		const other = parseKey(createKey(connection(), apps, "kira", 0));
		expect(checkKey(connection(), apps, `${key}x`)).toEqual({ ok: false, reason: "malformed" });
		expect(checkKey(connection(), apps, `domus_AbCdEfGh-_0.${parts?.secret}`)).toEqual({
			ok: false,
			reason: "unknown",
		});
		expect(checkKey(connection(), apps, `domus_${parts?.id}.${other?.secret}`)).toEqual({
			ok: false,
			reason: "wrong-secret",
		});
		expect(checkKey(connection(), CONNECTED_APPS, key)).toEqual({
			ok: false,
			reason: "unknown-app",
		});
		revokeKey(connection(), parts?.id ?? "", 1);
		expect(checkKey(connection(), apps, key)).toEqual({ ok: false, reason: "revoked" });
	});

	it("creates no key of an app outside the list", () => {
		expect(() => createKey(connection(), CONNECTED_APPS, "tester", 0)).toThrow(UnknownAppError);
	});
});

const ID = "AbCdEfGh-_0";
const SECRET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN-_0";

describe("parseKey", () => {
	it("reads the id and the secret of a key of the agreed form", () => {
		expect(parseKey(`domus_${ID}.${SECRET}`)).toEqual({ id: ID, secret: SECRET });
	});

	it.each([
		["another prefix", `domux_${ID}.${SECRET}`],
		["the prefix in capitals", `DOMUS_${ID}.${SECRET}`],
		["no prefix", `${ID}.${SECRET}`],
		["no dot", `domus_${ID}${SECRET}`],
		["two dots", `domus_${ID}.${SECRET}.`],
		["an id one character short", `domus_${ID.slice(1)}.${SECRET}`],
		["an id one character long", `domus_${ID}A.${SECRET}`],
		["a secret one character short", `domus_${ID}.${SECRET.slice(1)}`],
		["a secret one character long", `domus_${ID}.${SECRET}A`],
		["padding in the secret", `domus_${ID}.${SECRET.slice(0, 42)}=`],
		["a character of base64 outside base64url in the id", `domus_AbCdEfGh+/0.${SECRET}`],
		["a character outside base64url in the secret", `domus_${ID}.${SECRET.slice(0, 42)}!`],
		["a space before", ` domus_${ID}.${SECRET}`],
		["a space after", `domus_${ID}.${SECRET} `],
		["a line break after", `domus_${ID}.${SECRET}\n`],
		["an id that is not the encoding of 8 bytes", `domus_AbCdEfGh-_1.${SECRET}`],
		["a secret that is not the encoding of 32 bytes", `domus_${ID}.${SECRET.slice(0, 42)}1`],
		["nothing", ""],
	])("refuses %s", (_, key) => {
		expect(parseKey(key)).toBeUndefined();
	});
});

describe("readAuthorization", () => {
	const key = `domus_${ID}.${SECRET}`;

	it("finds no key without the header", () => {
		expect(readAuthorization(null)).toEqual({ kind: "none" });
	});

	it.each([
		["Bearer", `Bearer ${key}`],
		["the scheme in lower case", `bearer ${key}`],
		["the scheme in capitals", `BEARER ${key}`],
		["the scheme in mixed case", `bEaReR ${key}`],
		["several spaces after the scheme", `Bearer   ${key}`],
		["spaces around", `  Bearer ${key}  `],
	])("reads the key with %s", (_, value) => {
		expect(readAuthorization(value)).toEqual({ kind: "key", key });
	});

	it.each([
		["an empty value", "", "empty"],
		["only spaces", "   ", "empty"],
		["the scheme alone", "Bearer", "empty"],
		["the scheme and spaces", "Bearer   ", "empty"],
		["another scheme", `Basic ${key}`, "scheme"],
		["the key without a scheme", key, "scheme"],
		["a scheme that only starts like Bearer", `Bearerx ${key}`, "scheme"],
		["a tab instead of a space", `Bearer\t${key}`, "scheme"],
		["two values", `Bearer ${key} ${key}`, "malformed"],
		["two values joined by a comma", `Bearer ${key}, Bearer ${key}`, "malformed"],
		["a key of another form", `Bearer ${key}x`, "malformed"],
		["a key of another prefix", `Bearer domux_${ID}.${SECRET}`, "malformed"],
		["a key with a short secret", `Bearer domus_${ID}.${SECRET.slice(1)}`, "malformed"],
	])("finds a bad key with %s", (_, value, reason) => {
		expect(readAuthorization(value)).toEqual({ kind: "bad", reason });
	});
});
