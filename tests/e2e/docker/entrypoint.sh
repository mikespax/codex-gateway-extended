#!/usr/bin/env bash
set -euo pipefail

mkdir -p /home/codex/.ssh /home/codex/.codex /workspace
mkdir -p /home/codex/.local
chmod 700 /home/codex/.ssh
chown -R codex:"$(id -gn codex)" /home/codex/.ssh /home/codex/.local /home/codex/.codex

if [ -x /usr/local/bin/e2e-gpu-training ]; then
  runuser -u trainer -- /usr/local/bin/e2e-gpu-training >/dev/null 2>&1 &
fi

exec /usr/sbin/sshd -D -e
