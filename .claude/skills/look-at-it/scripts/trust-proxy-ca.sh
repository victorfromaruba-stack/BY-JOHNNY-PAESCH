#!/usr/bin/env bash
# Make the bundled Chromium trust this sandbox's egress-proxy CA, so HTTPS verifies normally.
#
# Why this is needed: outbound HTTPS is re-terminated by the agent proxy. The shell already trusts
# its CA through a dozen environment variables, but Playwright's Chromium carries its own trust
# store and reads none of them, so the first navigation fails ERR_CERT_AUTHORITY_INVALID.
#
# This installs the CA as a trusted root. It is the correct fix, not a bypass: TLS still verifies,
# and only this one known CA is added. Do not reach for --ignore-certificate-errors instead.
set -euo pipefail
CA=/root/.ccr/agent-proxy-ca.crt
DB="sql:$HOME/.pki/nssdb"

[ -f "$CA" ] || { echo "no proxy CA at $CA — nothing to trust, you may not need this"; exit 0; }

if ! command -v certutil >/dev/null 2>&1; then
  echo "installing libnss3-tools for certutil..."
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y libnss3-tools >/dev/null 2>&1 || {
    echo "could not install certutil; report this rather than working around TLS"; exit 1; }
fi

mkdir -p "$HOME/.pki/nssdb"
if certutil -L -d "$DB" 2>/dev/null | grep -q "CCR Agent Proxy CA"; then
  echo "proxy CA already trusted"
else
  certutil -A -n "CCR Agent Proxy CA" -t "C,," -i "$CA" -d "$DB"
  echo "proxy CA installed as a trusted root"
fi
certutil -L -d "$DB" 2>/dev/null | sed -n '1,6p'
