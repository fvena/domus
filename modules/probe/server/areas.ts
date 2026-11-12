// The areas of probe (ADR 0023), one per rule an area can declare, so each rule has a case. The schema builds
// its owned tables for them and the definition registers them.
import type { AreaDefinition } from "@domus/module-sdk";

export const areas = {
	/** Its own: private by default; a public record is edited only by its owner. */
	probe: {},
	/** Public by default; anyone with `write` edits a public record. */
	"probe.board": { defaultVisibility: "public", publicEditable: true },
	/** Always private, and reading it on a shared device asks for confirmation. */
	"probe.health": { alwaysPrivate: true, confirmOnSharedDevice: true },
	/** Always private without the shared device rule: one rule does not imply the other. */
	"probe.secret": { alwaysPrivate: true },
} as const satisfies Readonly<Record<string, AreaDefinition>>;
