#!/usr/bin/env bash
# Temporary: download the God's Eye View installer, check it, run it. Deleted after use.
set -euo pipefail
mkdir -p /opt/gods-eye-setup && cd /opt/gods-eye-setup
curl -fsSL https://raw.githubusercontent.com/victorfromaruba-stack/BY-JOHNNY-PAESCH/gev-installer/gev.tgz -o gev.tgz
echo "8fbd91b02e698fbd97163bea9c0e42d021a26c7f8a4d07fd44f8dfda0a37fe4b  gev.tgz" | sha256sum -c
tar -xzf gev.tgz
exec bash scripts/install-gods-eye.sh </dev/tty
