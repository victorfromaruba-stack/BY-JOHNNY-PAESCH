#!/usr/bin/env bash
# Temporary: download the God's Eye View installer, check it, run it. Deleted after use.
set -euo pipefail
if [ "$(id -u)" != 0 ]; then
  echo "This needs the server's admin account (root), not $(whoami)."
  echo "Type  exit  and press Enter (or log in as root), then paste the same line again."
  exit 1
fi
mkdir -p /opt/gods-eye-setup && cd /opt/gods-eye-setup
curl -fsSL https://raw.githubusercontent.com/victorfromaruba-stack/BY-JOHNNY-PAESCH/gev-installer/gev.tgz -o gev.tgz
echo "4be742cff4c0b562cb1b1e640331011d252d95bcc8a3b54201b4941ca87c0fda  gev.tgz" | sha256sum -c
tar -xzf gev.tgz
exec bash scripts/install-gods-eye.sh </dev/tty
