// The test notice (ADR 0029, «El aviso de prueba»), an operation of the platform on the path of the actions: an
// irreversible write, with its key and its entry, that a person asks for themselves with no level of any area. It
// leaves in its write a notice to who asks, about no record, the one exception to «always about a record».
import { NOTICE, type PlatformOperation, type WriteJob } from "../actions";

/** The test notice, by its name after `platform.`. */
export const TEST_NOTICE = "testNotice";

/** The operations of the notices; `leave` leaves a job in the write whose handler is running. */
export function notificationOperations(
	leave: (job: WriteJob) => void,
): readonly PlatformOperation[] {
	return [
		{
			name: TEST_NOTICE,
			personal: true,
			inputSchema: undefined,
			subject: () => undefined,
			run: (_input, { account }) => {
				leave({ kind: NOTICE, payload: { kind: "test", to: account } });
				return { to: account };
			},
		},
	];
}
