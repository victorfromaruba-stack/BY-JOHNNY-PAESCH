#!/usr/bin/env bash
# Temporary: download the God's Eye View installer, check it, run it. Deleted after use.
set -euo pipefail
mkdir -p /opt/gods-eye-setup && cd /opt/gods-eye-setup
curl -fsSL https://raw.githubusercontent.com/victorfromaruba-stack/BY-JOHNNY-PAESCH/gev-installer/gev.tgz -o gev.tgz
echo "adda2f726cdeb0c78c22f725eddd91df45370a5b938e44a77ca66f336c6798a4  gev.tgz" | sha256sum -c
tar -xzf gev.tgz
exec bash scripts/install-gods-eye.sh </dev/tty
