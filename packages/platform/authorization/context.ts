// The verified context (ADR 0023): who asks and from where, as the door worked it out from credentials. Only a
// context sealed here is accepted on the one path of the actions, so nothing on the way can swap it for another
// object with the same fields. The door seals one from a session; the testing entry seals synthetic ones.
import type { Actor } from "@domus/module-sdk";

/** How a request reaches Domus: the app, or Kira's conversation in context (phase 5). */
export type Channel = "app" | "contexto";

/** How the identity was established. Not a scale of trust: authorization only asks which one it is. */
export type IdentityProof = "password" | "voice" | "device";

export interface VerifiedContext {
	/** The account represented: whose permissions apply. */
	readonly account: string;
	/** The authenticated app that carries the request, such as Kira; absent when the account asks itself. */
	readonly via?: string;
	/** The device the request comes from. */
	readonly device: string;
	/** The session the request comes with, when it comes with one. */
	readonly session?: string;
	/** The account the device signed in with: on a shared screen, the device account. */
	readonly deviceAccount: string;
	readonly channel: Channel;
	readonly identity: IdentityProof;
	/** Kira's conversation; absent until phase 5. */
	readonly conversation?: string;
}

const sealed = new WeakSet<VerifiedContext>();

/** A frozen copy of `fields`, the only kind of context the actions accept. Inside platform only. */
export function sealContext(fields: VerifiedContext): VerifiedContext {
	const context: VerifiedContext = Object.freeze({
		account: fields.account,
		...(fields.via === undefined ? {} : { via: fields.via }),
		device: fields.device,
		...(fields.session === undefined ? {} : { session: fields.session }),
		deviceAccount: fields.deviceAccount,
		channel: fields.channel,
		identity: fields.identity,
		...(fields.conversation === undefined ? {} : { conversation: fields.conversation }),
	});
	sealed.add(context);
	return context;
}

/** True only for a context {@link sealContext} made: a copy, however faithful, is not one. */
export function isVerified(context: unknown): context is VerifiedContext {
	return (
		typeof context === "object" && context !== null && sealed.has(context as VerifiedContext)
	);
}

/** What a module's handler receives of a context: the account represented and its `via`. */
export function actorOf(context: VerifiedContext): Actor {
	return context.via === undefined
		? { account: context.account }
		: { account: context.account, via: context.via };
}
