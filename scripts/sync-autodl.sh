#!/usr/bin/env bash
# Rsync Open-Pi-Harness-Advanced-V2 to AutoDL. Reads SSH port from .autodl-port file.
# Usage:
#   ./scripts/sync-autodl.sh          # normal sync
#   ./scripts/sync-autodl.sh --check  # connectivity test only
#   ./scripts/sync-autodl.sh --bg     # run in background (used by git hook)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_FILE="$REPO_ROOT/.autodl-port"
SSH_KEY="$HOME/.ssh/id_ed25519"
AUTODL_HOST="root@connect.westc.seetacloud.com"
REMOTE_PATH="/root/autodl-tmp/open-pi-harness/"
LOG_FILE="$REPO_ROOT/tmp/sync-autodl.log"

if [[ ! -f "$PORT_FILE" ]]; then
  echo "No .autodl-port file. Create it with: echo <port> > .autodl-port"
  exit 1
fi

PORT=$(< "$PORT_FILE")
PORT="${PORT//[[:space:]]/}"

if [[ -z "$PORT" || ! "$PORT" =~ ^[0-9]+$ ]]; then
  echo "Invalid port in .autodl-port: '$PORT'"
  exit 1
fi

SSH_CMD="ssh -i $SSH_KEY -p $PORT -o ConnectTimeout=5 -o BatchMode=yes"

if [[ "${1:-}" == "--check" ]]; then
  echo "Testing connection to AutoDL (port $PORT)..."
  if $SSH_CMD "$AUTODL_HOST" "echo ok" 2>/dev/null; then
    echo "AutoDL reachable."
  else
    echo "AutoDL not reachable on port $PORT."
    exit 1
  fi
  exit 0
fi

if [[ "${1:-}" == "--bg" ]]; then
  mkdir -p "$(dirname "$LOG_FILE")"
  nohup "$0" >> "$LOG_FILE" 2>&1 &
  exit 0
fi

TS=$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S JST')
echo "=== Syncing to AutoDL: $TS ==="

if ! $SSH_CMD "$AUTODL_HOST" "echo ok" >/dev/null 2>&1; then
  echo "AutoDL not reachable on port $PORT — skipping."
  exit 0
fi

rsync -avz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='tmp/' \
  --exclude='*.db' \
  --exclude='*.db-journal' \
  --exclude='.pi/workflow-artifacts/' \
  --exclude='.pi/skills/' \
  -e "$SSH_CMD" \
  "$REPO_ROOT/" \
  "$AUTODL_HOST:$REMOTE_PATH"

echo "=== Done: $(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S JST') ==="
