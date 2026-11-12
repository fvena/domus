// probe, the test module of phase 1 (ADR 0021). testOnly keeps it out of the module list of apps/api:
// tests import it and hand it to test-utils. In phase 1a it only stores data.
import { defineModule } from "@domus/module-sdk";

import { migrations } from "./migrations";
import * as schema from "./schema";

export default defineModule({ id: "probe", testOnly: true, schema, migrations });
