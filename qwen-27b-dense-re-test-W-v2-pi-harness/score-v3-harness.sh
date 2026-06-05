#!/bin/bash
# Score V3 dictionary harness screenshots with GPT-5.4 via Codex CLI
# Same V1 rubric + new dimension 7: factual accuracy vs original prompt
# Run: bash score-v3-harness.sh
# Prereq: codex login --device-auth

set -euo pipefail

BASE="condition-I-harness-v3"
RESULTS_FILE="scores/v3-dict-gpt54-scores.jsonl"
PROMPTS_FILE="prompts/all-100-prompts.json"
mkdir -p scores

> "$RESULTS_FILE"

TOTAL=0
SCORED=0
SUM=0

for PNG in "$BASE"/component-*-run0-harness-desktop.png; do
  [ -f "$PNG" ] || continue
  COMP=$(basename "$PNG" | sed 's/-harness-desktop.png//')

  if grep -q "\"id\":\"$COMP\"" "$RESULTS_FILE" 2>/dev/null; then
    echo "SKIP $COMP (already scored)"
    continue
  fi

  # Extract original prompt for this component
  ORIG_PROMPT=$(python3 -c "
import json, sys
with open('$PROMPTS_FILE') as f:
    prompts = json.load(f)
for p in prompts:
    if p['id'] == '$COMP':
        print(p['prompt'])
        break
" 2>/dev/null || echo "")

  if [ -z "$ORIG_PROMPT" ]; then
    echo "SKIP $COMP (prompt not found)"
    continue
  fi

  TOTAL=$((TOTAL + 1))
  echo "[$TOTAL] Scoring $COMP..."

  CRITIQUE_PROMPT="You are a senior product designer reviewing a UI component screenshot.

The ORIGINAL PROMPT that was given to generate this component was:
---
$ORIG_PROMPT
---

Provide a structured design critique covering:
1. Visual hierarchy — is the most important element immediately obvious?
2. Spacing & layout — consistent spacing system? Specific values that need changing?
3. Typography — weight contrast, size scale, readability
4. Color — contrast ratios, palette cohesion, WCAG AA accessibility
5. Component completeness — all states shown? (hover, disabled, loading, error, empty)
6. Production readiness — what would a senior designer change before shipping?
7. Factual accuracy — does the output match the original prompt? Check specific values: prices, counts, feature names, labels, colors mentioned. List any mismatches (e.g. prompt says \$49 but output shows \$9).

Score 1-10. The factual accuracy dimension should penalize the overall score: if a key value like a price is wrong, cap the score at 6 maximum regardless of visual quality.

Be specific — name exact measurements, not general advice."

  RESULT=$(codex exec -m gpt-5.4 --dangerously-bypass-approvals-and-sandbox --ephemeral "$CRITIQUE_PROMPT" -i "$PNG" 2>/dev/null || echo "CODEX_ERROR")

  if [ "$RESULT" = "CODEX_ERROR" ]; then
    echo "  ERROR: Codex failed for $COMP"
    echo "{\"id\":\"$COMP\",\"condition\":\"I-harness-v3-dict\",\"context_window\":\"131k\",\"workflow\":\"web-design-benchmark-dict\",\"model\":\"qwen3.6-27b-mtp\",\"score\":null,\"error\":true,\"critique\":\"\"}" >> "$RESULTS_FILE"
    continue
  fi

  SCORE=$(echo "$RESULT" | grep -oP '(\d+\.?\d*)\s*/\s*10' | head -1 | grep -oP '^\d+\.?\d*' || echo "")
  CRITIQUE_JSON=$(echo "$RESULT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')

  echo "{\"id\":\"$COMP\",\"condition\":\"I-harness-v3-dict\",\"context_window\":\"131k\",\"workflow\":\"web-design-benchmark-dict\",\"model\":\"qwen3.6-27b-mtp\",\"score\":${SCORE:-null},\"error\":false,\"critique\":${CRITIQUE_JSON}}" >> "$RESULTS_FILE"

  if [ -n "$SCORE" ]; then
    SCORED=$((SCORED + 1))
    SUM=$(echo "$SUM + $SCORE" | bc)
    echo "  $COMP: ${SCORE}/10"
  else
    echo "  $COMP: PARSE_FAIL"
  fi
done

if [ "$SCORED" -gt 0 ]; then
  AVG=$(echo "scale=2; $SUM / $SCORED" | bc)
  echo ""
  echo "========================================"
  echo "V3 DICT HARNESS SCORING COMPLETE"
  echo "========================================"
  echo "Total screenshots: $TOTAL"
  echo "Successfully scored: $SCORED"
  echo "Average score: $AVG/10"
  echo "V1 raw baseline: 5.96/10"
  echo "V2 harness baseline: 6.53/10"
  echo "Delta vs V1: $(echo "$AVG - 5.96" | bc)/10"
  echo "Delta vs V2: $(echo "$AVG - 6.53" | bc)/10"
  echo "========================================"
fi
