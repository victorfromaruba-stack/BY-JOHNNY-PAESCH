#!/usr/bin/env bash
# Temporary: download the God's Eye View installer, check it, run it. Deleted after use.
set -euo pipefail
mkdir -p /opt/gods-eye-setup && cd /opt/gods-eye-setup
curl -fsSL https://raw.githubusercontent.com/victorfromaruba-stack/BY-JOHNNY-PAESCH/gev-installer/gev.tgz -o gev.tgz
echo "a70f68c456e7050508f4af0d58f87368a40aa4c74b3efa0c46ba9c18d4c4e72a  gev.tgz" | sha256sum -c
tar -xzf gev.tgz
exec bash scripts/install-gods-eye.sh </dev/tty
