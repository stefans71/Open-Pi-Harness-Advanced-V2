# 27B Harness Benchmark Test

## Quick Context

This directory runs 100 frontend component prompts through an 8-node Pi harness workflow
on Qwen3.6-27B, then compares GPT-5.4 critique scores against the V1 baseline (raw 27B
without harness, avg 5.96/10 for paired components).

Read `training-data-map.md` for full data provenance, scoring methodology, SQL queries,
and controlled variable documentation. Read `optimization-plan.md` for the current plan.

## Results (2026-06-04, complete)

**76/100 components scored** (24 timed out):
- Harness avg: **6.53/10** vs V1 baseline: **5.96/10** = **+0.57 delta**
- Harness wins: 47/71 (66%), ties: 18 (25%), V1 wins: 6 (8%)
- Batch 1 (32K ctx, N=63): +0.56 delta
- Batch 2 (131K ctx, N=8): +0.69 delta

**Difficulty stratification:**
- Hard (V1 ≤5): **+1.36 delta**, 89% wins — harness raises the floor dramatically
- Mid (V1 5.5-6): +0.52, 74% wins
- Easy (V1 ≥6.5): +0.08, 42% wins — diminishing returns at top

**4 regressions investigated:**
- 043 (-2.0), 045 (-1.0): Screenshot bug — modal closed in screenshot, not a real regression
- 059 (-2.0): Review overload — 276-line review caused rework collapse
- 042 (-1.0): Over-engineering — brief too detailed, cluttered output

**OpenCode comparison (Condition H, 10 validation prompts):**
- PI harness: **6.36/10** (+0.57 vs V1) — winner
- V1 raw: 5.79/10 — baseline
- OpenCode: 5.57/10 (-0.21 vs V1) — worse than raw baseline
- OpenCode produces ~3-5K files (single-shot) vs PI's ~20-40K (8-node pipeline)

## Key Facts

- **Workflow:** `web-design-benchmark.yaml` (8 nodes: brief → tokens → implement → verify → review → gate → rework → verify-rework)
- **Workflow location:** `.pi/workflows/web-design-benchmark.yaml` (relative to harness root `pi-harness-stable/`)
- **Batch script:** `batch-harness.py` — runs prompts via `pi -p "/workflow run web-design-benchmark <prompt>"`
- **Missing batch:** `run-missing.py` on AutoDL — ran the 33 remaining prompts (complete)
- **Scoring script:** `score-all-harness.sh` — GPT-5.4 via Codex CLI on desktop screenshots
- **Comparison script:** `scores/fix-batch-tags.py` — merges harness scores with V1 baseline, tags batch 1/2
- **OpenCode script:** `run-opencode-validation.py` — runs 10 validation prompts through OpenCode
- **Timeout:** 15 min per prompt (harness), 5 min (OpenCode), ~9 min avg completion
- **Output:** `condition-G-harness/<component-id>/harness-output.html` + `artifacts/`
- **OpenCode output:** `condition-H-opencode/<component-id>/opencode-output.html`

## Score Data Files

- `scores/harness-gpt54-scores.jsonl` — 76 PI harness scores with batch tags
- `scores/opencode-gpt54-scores.jsonl` — 7 OpenCode scores
- `scores/v1-vs-harness-comparison.jsonl` — paired V1 vs harness with deltas
- `scores/final-comparison-summary.txt` — full comparison report
- `scores/difficulty-analysis.json` — per-prompt difficulty + type + delta
- `scores/regression-analysis.md` — failure mode analysis for 4 regressions
- `scores/3way-validation-comparison.json` — V1 vs PI vs OpenCode (10 prompts)
- `scores/validation-10-ids.json` — the 10 validation prompt IDs

## Baseline Data

V1 dataset SQLite DB:
```
/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/db/dataset.sqlite
```

Two scoring systems exist in this DB — don't confuse them:
- **Critique scores** (in `components.critique_text`, /10 scale) = GPT-5.4 reviewing the **raw 27B output**. This is our baseline: **5.96/10 avg** (71 paired run0 components).
- **Eval scores** (in `eval_scores` table, /9 scale) = scoring the **GPT-5.4 improved output**. This is the ceiling, not the baseline.

V1 raw component files:
```
/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/assets/components/component-NNN-run0/
```

## AutoDL Instance

- **Current:** SSH `ssh -p 21340 root@connect.westb.seetacloud.com` (port changes on reboot)
- **GPU:** RTX 4090 48GB (confirmed via nvidia-smi: "NVIDIA GeForce RTX 4090", 49140 MiB, compute 8.9 Ada Lovelace) — this is a modified/cloud variant with doubled VRAM vs consumer 24GB
- **Previous:** RTX 5090 32GB (westc, shut down — low balance)
- **Model:** `/root/autodl-tmp/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf`
- **llama-server:** `llama-mtp/build-ada/bin/llama-server` (rebuilt for sm_89/Ada)
  - Running: `-c 131072 -np 1 -ngl 99 -fa on` on port 11434
  - VRAM: ~27.9GB / 49.1GB
- **models.json** (`/root/.pi/agent/models.json`): `contextWindow: 131072`, `maxTokens: 32768`
- **SSH tunnel for OpenCode:** `ssh -L 11434:localhost:11434 -fN -p 21340 root@connect.westb.seetacloud.com`

## OpenCode Setup

- Installed: `opencode` v0.0.55 (`dpkg -i opencode-linux-amd64.deb`)
- Config: `~/.opencode.json` with `LOCAL_ENDPOINT=http://localhost:11434/v1`
- Model auto-discovered as `local.Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf`
- Known issue: tool-call JSON truncation for large files. Set `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=65536`
- Files written to `/home/user/` (OpenCode sandbox), script copies to `condition-H-opencode/`

## YouTuber Head-to-Head Test (2026-06-04, complete)

Testing the same mega-prompt (AI Model Testing Command Center dashboard) across conditions:

| Condition | Model | Quant | Pipeline | Score | Features | Size |
|-----------|-------|-------|----------|:-----:|:--------:|------|
| YouTuber | Qwen3.6-27B | Q8_XL | None (OpenCode, likely via Ollama) | **8.0** | 20/20 | 61KB |
| Raw Q5 | Qwen3.6-27B | Q5_K_XL | None (direct API, 690s) | **8.0** | 20/20 | 77KB |
| PI Harness | Qwen3.6-27B | Q5_K_XL | 8-node web-design-benchmark | **7.0** | 19/20 | 84KB |
| OpenCode | Qwen3.6-27B | Q5_K_XL | OpenCode agent loop | **FAILED** | — | — |

**YouTuber's setup**: llama.cpp (likely via Ollama) + OpenCode side-by-side + 2x RTX 3090 tensor split + 128K context + Q8_XL quant, no MTP. See `youtube-test/youtube-head2head.png` for screenshot evidence.

**Key finding**: Harness HURTS on detailed mega-prompts (-1.0 vs raw). Q5 vs Q8 quant is negligible. Full analysis: `youtube-test/comparison.md`

**Output dir**: `youtube-test/` with prompt, all HTML outputs, screenshots, scores, comparison.

**Generation speed**: Raw test measured ~36 tok/s (77KB / 690s). Varies with context depth — faster early, slower at end.

**Max tokens**: `maxTokens: 32768` in models.json. Sufficient for all nodes (raw test used ~25K tokens, implement ~25K). Could bump to 65K if rework node truncates, but unlikely to be needed.

### Scoring Methodology

These dashboards have interactive tabs, expandable details, sortable tables, and hover effects.
A single screenshot misses interactivity quality. Multi-state screenshot approach:

1. **Default** — full-page screenshot on load
2. **Above-fold** — viewport only (1920x1080), first impression
3. **Tab views** — click each of 5 tabs (Summary/Speed/Quality/Cost/Hardware), screenshot after
4. **Expanded** — click a prompt detail to expand
5. **Sorted** — click a table sort header
6. **Hover** — hover a card/chart element

~8 screenshots per condition. GPT-5.4 scores 6 dimensions (visual design, layout, interactivity, data presentation, polish, domain authenticity). Interactivity score compares tab screenshots against default — if content doesn't change, tabs are broken.

Scripts: `youtube-test/screenshot-all.js` (Playwright), `youtube-test/score-prompt.md` (rubric), `youtube-test/check-features.py` (20-feature checklist).

## Dictionary A/B Experiment (pending, blocked on re-runs)

Testing whether a UX production standards dictionary improves harness output — especially polish (scored 6/10 in YouTuber test vs 8/10 raw).

**Hypothesis**: The baseline harness's free-form "hostile review" is subjective and produces inconsistent rework. A structured dictionary with measurable rules + ordered rework passes should improve polish without losing the harness's floor-raising advantage on vague prompts.

**Prompt**: Features-only version of the YouTuber mega-prompt — same 20 features but NO design direction (no glassmorphism, no color guidance, no styling hints). This creates the "gap" where the harness should shine.

**3-way test**:
| Condition | Pipeline | Workflow |
|-----------|----------|----------|
| Condition I | Raw Q5 (direct API) | None |
| Condition G | Original harness (8 nodes) | `web-design-benchmark.yaml` |
| Condition G-dict | Dictionary harness (9 nodes) | `web-design-benchmark-dict.yaml` |

**Dictionary changes (vs baseline harness)**:
1. **Implement node reads dictionary** — model builds to standard from the start, not discovering violations in review
2. **New dict-lint bash node** — 12 automated standards checks (8px grid, hex count, hover count, ARIA, token density) before review
3. **Structured review** — every finding cites a rule ID (SP-01, TY-02, etc.) instead of free-form critique
4. **Ordered rework** — 4 passes: spacing/layout → typography → interactive states → color/depth (structural before cosmetic)

**Files**:
- Dictionary: `.pi/ux-production-standards.md` (42 rules, 8 categories: SP, TY, IS, CC, VD, AM, LS, CP)
- Workflow: `.pi/workflows/web-design-benchmark-dict.yaml`
- Prompt: `youtube-test/features-only-prompt.txt`
- Explainer: `pi-harness-v2.md` (full architecture deep-dive with analogies)

## PI Harness V2 — Features & Benefits

### What It Does
An 8-node structured workflow that transforms a single design prompt into production-quality HTML through iterative design → implementation → review → rework:

```
brief → tokens → implement → verify → review → gate → rework → verify-rework
```

Each node runs in a fresh context, reading only the artifacts from prior phases. No memory leakage between steps.

### Measured Results (100-prompt benchmark)
- **+0.57 score delta** over raw model output (6.53 vs 5.96 on GPT-5.4 /10 rubric)
- **66% win rate** against raw baseline (25% ties, 8% losses)
- **Raises the floor**: hard prompts improve +1.36 avg (89% wins) — the harness catches what the model misses
- **Diminishing returns at top**: easy prompts improve +0.08 — good models are already good
- **67KB output** vs 8.4KB raw baseline — 8x more HTML/CSS/JS per component

### Key Differentiators

**1. Intent-First Design Brief** (Node 1)
The model answers 5 design questions before writing code: who is the user, what's the primary action, what does success feel like, what domain vocabulary exists, what makes this different. Produces a full Intent Statement and Domain Exploration with color world, signature element, and rejected defaults.

**2. Domain-Evocative Design Tokens** (Node 2)
CSS custom properties with meaningful names: `--signal`, `--nebula`, `--champion`, `--void`, `--glass`, `--frost`, `--readout`, `--ghost`. The review enforces: "read your variable names out loud — do they belong to this product's world?"

**3. Automated Quality Gate** (Node 4)
Bash-based 12-point check: file exists, >3000 chars, DOCTYPE, body, style block, CSS custom properties, viewport meta, @media queries, no external CDN, focus-visible, hover states. Fails fast before review.

**4. Hostile Senior Engineer Review** (Node 5)
Reviews against 6 dimensions: design conformance, mobile-first, component completeness, craft, accessibility, HTML/CSS quality. Produces 20KB+ review with specific CSS selectors and fix instructions. Example: found 30+ hardcoded rgba values and mapped each to the correct token variable.

**5. Surgical Rework** (Node 7)
Fixes only FAIL items from review. Doesn't refactor PASS items. Documents each fix. Typical: fixes broken tab navigation, replaces hardcoded colors with tokens, adds missing interactive states.

**6. Full Artifact Trail**
Every run produces: `brief.md`, `design-tokens.md`, `quality-report.md`, `review-report.md`, `rework-summary.md`, `events.jsonl`. Complete provenance for debugging and optimization.

**7. No External Dependencies**
Zero CDN, zero frameworks, zero npm packages. Pure HTML/CSS/JS. Canvas-based charts instead of Chart.js. Self-contained single-file output.

### Head-to-Head Demo (YouTuber's mega-prompt)
Same complex dashboard prompt (AI Model Testing Command Center with 20+ features):

| Condition | GPT-5.4 Score | Features | Size |
|-----------|:------------:|:--------:|------|
| YouTuber Q8 raw (Open WebUI) | **8.0/10** | 20/20 | 61KB |
| Raw Q5 (direct API) | **8.0/10** | 20/20 | 77KB |
| PI Harness Q5 (8-node) | **7.0/10** | 19/20 | 84KB |
| OpenCode Q5 | FAILED | — | — |

**Key finding**: Harness *hurts* detailed mega-prompts (-1.0 vs raw). The model already knows what to build when given 400+ words of specific features — the brief/tokens/review pipeline adds overhead without value. Q5 vs Q8 quant shows no quality difference. Full analysis: `youtube-test/comparison.md`

### When to Use
- **Single-file component/page**: `web-design-benchmark` (this 8-node workflow)
- **Full frontend app**: `web-design` (24-node, multi-file, scaffold, PRD, inventory)
- **Best for hard prompts**: biggest gains on complex components the model struggles with raw

## What NOT to Touch

- `batch-direct.py` and `condition-H-direct/` exist but are not used — the V1 raw output already serves as the no-harness baseline.
- The full 24-node `web-design.yaml` is for real project work, not this benchmark. Use `web-design-benchmark.yaml`.
- Don't modify the parent `pi-harness-stable/CLAUDE.md` — it covers the harness project itself.

## TODO — Active Tasks

### YouTube Head-to-Head (complete)
1. **[DONE]** YouTuber Q8 raw output — `youtube-test/youtuber-q8-raw.html` (61KB, Cloudflare stripped)
2. **[DONE]** Raw Q5 model test — `youtube-test/raw-q5-output.html` (77KB, 690s, direct API)
3. **[DONE]** PI harness full 8/8-node run — `youtube-test/pi-harness-output.html` (90.7KB, ~35min)
4. **[FAILED]** OpenCode test — tool-call JSON truncation. See `youtube-test/opencode-findings.md`
5. **[DONE]** Multi-state screenshots — 22 total in `youtube-test/screenshots/`
6. **[DONE]** GPT-5.4 scoring — YouTuber 8.0, Raw Q5 8.0, PI Harness 7.0. In `youtube-test/scores.jsonl`
7. **[DONE]** Feature completeness — YT 20/20, Raw 20/20, Harness 19/20. In `youtube-test/feature-checklist.json`
8. **[DONE]** Comparison doc — `youtube-test/comparison.md`

### Component Re-runs (in progress)
9. **[IN PROGRESS]** Re-running 24 missing components. Script `run-missing-v3.py` (v3 = unbuffered output). 6/24 done (011, 025, 039, 062, 064, 067). ~18 remaining. Script died when SSH session dropped — **orphan pi processes** were the root cause of the original 72% late-batch timeout rate, not server degradation. Fix: v4 script uses `os.setsid()` + `os.killpg()` for proper process group management. v4 script is written but not yet deployed.

### Features-Only A/B Test (complete — 2026-06-04)
10. **[DONE]** 3-way A/B with features-only mega-prompt (raw vs V2 vs V3)
    - Prompt: `youtube-test/features-only-prompt.txt` (20 features, no design direction)
    - Raw: 65KB, 7.0/10 (V1 rubric)
    - V2 Harness: 94KB, 6.5/10 — harness HURTS on this prompt (-0.5 vs raw)
    - V3 Dict Harness: 70KB, 7.0/10 — dictionary RECOVERS to match raw
    - Scored with exact V1 benchmark rubric (score-all-harness.sh prompt)
    - Output: `youtube-test/ab-test/` (HTML, PNGs, artifacts, scores)
    - Scores: `youtube-test/ab-test/ab-scores-v1rubric.jsonl`

### V3 Dictionary Harness 12-Prompt Batch (RUNNING — branch: feat/dictionary-enhanced-harness)
11. **[RUNNING]** Run V3 dict harness on 12 benchmark prompts on AutoDL
    - Script: `run-v3-batch.py` (deployed, running via nohup)
    - Output: `condition-I-harness-v3/` (mirrors condition-G-harness structure)
    - 12 IDs: [002, 003, 008, 010, 015, 027, 035, 040, 043, 044, 052, 059]
    - Key targets: 059 (truncation regression), 043 (screenshot bug), 027/040 (hard+low)
    - Started: 2026-06-04 20:00 UTC, ~6h total (12 × ~30min)
    - Log: `/tmp/v3-batch-log.txt` on AutoDL
    - Process group mgmt: os.setsid() + os.killpg() (orphan-safe)
12. **[PENDING]** Rsync condition-I-harness-v3/ to VPS after batch completes
13. **[PENDING]** Screenshot all 12 with Playwright (1280×900, matching V1/V2)
14. **[PENDING]** Score with GPT-5.4 (V1 rubric), save to `scores/v3-dict-gpt54-scores.jsonl`
15. **[PENDING]** 3-way comparison: V1 vs V2 vs V3 for these 12 prompts
16. **[PENDING]** Write V2 vs V3 analysis

### Component Re-runs (paused)
17. **[PAUSED]** 18 remaining V2 re-runs (011, 025, 039, 062, 064, 067 done). v4 script written, not deployed. Paused for V3 batch.

### Benchmark Optimization (pending)
18. Re-score 043, 045 with modals opened (fix screenshot bug)
19. Fix `--space-0.5` invalid CSS bug in tokens node template
20. Once V3 validated, integrate as production route in Pi harness
