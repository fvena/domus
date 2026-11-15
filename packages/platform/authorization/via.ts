// Which operations of the platform a context with `via` reaches (ADR 0030, ADR 0034): a closed list, by the full name
// of the action authorization is asked about. Every other one, also an unknown name or one added tomorrow, is denied
// via an agent, whatever its delegation says. The actions of the modules are not here: they all admit `via`, and the
// delegation decides.
import { PLATFORM_ID } from "@domus/module-sdk";

/** Reading one's own annotations in the action log, through the delegation in force. */
const ADMITTING_VIA: ReadonlySet<string> = new Set([`${PLATFORM_ID}.readLog`]);

/**
 * True when a context with `via` may go on to the rest of the decision for `action`: any action of a module, reading
 * the log, and the inverse an undo of one's own entry runs, which the rest of the decision takes as any other write.
 */
export function admitsVia(action: string, undoing: boolean): boolean {
	return undoing || !action.startsWith(`${PLATFORM_ID}.`) || ADMITTING_VIA.has(action);
}
