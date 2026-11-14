// Which operations of the platform a mandate reaches (ADR 0030): a closed list, by the path the door serves each at.
// Every other one, also an unknown name or one added tomorrow, admits only a session. The actions of the modules
// are not here: they all admit a mandate, and the delegation decides.

/** Reading one's own annotations and undoing one's own entry, both through the delegation in force. */
const ADMITTING_MANDATES: ReadonlySet<string> = new Set(["log/read", "log/undo"]);

/** True only for an operation of the platform, by its path `<group>/<name>`, that admits a mandate. */
export function admitsMandate(operation: string): boolean {
	return ADMITTING_MANDATES.has(operation);
}
