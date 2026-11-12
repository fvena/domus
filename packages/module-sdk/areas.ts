// What an area declares about itself (ADR 0023). Its own file so that `db`, which builds owned tables for an
// area, and `module`, which registers areas, both read it without importing each other.

/** Who sees an owned record: only its owner, or the whole household (GLOSSARY: visibilidad). */
export type Visibility = "private" | "public";

/** What an area declares. Every field is optional; its default is the strictest. */
export interface AreaDefinition {
	/** The visibility a new record of its owned tables takes. Default `private`. */
	readonly defaultVisibility?: Visibility;
	/** Whether anyone with `write` in it edits and deletes a public record, not only its owner. Default no. */
	readonly publicEditable?: boolean;
	/**
	 * Nothing of it is ever public: a `CHECK` on its owned tables rejects it, and the device account gets no
	 * permission in it by default. Default no.
	 */
	readonly alwaysPrivate?: boolean;
	/** Reading it on a device signed in with the device account asks for confirmation. Default no. */
	readonly confirmOnSharedDevice?: boolean;
}
