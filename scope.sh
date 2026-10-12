#!/usr/bin/env bash
# Temporary: download the telescope relay installer (ai-hq scripts/install-scope-bridge.sh),
# check it, run it. For the box at home next to the Seestar. Undo: add  -s -- --undo  after bash.
set -euo pipefail
d="$(mktemp -d)"; cd "$d"
curl -fsSL https://raw.githubusercontent.com/victorfromaruba-stack/BY-JOHNNY-PAESCH/gev-installer/scope.tgz -o scope.tgz
echo "7cb7f1b434e12a7cd8954ef7665ad0e24273644df9f688df75c75cc509526ab8  scope.tgz" | sha256sum -c
tar -xzf scope.tgz
exec sudo bash scripts/install-scope-bridge.sh "$@" </dev/tty
