// The contract of probe, the test module of phase 1 (ADR 0022): the actions it offers, with their input and
// output. Pure, like every contract.
import { readAction } from "@domus/module-sdk/contracts";
import { z } from "zod";

const note = z.object({ id: z.number().int(), body: z.string() });

export const probeContract = {
	/** Every note, oldest first. */
	listNotes: readAction().output(z.array(note)),
	/** One note by its id, or `null` when there is none. */
	getNote: readAction()
		.input(z.object({ id: z.number().int().positive() }))
		.output(note.nullable()),
};
