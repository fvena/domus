#!/usr/bin/env bash
# `pnpm check`: the bar a change must pass before it is done, with little output. It fails when a gate fails or
# when the generators change the working tree (a schema without its migration, a stale module list).
set -euo pipefail
cd "$(dirname "$0")/../.."

snapshot() { git status --porcelain --untracked-files=all; git diff; }

pnpm --silent format:check
pnpm --silent lint
pnpm --silent type-check --output-logs=errors-only
pnpm --silent test --output-logs=errors-only

before=$(snapshot)
pnpm --silent db:generate < /dev/null > /dev/null
pnpm --silent modules:generate > /dev/null
if [ "$before" != "$(snapshot)" ]; then
	echo "pnpm db:generate or pnpm modules:generate changed the tree; commit what they wrote:" >&2
	git status --short >&2
	exit 1
fi
echo "check: all gates pass"
