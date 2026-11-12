// probe, the test module of phase 1 (ADR 0021, ADR 0022). testOnly keeps it out of the module list of
// apps/api: tests import it and hand it to test-utils. It stores notes and comments and offers actions on them.
import { defineModule } from "@domus/module-sdk";
import { eq } from "@domus/module-sdk/db";

import { probeContract } from "../contracts";
import { migrations } from "./migrations";
import * as schema from "./schema";

export default defineModule({
	id: "probe",
	testOnly: true,
	schema,
	migrations,
	contract: probeContract,
	actions: {
		listNotes: ({ db }) => db.select().from(schema.notes).orderBy(schema.notes.id).all(),
		getNote: ({ db, input }) =>
			db.select().from(schema.notes).where(eq(schema.notes.id, input.id)).get() ?? null,
	},
});
