#!/bin/bash
# Fails if any tracked/staged file contains a real env secret value or a key-like pattern.
cd "$(dirname "$0")/.."
bad=0
for v in ALPACA_API_KEY_ID ALPACA_API_SECRET_KEY CLOUDFLARE_PAGES_TOKEN CF_R2_TOKEN HUB_PASSWORD HUB_GATE_PASSWORD; do
  val="${!v}"; [ -z "$val" ] && continue
  if grep -rIlF --exclude-dir=.git --exclude-dir=node_modules -- "$val" . >/dev/null; then echo "SECRET VALUE of $v found in files"; bad=1; fi
done
if grep -rIlE --exclude-dir=.git --exclude-dir=node_modules --exclude=secret_scan.sh '(AKIA[0-9A-Z]{16}|PK[A-Z0-9]{18}|sk-[A-Za-z0-9]{32,})' . >/dev/null; then echo "key-like pattern found"; bad=1; fi
[ $bad = 0 ] && echo "secret scan clean"; exit $bad
