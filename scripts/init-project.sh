#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$REPO_DIR/.pi/workflows"

GENERAL_WORKFLOWS=(code-task fix-bug add-tests refactor investigate)
ALL_WORKFLOWS=(code-task fix-bug add-tests refactor investigate web-design adversarial-review smart-review fix-github-issue prd-to-code self-improve trace-gen smoke-executor)

usage() {
  echo "Usage: $(basename "$0") <path> [--all]"
  echo ""
  echo "Create a new project with PI Agent workflows."
  echo ""
  echo "  <path>   Project directory to create (relative or absolute)"
  echo "  --all    Copy all workflows (default: general-purpose only)"
  echo ""
  echo "General workflows: ${GENERAL_WORKFLOWS[*]}"
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

TARGET="$1"
COPY_ALL=false
if [ "${2:-}" = "--all" ]; then
  COPY_ALL=true
fi

if [ ! -d "$SOURCE_DIR" ]; then
  echo "ERROR: Workflow source not found at $SOURCE_DIR"
  exit 1
fi

if $COPY_ALL; then
  WORKFLOWS=("${ALL_WORKFLOWS[@]}")
else
  WORKFLOWS=("${GENERAL_WORKFLOWS[@]}")
fi

mkdir -p "$TARGET/.pi/workflows"

copied=0
for wf in "${WORKFLOWS[@]}"; do
  src="$SOURCE_DIR/$wf.yaml"
  if [ -f "$src" ]; then
    cp "$src" "$TARGET/.pi/workflows/"
    copied=$((copied + 1))
  fi
done

if [ ! -f "$TARGET/.gitignore" ]; then
  cat > "$TARGET/.gitignore" << 'GITIGNORE'
.pi/memory.db
.pi/memory.db-journal
.pi/skills/
.pi/workflow-artifacts/
.pi/extensions/
GITIGNORE
else
  for entry in ".pi/memory.db" ".pi/memory.db-journal" ".pi/skills/" ".pi/workflow-artifacts/" ".pi/extensions/"; do
    if ! grep -qF "$entry" "$TARGET/.gitignore"; then
      echo "$entry" >> "$TARGET/.gitignore"
    fi
  done
fi

if command -v git &>/dev/null && [ ! -d "$TARGET/.git" ]; then
  git init "$TARGET" --quiet
fi

echo "Project created at $TARGET"
echo "  Workflows copied: $copied"
echo "  .gitignore: created"
echo ""
echo "Next: cd $TARGET && pi"
