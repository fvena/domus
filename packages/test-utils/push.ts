// A fake push service for tests of notices (spec of phase 1d4, seam 1): the hosts a test platform admits and the
// `fetch` its deliveries use, which keeps every request and answers what the test asks for. With it, a client of
// that service: real P-256 keys for a subscription, to decrypt what reaches it (RFC 8291, `aes128gcm`), and a check
// of the VAPID signature of a request (RFC 8292). Written apart from `web-push`, so a test does not check the
// platform with the same code that produced the request.
import {
	createDecipheriv,
	createECDH,
	createPublicKey,
	hkdfSync,
	randomBytes,
	verify,
} from "node:crypto";

/** The host of the fake service: an endpoint of a test's subscription is on it. */
export const FAKE_PUSH_HOST = "push.domus.test";

/** A request that reached the fake service, as the platform made it. */
export interface PushRequest {
	readonly url: string;
	readonly method: string;
	/** Its headers, by lowercase name. */
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Uint8Array;
	readonly redirect: RequestRedirect | undefined;
	readonly signal: AbortSignal | undefined;
}

/** What the fake service answers a request: a response, or a rejection as a network error would be. */
export type PushAnswer = (request: PushRequest) => Response | Promise<Response>;

export interface FakePushService {
	/**
	 * The hosts the test platform admits as push services: {@link FAKE_PUSH_HOST} at first. The platform reads this
	 * same list each time, so a test may change it.
	 */
	readonly hosts: string[];
	/** Every request that reached it, in order. */
	readonly requests: readonly PushRequest[];
	/**
	 * Answers the next requests with `answer`: `201 Created` until a test says otherwise. Any status, headers such as
	 * `Retry-After`, a rejection as a network error would be, or {@link neverAnswers}.
	 */
	answer(answer: PushAnswer): void;
	/** The `fetch` the platform's deliveries use. */
	readonly fetch: typeof fetch;
}

/**
 * An answer that never comes: the request stays pending until its signal is aborted, and then rejects with the
 * signal's reason, as `fetch` does.
 */
export const neverAnswers: PushAnswer = ({ signal }) =>
	new Promise<Response>((_, reject) => {
		if (!signal) return;
		if (signal.aborted) reject(signal.reason);
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});

/** A fake push service that keeps every request and answers `201 Created`. */
export function fakePushService(): FakePushService {
	const requests: PushRequest[] = [];
	let answer: PushAnswer = () => new Response(null, { status: 201 });
	const fake = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
		const request = new Request(input, init);
		const kept: PushRequest = {
			url: request.url,
			method: request.method,
			headers: Object.fromEntries(request.headers),
			body: new Uint8Array(await request.arrayBuffer()),
			redirect: init.redirect,
			signal: init.signal ?? undefined,
		};
		requests.push(kept);
		return answer(kept);
	};
	return {
		hosts: [FAKE_PUSH_HOST],
		requests,
		answer: (next) => {
			answer = next;
		},
		fetch: fake as typeof fetch,
	};
}

/** A browser's subscription on the fake service: its endpoint, its real keys and how it reads what reaches it. */
export interface PushClient {
	readonly endpoint: string;
	/** The keys the app sends when it subscribes, in base64url. */
	readonly keys: { readonly p256dh: string; readonly auth: string };
	/** Decrypts a request that reached this subscription and parses its content as JSON. */
	read(request: PushRequest): unknown;
}

/** A subscription named `name` on the fake service, with keys of its own. */
export function pushClient(name: string): PushClient {
	const ecdh = createECDH("prime256v1");
	const publicKey = ecdh.generateKeys();
	const secret = randomBytes(16);
	return {
		endpoint: `https://${FAKE_PUSH_HOST}/send/${name}`,
		keys: { p256dh: publicKey.toString("base64url"), auth: secret.toString("base64url") },
		read: (request) =>
			JSON.parse(decrypt(Buffer.from(request.body), ecdh, publicKey, secret)) as unknown,
	};
}

/** The bytes of one header of `aes128gcm`: salt, record size, key id length; then the sender's key. */
const SALT = 16;
const RECORD_SIZE = 4;
const KEY_LENGTH = 65;
const TAG = 16;

/** Decrypts a body of one record of `aes128gcm` for a subscription's keys (RFC 8188, RFC 8291). */
function decrypt(
	body: Buffer,
	ecdh: ReturnType<typeof createECDH>,
	publicKey: Buffer,
	secret: Buffer,
): string {
	const salt = body.subarray(0, SALT);
	const idLength = body.readUInt8(SALT + RECORD_SIZE);
	if (idLength !== KEY_LENGTH) throw new Error(`a key id of ${idLength} bytes`);
	const start = SALT + RECORD_SIZE + 1;
	const sender = body.subarray(start, start + KEY_LENGTH);
	const record = body.subarray(start + KEY_LENGTH);

	const shared = ecdh.computeSecret(sender);
	const info = Buffer.concat([Buffer.from("WebPush: info\0"), publicKey, sender]);
	const ikm = Buffer.from(hkdfSync("sha256", shared, secret, info, 32));
	const key = Buffer.from(hkdfSync("sha256", ikm, salt, "Content-Encoding: aes128gcm\0", 16));
	const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, "Content-Encoding: nonce\0", 12));

	const decipher = createDecipheriv("aes-128-gcm", key, nonce);
	decipher.setAuthTag(record.subarray(record.length - TAG));
	const padded = Buffer.concat([
		decipher.update(record.subarray(0, record.length - TAG)),
		decipher.final(),
	]);
	// The last record ends with the delimiter 2 and then zeros.
	let end = padded.length - 1;
	while (end >= 0 && padded[end] === 0) end -= 1;
	if (padded[end] !== 2) throw new Error("the record has no final delimiter");
	return padded.subarray(0, end).toString("utf8");
}

/** The claims of a VAPID token: who it is for, who sends it and until when, in seconds. */
export interface VapidClaims {
	readonly aud: string;
	readonly sub: string;
	readonly exp: number;
}

/**
 * The claims of the VAPID token of a request, once its `k` is `publicKey` and its ES256 signature checks with it.
 * Throws otherwise.
 */
export function vapidClaims(request: PushRequest, publicKey: string): VapidClaims {
	const match = /^vapid t=([^,\s]+),\s*k=([^,\s]+)$/.exec(request.headers.authorization ?? "");
	if (!match) throw new Error("the request has no VAPID authorization");
	const [, token = "", key = ""] = match;
	if (key !== publicKey) throw new Error("the request is signed with another key");
	const [header = "", payload = "", signature = ""] = token.split(".");
	const point = Buffer.from(publicKey, "base64url");
	const signer = createPublicKey({
		key: {
			kty: "EC",
			crv: "P-256",
			x: point.subarray(1, 33).toString("base64url"),
			y: point.subarray(33).toString("base64url"),
		},
		format: "jwk",
	});
	const signed = verify(
		"sha256",
		Buffer.from(`${header}.${payload}`),
		{ key: signer, dsaEncoding: "ieee-p1363" },
		Buffer.from(signature, "base64url"),
	);
	if (!signed) throw new Error("the VAPID signature does not check");
	const { alg } = JSON.parse(Buffer.from(header, "base64url").toString()) as { alg?: string };
	if (alg !== "ES256") throw new Error(`a VAPID token signed with ${String(alg)}`);
	return JSON.parse(Buffer.from(payload, "base64url").toString()) as VapidClaims;
}
