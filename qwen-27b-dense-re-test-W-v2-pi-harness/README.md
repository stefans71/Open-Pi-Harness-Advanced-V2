# Qwen 27B Dense Re-Test with V2 Pi Harness

## What This Is

Can a structured design pipeline make a local 27B model produce frontend components
that rival GPT-5.4's quality improvements?

**100 prompts** run through the `web-design-benchmark` workflow (8-node Pi harness pipeline)
on Qwen3.6-27B Dense MTP, then scored by GPT-5.4 on a /10 design rubric. Results compared
against the V1 baseline where GPT-5.4 critiqued the same model's raw output.

| Condition | What | Avg Score |
|---|---|---|
| V1 raw 27B (baseline) | component.html, no harness, T=0.7 | **5.81/10** (91 run0 prompts scored) |
| V1 improved (ceiling) | improved.html, GPT-5.4 rewrote | **8.60/9** (~9.5/10 equivalent) |
| **Harness (this test)** | index.html via 8-node pipeline | **???** |

---

## V1 Baseline Dataset

### Database

All V1 data lives in a SQLite database on the VPS:

```
/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/db/dataset.sqlite
```

**Tables:**
- `components` — 500 rows (100 prompts x 5 temps). Fields: id, prompt, temperature, run,
  component_html, critique_text, improved_html, has_html, has_improved, has_critique
- `eval_scores` — 500 rows. Fields: component_id, visual_score (/3), alignment_score (/3),
  interactivity_score (/3), total (/9). **These score the improved.html, NOT the raw output.**
- `conversations` — conversation data (not used for this test)

### Two Scoring Systems (Don't Confuse Them)

| System | What it scores | Scale | Where |
|---|---|---|---|
| **Critique score** | Raw 27B output (component.html) | /10, design review | `components.critique_text` (parse "Score: N/10") |
| **Eval score** | GPT-5.4 improved output (improved.html) | /9 (visual+alignment+interactivity) | `eval_scores` table |

**The critique score is the correct baseline for this test.** The harness output will be
scored the same way — GPT-5.4 design critique of the screenshot, /10 scale.

### Querying Baseline Scores

Per-prompt critique scores for run0 (maps to our 100 test prompts):
```sql
sqlite3 /root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/db/dataset.sqlite "
SELECT
  id,
  CAST(REPLACE(SUBSTR(critique_text, INSTR(critique_text, 'Score: ') + 7, 2), '/', '') AS INTEGER) as score
FROM components
WHERE run = 'run0'
  AND critique_text IS NOT NULL AND critique_text != ''
  AND INSTR(critique_text, 'Score:') > 0
ORDER BY id
"
```

Overall baseline stats:
```sql
-- 91 of 100 run0 prompts have critique scores
-- Avg: 5.81/10, Min: 4, Max: 7
-- Distribution: 4s=12, 5s=24, 6s=87, 7s=17 (across all 140 scored components)
```

Per-prompt spread across temperatures:
```sql
sqlite3 /root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/db/dataset.sqlite "
SELECT
  substr(c.id, 1, 13) as prompt_base,
  COUNT(*) as runs,
  MIN(cs) as min, MAX(cs) as max, MAX(cs)-MIN(cs) as spread, ROUND(AVG(cs),2) as avg
FROM (
  SELECT c.id,
    CAST(REPLACE(SUBSTR(c.critique_text, INSTR(c.critique_text,'Score: ')+7,2),'/','' ) AS INTEGER) as cs
  FROM components c
  WHERE c.critique_text IS NOT NULL AND c.critique_text != '' AND INSTR(c.critique_text,'Score:')>0
) sub
JOIN components c ON sub.id = c.id
GROUP BY substr(c.id, 1, 13)
ORDER BY spread DESC
"
```

### Raw Files

```
/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/assets/components/
  component-NNN-runX/
    component.html          ← Raw 27B output (V1 baseline)
    improved.html           ← GPT-5.4 rewrite (quality ceiling)
    critique.md             ← GPT-5.4 design critique of raw output (/10)
    screenshot-desktop.png  ← 1280x900 rendered screenshot
    screenshot-mobile.png   ← 390x844 mobile screenshot
    metadata.json           ← Generation metadata
```

Eval scores JSONL (one line per component, scores the improved.html):
```
/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/eval/scores.jsonl
```

### V1 Pipeline

```
100 prompts x 5 temperatures (run0-run4) = 500 components

For each:
1. Qwen3.6-27B-MTP → llama-server (T=0.7, no thinking)  → component.html
2. Playwright rendered screenshots (desktop + mobile)
3. GPT-5.4 critiqued the screenshot                       → critique.md (score /10)
4. GPT-5.4 rewrote HTML with improvements                 → improved.html
5. All packaged into JSONL training records                → dataset-final.jsonl
```

---

## V2 Harness Test (This Test)

### Workflow: web-design-benchmark.yaml

8-node pipeline designed for single-HTML-file component generation:

```
brief → tokens → implement → verify → review → gate-final → rework → verify-rework
```

| Node | Type | Fresh Context | What It Does |
|---|---|---|---|
| brief | prompt | no | Intent First methodology, domain exploration, color world, design decisions |
| tokens | prompt | yes | Complete CSS custom property system (:root block) with domain-evocative names |
| implement | prompt | yes | Builds single self-contained HTML file using tokens from brief + token phases |
| verify | bash | — | Automated checks: file exists, >3000 chars, DOCTYPE, body, style, viewport, media queries, no CDN, hover, focus-visible |
| review | prompt | yes | Hostile senior engineer review: design conformance, mobile-first, states, craft, a11y |
| gate-final | approval | — | Auto-rejects in -p mode (on_reject: continue), rework runs regardless |
| rework | prompt | yes | Fixes FAIL items from review, surgical changes only |
| verify-rework | bash | — | Final size/structure check, copies to artifacts |

The full 24-node `web-design.yaml` workflow was designed for multi-file component projects.
This benchmark variant targets single-HTML output matching the test prompt format.

Workflow file: `/.pi/workflows/web-design-benchmark.yaml` (relative to harness root)

### Smoke Test Results (component-002, Shipfast pricing card)

- Pipeline time: **525 seconds (~8.75 min)**
- Output: **22,333 chars** (vs 8,434 avg for V1 raw)
- Verify: **12/12 automated checks passed**
- Review: **6/10** (27B self-review) — found hardcoded values, broken click handler, scope creep
- Rework: **14 items fixed** — added missing disabled state, replaced hardcoded hex, fixed DOM mutation

### Batch Runner

`batch-harness.py` runs all 100 prompts through the benchmark workflow:

```bash
# On AutoDL 5090:
export PATH="/root/autodl-tmp/node-v22.15.0-linux-x64/bin:$PATH"
cd /root/autodl-tmp/pi-harness-stable

# Full run (in screen)
screen -S harness-batch
python3 qwen-27b-dense-re-test-W-v2-pi-harness/batch-harness.py --port 11434

# Resume from prompt N:
python3 qwen-27b-dense-re-test-W-v2-pi-harness/batch-harness.py --port 11434 --start 50

# Quick 3-prompt validation:
python3 qwen-27b-dense-re-test-W-v2-pi-harness/batch-harness.py --port 11434 --count 3
```

- **Timeout:** 15 min per prompt (pipeline averages ~9 min on 27B)
- **Resume:** Skips components that already have `harness-output.html > 500 bytes`
- **Cleanup:** Deletes stale workflow artifacts between runs
- **Expected total time:** ~15 hours for 100 prompts

---

## Directory Structure

```
qwen-27b-dense-re-test-W-v2-pi-harness/
├── CLAUDE.md                          ← Claude Code session context
├── README.md                          ← This file
├── batch-harness.py                   ← Condition G runner (8-node workflow)
├── batch-direct.py                    ← Condition H runner (direct API, 2 calls) — NOT USED
├── condition-G-harness/               ← Harness outputs
│   ├── component-NNN-run0/
│   │   ├── harness-output.html        ← HTML from benchmark workflow
│   │   ├── harness-desktop.png        ← Rendered screenshot (1280x900)
│   │   └── artifacts/                 ← Workflow artifacts (brief.md, tokens, review, etc.)
│   └── summary.json                   ← Batch results summary
├── condition-H-direct/                ← NOT USED (V1 raw output already exists)
├── scores/
│   ├── condition-G-scores.jsonl       ← GPT-5.4 critique scores for harness outputs
│   └── comparison.md                  ← Final comparison vs V1 baseline
└── prompts/
    ├── all-100-prompts.json           ← Full 100 prompts
    └── test-prompts.json              ← 10-prompt subset
```

### File Naming Rules

- **harness-output.html** = generated by Pi harness benchmark workflow
- **harness-desktop.png** = screenshot of harness output
- **direct-output.html** = generated by direct API call (legacy, not used)

---

## AutoDL Setup — RTX 5090

### Instance

```bash
# SSH — port changes on reboot, check AutoDL web UI
# As of 2026-06-02: westc, port 33472
ssh -p 33472 root@connect.westc.seetacloud.com
```

### Model

Qwen3.6-27B Dense MTP (19GB GGUF):
```
/root/autodl-tmp/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf
```

### Start llama-server

```bash
/root/autodl-tmp/llama-mtp/build/bin/llama-server \
  -m /root/autodl-tmp/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf \
  -ngl 99 -c 32768 --no-mmap -np 1 \
  --host 0.0.0.0 --port 11434 \
  > /tmp/server-27b.log 2>&1 &

curl http://localhost:11434/health   # → {"status":"ok"}
# VRAM usage: ~21.8 GB / 32 GB
```

**Binary path note:** Use `llama-mtp/build/bin/llama-server` (not `llama-mtp/bin/llama-server`
which doesn't exist on the current instance).

### Sampling (Qwen3 Paper)

Thinking mode ON (default): `temperature: 0.6, top_p: 0.95, top_k: 20`

### Pi Agent Config

Pi harness on AutoDL: `/root/autodl-tmp/pi-harness-stable/`
Extensions symlinked from: `~/.pi/agent/extensions/` → `/root/autodl-tmp/pi-harness-stable/extensions/`

models.json model ID: `qwen3.6-27b-mtp`

**Config values that matter:**
- `reasoning: false` — Pi's reasoning format wastes tokens; server handles thinking via chat template
- `contextWindow: 32768`
- `maxTokens: 16384`
- `defaultThinkingLevel: "off"` in settings.json

### Provisioning from VPS

```bash
# 1. Rsync harness (from VPS)
rsync -avz --exclude='node_modules' --exclude='.git' --exclude='dist' \
  -e "ssh -p <PORT>" \
  /root/tinkering/Local-LLMs/Local-LLM-Agent/pi-harness-stable/ \
  root@connect.westc.seetacloud.com:/root/autodl-tmp/pi-harness-stable/

# 2. On AutoDL: install, fix paths, build
export PATH="/root/autodl-tmp/node-v22.15.0-linux-x64/bin:$PATH"
cd /root/autodl-tmp/pi-harness-stable
npm install
find extensions -name "tsconfig.json" -exec \
  sed -i "s|/usr/lib/node_modules|/root/autodl-tmp/node-v22.15.0-linux-x64/lib/node_modules|g" {} +
for ext in pi-memory pi-orchestrator pi-skills pi-workflows; do
  cd extensions/$ext && npx tsc --outDir dist --noImplicitAny false && cd ../..
done

# 3. Copy yaml module (workspace hoisting fix)
mkdir -p extensions/pi-workflows/node_modules
cp -r node_modules/yaml extensions/pi-workflows/node_modules/yaml

# 4. Re-link extensions
for ext in pi-memory pi-orchestrator pi-skills pi-workflows; do
  rm -rf ~/.pi/agent/extensions/$ext
  ln -s /root/autodl-tmp/pi-harness-stable/extensions/$ext ~/.pi/agent/extensions/$ext
done
```

---

## Scoring Pipeline (on VPS)

### Step 1: Rsync Results from AutoDL

```bash
rsync -avz -e "ssh -p <PORT>" \
  root@connect.westc.seetacloud.com:/root/autodl-tmp/pi-harness-stable/qwen-27b-dense-re-test-W-v2-pi-harness/condition-G-harness/ \
  /root/tinkering/Local-LLMs/Local-LLM-Agent/pi-harness-stable/qwen-27b-dense-re-test-W-v2-pi-harness/condition-G-harness/
```

### Step 2: Render Screenshots with Playwright

```bash
# Per file (desktop 1280x900):
bun -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('file:///path/to/harness-output.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/path/to/harness-desktop.png', fullPage: false });
  await browser.close();
})();
"
```

### Step 3: Score with GPT-5.4

Use the same /10 design critique rubric as V1. Score the screenshot, not the HTML.

```bash
codex exec -m gpt-5.4 --dangerously-bypass-approvals-and-sandbox --ephemeral \
  "You are a senior product designer reviewing a UI component screenshot.
Provide a structured design critique covering:
1. Visual hierarchy  2. Spacing & layout  3. Typography
4. Color  5. Component completeness  6. Production readiness
Score 1-10. Be specific." \
  -i /path/to/harness-desktop.png < /dev/null
```

### Step 4: Compare

Harness scores (condition-G-scores.jsonl) vs V1 critique scores from the SQLite DB.
Target: beat 5.81/10 avg across the 100 prompts.

---

## Comparison Table (Fill In After Testing)

### What We're Testing

1. **Harness > V1 raw?** → Does the 8-node pipeline (5.81 baseline) improve output quality?
2. **Harness close to V1 improved?** → Can structured prompting approach GPT-5.4 rewrite quality?
3. **Where does it help most?** → Which categories (form, card, navbar, mobile, marketing, data_display) benefit most from the pipeline?

### 10-Prompt Subset (quick comparison with 8B results)

| Component | Cat | A (Base 8B) | B (FT 8B) | G (27B+Harness) | V1 critique |
|---|---|---|---|---|---|
| component-012 | form | 5 | 6.5 | | 7 |
| component-014 | form | 5 | 5 | | — |
| component-002 | card | 5 | 6 | | 6 |
| component-028 | card | 5 | 5 | | 6 |
| component-003 | navbar | 4 | 4 | | 4 |
| component-021 | navbar | 4 | 3 | | 5 |
| component-078 | mobile | 1 | 6 | | — |
| component-084 | mobile | 5 | 6.5 | | — |
| component-072 | marketing | 6 | 6.5 | | 6 |
| component-065 | data_display | 5 | 6.5 | | — |

### Full 100-Prompt Results

| Metric | G (27B + Harness) | V1 raw 27B (critique) |
|---|---|---|
| Prompts scored | /100 | 91/100 |
| Avg score (/10) | ??? | 5.81 |
| Min / Max | | 4 / 7 |
| Avg chars | | 8,434 |
| Avg generation time | | — |
| Has `<body>` tag | /100 | ~500/500 |

---

## Known Issues

1. **Pi -p mode gates:** `ctx.ui.confirm` returns false → approval gates auto-reject.
   `gate-final` uses `on_reject: continue` so rework always runs. This is intentional
   for batch mode.

2. **Extension symlinks:** Pi loads from `~/.pi/agent/extensions/`, not the project dir.
   Must re-link after every rsync.

3. **yaml module hoisting:** Copy `node_modules/yaml` to `extensions/pi-workflows/node_modules/yaml/`.

4. **reasoning: false in models.json:** Even with thinking ON at server level, Pi's
   reasoning=true wastes output tokens. Always set reasoning: false.

5. **pi-memory ECONNREFUSED on port 8081:** Embedding server not running. Non-critical —
   memory extension errors don't affect workflow execution.

6. **Timeout:** The 8-node pipeline averages ~9 min per prompt on 27B. Batch script uses
   15 min timeout. Some complex prompts may still exceed this.

7. **Build on AutoDL:** Must use `--noImplicitAny false` flag when building TypeScript
   extensions on AutoDL (strict mode errors from missing PI type declarations).

8. **llama-server binary path:** On the current 5090 instance, use
   `llama-mtp/build/bin/llama-server` not `llama-mtp/bin/llama-server`.
