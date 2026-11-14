// Which push services the Pi talks to (ADR 0029, «Solo servicios de push conocidos»): the endpoint of a subscription
// is a URL the browser gives, and the Pi will send requests to it, so only a known service's is accepted. Checked
// when subscribing and, later, before every send.

/** The hosts of the push services Domus admits in production: Apple's, Google's and Mozilla's. Edge stays out. */
export const PUSH_SERVICES: readonly string[] = [
	"web.push.apple.com",
	"fcm.googleapis.com",
	"updates.push.services.mozilla.com",
];

/**
 * Whether `endpoint` is a URL of one of `hosts`: `https`, without user or password, on port 443 (explicit or not),
 * with a hostname, lowercased as a URL reads it, exactly equal to one of them. An IP, a suffix, a prefix or a
 * trailing dot is another host.
 */
export function endpointAllowed(endpoint: string, hosts: readonly string[]): boolean {
	if (!URL.canParse(endpoint)) return false;
	const url = new URL(endpoint);
	// An https URL on port 443 reads its port as empty: any other port is written out.
	return (
		url.protocol === "https:" &&
		url.username === "" &&
		url.password === "" &&
		url.port === "" &&
		hosts.includes(url.hostname)
	);
}
