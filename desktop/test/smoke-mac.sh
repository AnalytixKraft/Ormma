#!/usr/bin/env bash
#
# Tries a built Mac app the way a person would, short of the browser: from
# the disk image, a first run, a password chosen on the first-run page, the
# app and the WhatsApp bridge up on the bundled Node — then stops it.
#
#   bash desktop/test/smoke-mac.sh dist/Ormma-<version>-mac.dmg
#
# It runs a copy with its own data folder, in a temporary folder, on ports
# 3298 and 3299 — beside any Ormma already on this Mac, never instead of it.
# Its bridge has no WhatsApp link, so it never connects to WhatsApp, and
# nothing is sent.

set -euo pipefail
dmg=${1:?usage: smoke-mac.sh <the .dmg>}
work=$(mktemp -d)
mount=
export ORMMA_HOME="$work/home" ORMMA_LOGS="$work/home/logs" ORMMA_LABEL=tech.analytixkraft.ormma.smoke ORMMA_NO_BROWSER=1
app_port=3298 bridge_port=3299

say() { printf 'smoke: %s\n' "$*"; }
cleanup() {
  [[ -n ${ormma:-} ]] && "$ormma" stop --quiet >/dev/null 2>&1 || true
  [[ -n ${serve_pid:-} ]] && kill "$serve_pid" 2>/dev/null || true
  [[ -n $mount ]] && hdiutil detach -quiet "$mount" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
fail() {
  say "FAILED: $*"
  for log in "$ORMMA_LOGS"/*.log; do [[ -f $log ]] && { echo "--- $log"; tail -n 30 "$log"; }; done
  exit 1
}
wait_for() { # wait_for <what> <command…>
  local what=$1
  shift
  for _ in $(seq 1 60); do "$@" >/dev/null 2>&1 && return 0; sleep 0.5; done
  fail "$what"
}

mkdir -p "$ORMMA_HOME"
# Under /Volumes, as opening it in Finder would.
mount=$(hdiutil attach -nobrowse -readonly "$dmg" | awk -F'\t' '/\/Volumes\//{print $NF}')
[[ -d $mount ]] || fail "the disk image did not mount"
[[ -L "$mount/Applications" ]] || fail "the disk image has no Applications link to drag onto"
ditto "$mount/Ormma.app" "$work/Ormma.app"
ormma="$work/Ormma.app/Contents/MacOS/Ormma"
codesign --verify --strict --deep "$work/Ormma.app" || fail "the app's signature does not verify"
say "Ormma $("$ormma" version), $(lipo -archs "$work/Ormma.app/Contents/MacOS/ormma-node")"

# Run from the disk image, it says to move it to Applications first.
if "$mount/Ormma.app/Contents/MacOS/Ormma" --quiet >/dev/null 2>&1; then fail "it ran from the disk image"; fi

printf 'APP_PORT=%s\nBRIDGE_PORT=%s\n' "$app_port" "$bridge_port" >"$ORMMA_HOME/ormma.env"
"$ormma" serve >/dev/null 2>&1 &
serve_pid=$!
wait_for "the first-run page did not answer" sh -c "curl -fsS http://127.0.0.1:$app_port/healthz | grep -q setup"
curl -fsS "http://localhost:$app_port/" | grep -q "Choose a password for Ormma" || fail "the first-run page is not the first-run page"
say "first-run page up"

code=$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: http://localhost:$app_port" --data 'password=smoke-test-1&again=smoke-test-1' "http://localhost:$app_port/")
[[ $code == 200 ]] || fail "choosing a password answered $code"
wait_for "the app did not take over its port" sh -c "curl -fsS http://127.0.0.1:$app_port/healthz | grep -qv setup"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: http://localhost:$app_port" --data 'password=smoke-test-1' "http://localhost:$app_port/login")
[[ $code == 303 ]] || fail "signing in with the chosen password answered $code"
say "password chosen; the app is up and takes it"

token=$(grep '^WHATSAPP_BRIDGE_TOKEN=' "$ORMMA_HOME/ormma.env" | cut -d= -f2-)
wait_for "the bridge did not answer" curl -fsS "http://127.0.0.1:$bridge_port/healthz"
state=$(curl -fsS -H "Authorization: Bearer $token" "http://127.0.0.1:$bridge_port/status" | sed -n 's/.*"state":"\([a-z]*\)".*/\1/p')
[[ $state == idle ]] || fail "the bridge is '$state', not idle"
say "the bridge is up, with no phone linked"

"$ormma" stop --quiet >/dev/null
wait_for "it did not stop" sh -c "! kill -0 $serve_pid"
if curl -fsS "http://127.0.0.1:$app_port/healthz" >/dev/null 2>&1; then fail "something still answers after stop"; fi
serve_pid=
say "stopped cleanly — all good"
