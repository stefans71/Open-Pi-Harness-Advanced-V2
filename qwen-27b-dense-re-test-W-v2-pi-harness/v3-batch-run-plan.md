# V3 Dictionary Harness — 12-Prompt Batch Run

## Context

We just ran a single A/B test (features-only mega-prompt) through Raw / V2 / V3 and scored with GPT-5.4. V3 dict harness tied raw (7.0) and beat V2 (6.5). But that's N=1 on a non-standard prompt.

Now we need to run V3 on the **12 benchmark prompts** from the actual dataset — same prompts that have V1 baseline scores (5.96 avg) and V2 harness scores (6.53 avg). This gives us an apples-to-apples 3-way comparison using the exact same scoring rubric, screenshot settings, and prompt IDs.

The user wants all output in a new folder `condition-I-harness-v3/` that mirrors the existing `condition-G-harness/` structure exactly.

## Data Structure (matching condition-G-harness exactly)

```
condition-I-harness-v3/
├── component-002-run0/
│   ├── harness-output.html              ← final HTML (copied from pi's index.html)
│   └── artifacts/
│       ├── brief.md
│       ├── design-tokens.md
│       ├── dict-lint.md                  ← NEW in V3 (not in V2)
│       ├── events.jsonl
│       ├── index.html
│       ├── quality-report.md
│       ├── review-report.md
│       ├── rework-summary.md
│       └── workflow-state.json
├── component-002-run0-harness-desktop.png   ← Playwright screenshot (1280×900, fullPage)
├── component-003-run0/
│   ├── harness-output.html
│   └── artifacts/...
├── component-003-run0-harness-desktop.png
└── ... (12 components total)
```

**12 prompt IDs:** 002, 003, 008, 010, 015, 027, 035, 040, 043, 044, 052, 059

## Controlled Variables (apples-to-apples)

| Variable | V1 Baseline | V2 Harness (condition-G) | V3 Dict Harness (condition-I) |
|---|---|---|---|
| Model | Qwen3.6-27B-MTP-UD-Q5_K_XL | Same | Same |
| Prompts | Same 100 prompts | Same | Same 12 subset |
| Scoring model | GPT-5.4 via Codex CLI | Same | Same |
| Scoring rubric | 6-dimension /10 critique | Same | **Same** |
| Screenshot | Playwright 1280×900 fullPage | Same | **Same** |
| Workflow | None (single API call) | web-design-benchmark (8 nodes) | **web-design-benchmark-dict (9 nodes)** |
| Context window | Unknown | 32K (batch1) / 131K (batch2) | 131K |
| maxTokens | Unknown | 16K / 32K | 32K |
| GPU | Unknown | 5090 (b1) / 4090 48GB (b2) | 4090 48GB |

**Only intentional variable:** workflow (V2 8-node → V3 9-node with dictionary)

## Implementation Steps

### Step 1: Write batch script for AutoDL

Python script `run-v3-batch.py` deployed to AutoDL at `/root/autodl-tmp/pi-harness-stable/`:
- Reads the 12 prompt IDs from a hardcoded list
- Loads prompt text from `prompts/all-100-prompts.json` (already on AutoDL from V2 runs)
- For each prompt:
  1. Kill stale pi processes (`kill_stale_pi()` from v4 pattern)
  2. Run `pi -p "/workflow run web-design-benchmark-dict <prompt>"` with `os.setsid()` + `os.killpg()` timeout (25 min)
  3. Find latest `web-design-benchmark-dict-*` artifact dir
  4. Copy `index.html` → `condition-I-harness-v3/component-NNN-run0/harness-output.html`
  5. Copy full artifact dir → `condition-I-harness-v3/component-NNN-run0/artifacts/`
  6. Log timing, size, exit status
- Output dir on AutoDL: `/root/autodl-tmp/pi-harness-stable/condition-I-harness-v3/`
- All `print()` with `flush=True`, run with `python3 -u`

**Key:** The prompts file is at `/root/autodl-tmp/pi-harness-stable/prompts/all-100-prompts.json` — need to verify this exists on AutoDL, or sync it.

### Step 2: Run batch on AutoDL

```bash
nohup python3 -u run-v3-batch.py > /tmp/v3-batch-log.txt 2>&1 &
```

12 prompts × ~30 min each = ~6 hours total. Monitor via log file.

### Step 3: Rsync results to VPS

```bash
rsync -avz -e "ssh -p PORT" \
  root@connect.westb.seetacloud.com:/root/autodl-tmp/pi-harness-stable/condition-I-harness-v3/ \
  /root/tinkering/Local-LLMs/Local-LLM-Agent/pi-harness-stable/qwen-27b-dense-re-test-W-v2-pi-harness/condition-I-harness-v3/
```

### Step 4: Screenshot all 12 components

Playwright script at 1280×900 viewport (matching V1/V2 — NOT 1920×1080):
- Input: `condition-I-harness-v3/component-NNN-run0/harness-output.html`
- Output: `condition-I-harness-v3/component-NNN-run0-harness-desktop.png`
- `fullPage: true`, wait 2000ms after networkidle

### Step 5: Score with GPT-5.4

Exact same prompt from `score-all-harness.sh`:

```
You are a senior product designer reviewing a UI component screenshot.
Provide a structured design critique covering:
1. Visual hierarchy ...
2. Spacing & layout ...
3. Typography ...
4. Color ...
5. Component completeness ...
6. Production readiness ...
Score 1-10. Be specific — name exact measurements, not general advice.
```

Via: `codex exec -m gpt-5.4 --dangerously-bypass-approvals-and-sandbox --ephemeral "$PROMPT" -i <png>`

Output: `scores/v3-dict-gpt54-scores.jsonl` with structure:
```json
{"id": "component-NNN-run0", "condition": "I-harness-v3-dict", "context_window": "131k", "workflow": "web-design-benchmark-dict", "model": "qwen3.6-27b-mtp", "score": N, "error": false, "critique": "..."}
```

### Step 6: 3-way comparison

Merge V1 baseline + V2 harness + V3 dict scores for the 12 prompts:
- V1 scores: from SQLite `critique_text` field for these 12 IDs
- V2 scores: from `scores/harness-gpt54-scores.jsonl` for these 12 IDs
- V3 scores: from `scores/v3-dict-gpt54-scores.jsonl`

Output: `scores/v1-v2-v3-comparison.jsonl`

## Files to Create/Modify

1. **NEW** `run-v3-batch.py` — batch script for AutoDL (deploy via scp)
2. **NEW** `condition-I-harness-v3/` — output directory (12 component subdirs)
3. **NEW** `screenshot-v3.js` — Playwright screenshot script (1280×900)
4. **NEW** `score-v3-harness.sh` — GPT-5.4 scoring script (V1 rubric)
5. **NEW** `scores/v3-dict-gpt54-scores.jsonl` — scoring results
6. **NEW** `scores/v1-v2-v3-comparison.jsonl` — 3-way comparison

## Current Status (2026-06-04)

### Features-Only A/B Test (COMPLETE)
Single mega-prompt (20 features, no design direction) scored with V1 benchmark rubric:
- **Raw**: 7.0/10 (65KB)
- **V2 Harness**: 6.5/10 (94KB) — harness hurts (-0.5 vs raw)
- **V3 Dict Harness**: 7.0/10 (70KB) — dictionary recovers to match raw
- Output: `youtube-test/ab-test/` (HTML, PNGs, artifacts, ab-scores-v1rubric.jsonl)

### 12-Prompt Batch (RUNNING)
- Script `run-v3-batch.py` deployed and running on AutoDL (nohup, PID 61761)
- Started: 2026-06-04 20:00 UTC, component-002 first
- Log: `ssh -p 21340 root@connect.westb.seetacloud.com 'cat /tmp/v3-batch-log.txt'`
- Output on AutoDL: `/root/autodl-tmp/pi-harness-stable/condition-I-harness-v3/`
- ETA: ~02:00 UTC June 5 (~6h total)
- Orphan protection: os.setsid() + os.killpg() + kill_stale_pi() before each run

### After Batch Completes — Resume Checklist
1. Check log: `ssh -p 21340 root@connect.westb.seetacloud.com 'tail -30 /tmp/v3-batch-log.txt'`
2. Verify 12 outputs: `ssh -p 21340 ... 'ls condition-I-harness-v3/*/harness-output.html | wc -l'`
3. Rsync to VPS: `rsync -avz -e "ssh -p 21340" root@connect.westb.seetacloud.com:/root/autodl-tmp/pi-harness-stable/condition-I-harness-v3/ ./condition-I-harness-v3/`
4. Screenshot all 12 with Playwright at **1280×900** (NOT 1920×1080 — match V1/V2)
5. Score with GPT-5.4 using exact V1 rubric (`score-all-harness.sh` lines 9-19, `codex exec -m gpt-5.4 ... -i <png>`)
6. Extract V1 scores from SQLite for these 12 IDs
7. Extract V2 scores from `scores/harness-gpt54-scores.jsonl` for these 12 IDs
8. Build 3-way comparison: `scores/v1-v2-v3-comparison.jsonl`

### Key File Paths
- V3 workflow: `.pi/workflows/web-design-benchmark-dict.yaml` (pi-harness-stable parent)
- V3 dictionary: `.pi/ux-production-standards.md` (pi-harness-stable parent)
- V1 raw HTML: `/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/assets/components/component-NNN-run0/component.html`
- V1 SQLite: `/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/db/dataset.sqlite`
- V2 harness HTML: `condition-G-harness/component-NNN-run0/harness-output.html`
- V3 harness HTML: `condition-I-harness-v3/component-NNN-run0/harness-output.html`
- V2 scores: `scores/harness-gpt54-scores.jsonl`
- V3 scores: `scores/v3-dict-gpt54-scores.jsonl` (to be created)
- Prompts: `prompts/all-100-prompts.json`
- Scoring rubric: `score-all-harness.sh` lines 9-19
- Training data map: `training-data-map.md`
- V3 explainer: `pi-harness-v3.md`
- V2 explainer: `pi-harness-v2.md`

## Verification

1. Each of 12 components has `harness-output.html` with `</html>` closing tag
2. Each has `artifacts/` with all expected files including `dict-lint.md`
3. Screenshots render at 1280×900 matching V2 screenshots
4. Scores use identical rubric — grep for "Score:" pattern matches
5. Compare V3 avg against V1 (5.96) and V2 (6.53) baselines
6. Check difficulty stratification: does V3 maintain V2's floor-raising on hard prompts?
