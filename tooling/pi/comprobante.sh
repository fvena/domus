#!/usr/bin/env bash
# Asks for a step-up proof of one exact operation with a session that entrar.sh opened, and keeps it in
# $DOMUS_COOKIES/proof (default ~/.domus-cierre) for the agent to use within its 5 minutes. Run it on the Pi:
#   ssh -t kira '~/domus/tooling/pi/comprobante.sh ensayo:paco "{\"action\":\"platform.revokeSession\",\"input\":{\"session\":\"…\"}}"'
# The password is read without echo and travels to curl on standard input, never on a command line.
set -uo pipefail
umask 077
dir=${DOMUS_COOKIES:-$HOME/.domus-cierre}
where=${1%%:*}
name=${1#*:}
operation=$2
case "$where" in
	real) base=http://localhost:3000 origin=http://kira.local:3000 ;;
	ensayo) base=http://localhost:3001 origin=http://localhost:3001 ;;
	*) echo "unknown place «$where»: real or ensayo" >&2; exit 2 ;;
esac
read -rsp "Contraseña de $name: " pw
echo
answer=$(printf '%s' "$pw" | jq -Rs --argjson operation "$operation" '{json: {password: ., operation: $operation}}' |
	curl -s -b "$dir/$where-$name" -H "Origin: $origin" -H 'content-type: application/json' \
		--data-binary @- "$base/api/rpc/proofs/request")
unset pw
if proof=$(printf '%s' "$answer" | jq -er '.json.proof'); then
	printf '%s\n' "$proof" > "$dir/proof"
	echo "comprobante guardado"
else
	echo "sin comprobante:"
	printf '%s' "$answer" | jq -c '.json | {code, message}'
fi
