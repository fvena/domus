#!/usr/bin/env bash
# Opens sessions on the Pi for a close (docs/agents/workflow.md, «Close») and keeps their cookies, so the agent can
# run the checks over `ssh kira` while only the person types passwords. Run it on the Pi with a terminal:
#   ssh -t kira '~/domus/tooling/pi/entrar.sh real:paco ensayo:paco ensayo:rocio'
# Each <real|ensayo>:<name> asks for an email and a password (no echo) and writes the cookie to
# $DOMUS_COOKIES/<real|ensayo>-<name> (default ~/.domus-cierre, mode 700), then prints the code and the account's
# name, so a sign-in with the wrong email shows at once. Remove the folder when the close ends: its cookies are
# open sessions.
set -uo pipefail
umask 077
dir=${DOMUS_COOKIES:-$HOME/.domus-cierre}
mkdir -p "$dir"
for which in "$@"; do
	where=${which%%:*}
	name=${which#*:}
	case "$where" in
		real) base=http://localhost:3000 origin=http://kira.local:3000 ;;
		ensayo) base=http://localhost:3001 origin=http://localhost:3001 ;;
		*) echo "unknown place «$where»: real or ensayo" >&2; exit 2 ;;
	esac
	echo "— $where, $name"
	read -rp "Correo: " correo
	read -rsp "Contraseña: " pw
	echo
	answer=$(printf '%s\n%s\n' "$correo" "$pw" | jq -Rn '[inputs] | {email: .[0], password: .[1]}' |
		curl -s -w '\n%{http_code}' -c "$dir/$where-$name" -H "Origin: $origin" -H 'content-type: application/json' \
			--data-binary @- "$base/api/auth/sign-in/email")
	unset pw
	code=${answer##*$'\n'}
	account=$(printf '%s' "${answer%$'\n'*}" | jq -r '.user.name // "ninguna"' 2>/dev/null)
	echo "entrar en $where como $name: $code (cuenta: $account)"
done
