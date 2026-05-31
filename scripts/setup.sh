#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
EXT_DIR="$REPO_DIR/extensions"
PI_EXT_DIR="$HOME/.pi/agent/extensions"
EXTENSIONS=(pi-memory pi-orchestrator pi-skills pi-workflows)

echo "Open PI Harness — Extension Setup"
echo "================================="
echo ""

if ! command -v pi &>/dev/null; then
  echo "WARNING: PI Agent (pi) is not installed."
  echo "  Install with: npm install -g @mariozechner/pi-coding-agent"
  echo ""
fi

mkdir -p "$PI_EXT_DIR"

for ext in "${EXTENSIONS[@]}"; do
  target="$EXT_DIR/$ext"
  link="$PI_EXT_DIR/$ext"

  if [ ! -d "$target" ]; then
    echo "ERROR: Extension not found: $target"
    exit 1
  fi

  if [ -L "$link" ]; then
    existing="$(readlink -f "$link")"
    if [ "$existing" = "$(readlink -f "$target")" ]; then
      echo "  $ext — already linked (no change)"
      continue
    fi
    rm "$link"
    ln -s "$target" "$link"
    echo "  $ext — updated (was $existing)"
    continue
  elif [ -e "$link" ]; then
    echo "ERROR: $link exists but is not a symlink. Remove it manually."
    exit 1
  fi

  ln -s "$target" "$link"
  echo "  $ext — linked"
done

echo ""
echo "Symlinks created in $PI_EXT_DIR"
echo ""

all_ok=true
for ext in "${EXTENSIONS[@]}"; do
  link="$PI_EXT_DIR/$ext"
  if [ -L "$link" ] && [ -f "$link/package.json" ]; then
    :
  else
    echo "WARN: $link does not resolve to a valid extension"
    all_ok=false
  fi
done

if $all_ok; then
  echo "All 4 extensions linked and valid."
fi

echo ""
echo "Next steps:"
echo "  1. Configure your model: see docs/llm-setups/ for setup guides"
echo "  2. Edit ~/.pi/agent/models.json with your model's endpoint"
echo "  3. Start your inference server (llama-server, ds4-server, etc.)"
echo "  4. Run: cd /path/to/your/project && pi"
