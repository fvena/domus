// A browser for HTTP tests: it keeps the cookies the door sets and sends them back, as a browser does, but in
// the open, so a test can read, drop or forge one. Every request carries the door's origin, as a page served
// from it would.
import type { HttpHandler } from "@domus/platform";

export interface TestBrowser {
	/**
	 * Sends a request through the door with the cookies it holds, and keeps those the answer sets. A plain
	 * function, safe to pass around as `fetch`.
	 */
	readonly fetch: (request: Request) => Promise<Response>;
	/** The value of a cookie it holds. */
	cookie(name: string): string | undefined;
	/** Every cookie it holds, by name. */
	cookies(): Readonly<Record<string, string>>;
	/** Sets a cookie by hand, or drops it with `undefined`. */
	setCookie(name: string, value: string | undefined): void;
	/** Signs in with email and password through Better Auth's route. */
	signIn(email: string, password: string): Promise<Response>;
	/** Signs out through Better Auth's route. */
	signOut(): Promise<Response>;
}

export function createTestBrowser(door: HttpHandler, origin: string): TestBrowser {
	const jar = new Map<string, string>();

	const fetch = async (request: Request): Promise<Response> => {
		const headers = new Headers(request.headers);
		if (!headers.has("origin")) headers.set("origin", origin);
		const sent = [...jar].map(([name, value]) => `${name}=${value}`);
		if (headers.has("cookie")) sent.push(headers.get("cookie") ?? "");
		if (sent.length > 0) headers.set("cookie", sent.join("; "));

		const response = await door.fetch(new Request(request, { headers }));
		for (const line of response.headers.getSetCookie()) keep(line);
		return response;
	};

	/** Keeps or drops one cookie from a Set-Cookie line. */
	function keep(line: string): void {
		const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
		const at = pair.indexOf("=");
		const name = pair.slice(0, at);
		const value = pair.slice(at + 1);
		const expired = attributes.some((attribute) => /^max-age=(0|-\d+)$/i.test(attribute));
		if (value === "" || expired) jar.delete(name);
		else jar.set(name, value);
	}

	const post = (path: string, body: unknown) =>
		fetch(
			new Request(new URL(path, origin), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);

	return {
		fetch,
		cookie: (name) => jar.get(name),
		cookies: () => Object.fromEntries(jar),
		setCookie: (name, value) => {
			if (value === undefined) jar.delete(name);
			else jar.set(name, value);
		},
		signIn: (email, password) => post("/api/auth/sign-in/email", { email, password }),
		signOut: () => post("/api/auth/sign-out", {}),
	};
}
