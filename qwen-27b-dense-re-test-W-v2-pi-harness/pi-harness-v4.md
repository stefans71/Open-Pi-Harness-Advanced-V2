# PI Harness — Complete Test History & V4.2C Production Architecture

**Branch**: `feat/dictionary-enhanced-harness`
**Status**: Running V4.2C batch (60 components in condition-M-C)
**Last updated**: 2026-06-05
**Model**: Qwen3.6-27B Dense MTP, UD-Q5_K_XL quant, on RTX 4090 48GB

---

## Test History — Every Condition We Ran

### Condition A: 8B Base, No Harness (10 prompts)
```
Prompt ──► Qwen3-VL-8B-Instruct ──► component.html
                                         │
                                   Codex GPT-5.4 ──► Score /10
```
- **Model**: Qwen3-VL-8B-Instruct (base, no fine-tune)
- **GPU**: RTX 3080 Ti
- **Quant**: Q8 (via Ollama)
- **Prompts**: 10 validation subset
- **Score**: **4.50/10 avg**
- **Output**: Small, minimal components

### Condition B: 8B Fine-Tuned, No Harness (10 prompts)
```
Prompt ──► frontend-design-expert-8b ──► component.html
           (QLoRA fine-tuned)                │
                                       Codex GPT-5.4 ──► Score /10
```
- **Model**: stefans71/frontend-design-expert-8b (QLoRA on 3,090 training records)
- **GPU**: RTX 3080 Ti
- **Quant**: Q8
- **Prompts**: 10 validation subset
- **Score**: **5.50/10 avg** (+1.0 over base 8B)
- **Finding**: Fine-tuning raised quality but still below 27B raw

### Condition V1: 27B Raw Baseline (100 prompts)
```
Prompt ──► Qwen3.6-27B-MTP ──► component.html (6-10KB)
                                    │
                              Playwright (1280×900)
                                    │
                              Codex GPT-5.4 ──► Score /10
                                    │
                              Codex GPT-5.4 ──► improved.html (ceiling)
```
- **Model**: Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf
- **GPU**: RTX 5090 32GB (original run)
- **Prompts**: 100 components
- **Score**: **5.96/10 avg** (N=94 scored, 6 failed)
- **Ceiling (Codex improved)**: 8.60/9 avg
- **Output**: `/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/assets/components/component-NNN-run0/component.html`
- **Improved**: Same path, `improved.html`
- **SQLite**: `/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/db/dataset.sqlite`

### Condition G: V2 Harness — 8-Node YAML (76/100 prompts)
```
Prompt ──► web-design-benchmark.yaml (8 nodes):
           brief → tokens → implement → verify → review → gate → rework → verify-rework
           (5 LLM calls, ~20min per component)
                    │
              harness-output.html (18-90KB)
                    │
              Codex GPT-5.4 ──► Score /10
```
- **Model**: Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf
- **GPU**: RTX 5090 (batch 1, 32K ctx) → RTX 4090 48GB (batch 2, 131K ctx)
- **Prompts**: 100 attempted, 76 completed, 24 timed out
- **Score**: **6.53/10 avg** (+0.57 vs V1 raw)
- **Win rate**: 66% harness wins, 25% ties, 8% V1 wins
- **Difficulty stratification**:
  - Hard (V1 ≤5): **+1.36 delta**, 89% wins — raises the floor
  - Medium (V1 5.5-6): +0.52, 74% wins
  - Easy (V1 ≥6.5): +0.08, 42% wins — diminishing returns
- **4 regressions**: 043/045 (screenshot bug), 059 (review overload → truncation), 042 (over-engineering)
- **Failure mode**: 24 timeouts from orphan pi processes cascading on -np 1 server
- **Output**: `condition-G-harness/component-NNN-run0/harness-output.html`
- **Scores**: `scores/harness-gpt54-scores.jsonl` (76 records)

### Condition H: OpenCode (7/10 prompts)
```
Prompt ──► OpenCode v0.0.55 ──► opencode-output.html (3-5KB)
           (agent loop)             │
                              Codex GPT-5.4 ──► Score /10
```
- **Model**: Same Qwen3.6-27B via SSH tunnel
- **Prompts**: 10 validation subset, 7 completed, 3 timed out
- **Score**: **5.57/10 avg** (-0.21 vs V1 raw — worse than baseline)
- **Finding**: Agent loop tool-call overhead truncates output. OpenCode loses to raw.
- **Output**: `condition-H-opencode/`

### YouTuber Head-to-Head (1 mega-prompt, 3 conditions)
```
Same 20-feature dashboard prompt across conditions:
  YouTuber Q8 raw (Open WebUI): 8.0/10, 61KB, 20/20 features
  Raw Q5 (direct API):          8.0/10, 77KB, 20/20 features
  PI Harness (8-node):          7.0/10, 84KB, 19/20 features
  OpenCode:                     FAILED
```
- **Finding**: Harness HURTS on detailed mega-prompts (-1.0 vs raw). Q5 vs Q8 quant no difference.
- **Output**: `youtube-test/`

### Features-Only A/B (1 mega-prompt, 3 conditions)
```
Same 20 features, NO design direction:
  Raw Q5:           7.0/10, 65KB
  V2 Harness:       6.5/10, 94KB — harness hurts (-0.5)
  V3 Dict Harness:  7.0/10, 70KB — dictionary recovers
```
- **Scored with V1 rubric** (apples-to-apples)
- **Output**: `youtube-test/ab-test/`

### Condition I: V3 Dictionary Harness — 9-Node YAML (9/12 prompts)
```
brief → tokens → implement+dict → verify → dict-lint → review+dict → gate → rework → verify-rework
(5 LLM calls, ~25min per component)
```
- **Model**: Same 27B
- **Dictionary**: `.pi/ux-production-standards.md` (42 rules, 8 categories)
- **Prompts**: 12 benchmark subset, 9 completed, 3 failed (027 contaminated, 040/044 timeout)
- **Score**: **6.50/10 avg** (+0.54 vs V1, -0.03 vs V2 — tied)
- **Key wins**: 059 truncation FIXED (V2: 5.0 → V3: 7.0), 043 screenshot FIXED (V2: 3.0 → V3: 6.5)
- **Key finding**: Dictionary prevents review overload but $49→$9 fact corruption in brief
- **Output**: `condition-I-harness-v3/`

### Condition J: V4 Raw-First — 7-Node YAML (4/12 before killed)
```
generate+dict → verify → dict-lint → review → gate → rework → verify-rework
(3 LLM calls, ~8min per component)
```
- **Prompts**: 4 completed before killed (scope expansion discovered)
- **002 Score**: 7.0/10 (V1 rubric), 8.0/10 (factual rubric)
- **Key finding**: Dictionary in generate context causes scope expansion (010 built full dashboard instead of split button). Killed and replaced by V4.1.
- **Output**: `condition-J-harness-v4/`

### Condition K: V4.1 Split Pipeline (12/12 prompts)
```
Session 1: pi -p "prompt" ──► raw index.html (~2min)
Bash: 17-item checklist ──► missing items list
Session 2: Direct API + YAML work order + sign-off ──► polished index.html (~3min)
(2 LLM calls, ~5.5min per component)
```
- **Prompts**: 12 benchmark subset, **12/12 completed, 0 failures**
- **Avg time**: 5.5min (vs V2's 20min, V3's 25min)
- **Polish delta**: +3.6KB avg, 100% sign-off rate
- **Dictionary**: 52 rules (added CRAFT section: SVG icons, multi-layer shadows, hover lift)
- **Key finding**: Raw 27B + targeted YAML polish = best architecture. No scope expansion, no fact corruption.
- **Output**: `condition-K-harness-v41/`

### Condition L: V4.2 First Run (12/12 prompts)
```
Same split pipeline + TY-08 display size + LS-07 CTA contrast + CD color direction
```
- **Dictionary**: 61 rules, 11 categories (added CD color direction, TY-08, LS-07, VD-05)
- **Prompts**: 12/12, 0 failures
- **Key finding**: TY-08 too aggressive — made split button text 48px. Fixed to prompt-aware.
- **Output**: `condition-L-harness-v42/`

### Condition M: V4.2 Production Run (50/50 prompts)
```
Split pipeline with prompt-aware TY-08 + CP-05 pricing flow
```
- **Prompts**: 50 (12 batch 1 + 38 batch 2), **50/50, 0 failures**
- **Avg time**: ~5.5min per component
- **Dictionary**: 62 rules
- **Checklist**: 21 items (prompt-aware)
- **Visual quality**: Near-Codex on most components, beats Codex on several (027, 040, 052)
- **Regressions**: 002 no glow, 035 Pro not blue (both factual — polish didn't see prompt)
- **Output**: `condition-M-harness-v42/`

### Condition M-B: Expert Persona A/B Test (5 prompts)
```
Same pipeline + expert persona in generate prompt:
"You are an expert UI/UX designer and senior frontend engineer..."
```
- **Prompts**: 5 regression components (002, 003, 010, 035, 044)
- **Raw checklist avg**: **12.2/21** (vs M's 11.6 — +0.6)
- **Key finding**: Small but consistent raw quality improvement. 010 jumped +2.
- **Output**: `condition-M-B-harness-v42/`

### Condition M-C: Expert Persona + Prompt-Aware Polish (5 prompts) ← WINNER
```
Expert persona in generate + original prompt injected in polish API call:
Polish sees: ORIGINAL PROMPT → FACTUAL CHECK → YAML WORK ORDER → HTML
```
- **Prompts**: 5 regression components
- **Raw checklist avg**: **13.4/21** (vs M's 11.6 — +1.8)
- **KEY WINS**:
  - 002: Purple glow restored (prompt says "subtle purple glow" — M/B had none)
  - 035: Pro column in blue (prompt says "Pro in blue" — M/B had no blue)
  - 044: 15/21 raw (+5 over M — biggest single improvement)
- **Finding**: Prompt injection in polish is the single biggest quality lever
- **Output**: `condition-M-C-harness-v42/`

### Condition M-C Batch 60 (55 prompts, RUNNING)
```
V4.2C production run — expert persona + prompt-aware polish on 55 new components
(5 already done in M-C test + 55 = 60 total)
```
- **Status**: Running on AutoDL, ~5h ETA
- **Log**: `/tmp/v42C-batch60-log.txt`
- **Output**: `condition-M-C-harness-v42/` (same folder as M-C test)

---

## Score Summary Table

| Condition | Model | Architecture | N | Avg Score | vs V1 Raw | Time/Component | Failures |
|-----------|-------|-------------|:-:|:---------:|:---------:|:--------------:|:--------:|
| A (8B base) | 8B Q8 | Raw | 10 | 4.50 | -1.46 | ~2min | 0 |
| B (8B fine-tuned) | 8B FT Q8 | Raw | 10 | 5.50 | -0.46 | ~2min | 0 |
| **V1 (27B raw)** | **27B Q5** | **Raw** | **94** | **5.96** | **baseline** | **~2min** | **6** |
| H (OpenCode) | 27B Q5 | Agent loop | 7 | 5.57 | -0.39 | ~5min | 3 |
| **G (V2 harness)** | **27B Q5** | **8-node YAML** | **76** | **6.53** | **+0.57** | **~20min** | **24** |
| I (V3 dict) | 27B Q5 | 9-node YAML | 9 | 6.50 | +0.54 | ~25min | 3 |
| J (V4 raw+dict) | 27B Q5 | 7-node YAML | 4 | — | — | ~8min | killed |
| K (V4.1 split) | 27B Q5 | Split: pi + API | 12 | — | visual: near-Codex | ~5.5min | **0** |
| L (V4.2) | 27B Q5 | Split + TY-08 | 12 | — | visual: near-Codex | ~5.5min | **0** |
| **M (V4.2 prod)** | **27B Q5** | **Split + 21 checks** | **50** | **—** | **visual: near-Codex** | **~5.5min** | **0** |
| M-B (+persona) | 27B Q5 | Split + persona | 5 | — | +0.6 raw checklist | ~5.5min | 0 |
| **M-C (+persona +prompt)** | **27B Q5** | **Split + persona + prompt** | **5→60** | **—** | **beats Codex on several** | **~5.5min** | **0** |

---

## V4.2C Production Architecture (Current)

Two completely separate sessions per component, orchestrated by Python:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    V4.2C SPLIT PIPELINE                             │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   SESSION 1       │  │    BASH      │  │    SESSION 2          │  │
│  │   pi -p "..."     │─▶│  CHECKLIST   │─▶│  Direct API call      │  │
│  │                   │  │  21 items    │  │  to llama-server      │  │
│  │  Expert persona:  │  │             │  │                       │  │
│  │  "You are an     │  │  Greps HTML  │  │  Receives:            │  │
│  │   expert UI/UX   │  │  for missing │  │  1. Original prompt   │  │
│  │   designer..."   │  │  production  │  │  2. YAML work order   │  │
│  │                   │  │  items       │  │  3. Raw HTML          │  │
│  │  Raw generate    │  │             │  │                       │  │
│  │  from prompt     │  │  Prompt-    │  │  FACTUAL CHECK:       │  │
│  │  only            │  │  aware      │  │  Verifies colors,     │  │
│  │                   │  │  (TY-08     │  │  labels, layout vs    │  │
│  │  Writes:         │  │   skips for │  │  original prompt      │  │
│  │  index.html      │  │   buttons)  │  │                       │  │
│  │                   │  │             │  │  YAML sign-off:       │  │
│  │  ~2min           │  │  Writes:    │  │  Model confirms each  │  │
│  └──────────────────┘  │  checklist  │  │  fix applied          │  │
│                        │  .md        │  │                       │  │
│                        │  ~0s        │  │  Writes:              │  │
│                        └──────────────┘  │  polished HTML        │  │
│                                          │  + sign-off.yaml      │  │
│                                          │  ~3min                │  │
│                                          └──────────────────────┘  │
│                                                                     │
│  Total: ~5min per component, 2 LLM calls, 0 failures              │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Innovations (what makes V4.2C work):
1. **Expert persona** in generate — primes model for typography hierarchy, spacing, color theory
2. **Original prompt injection** in polish — closes factual accuracy gap (glow, colors, labels)
3. **YAML work order with sign-off** — model confirms each fix, 100% accountability
4. **Prompt-aware checklist** — TY-08 only fires for pricing/headline prompts
5. **Direct API for polish** — bypasses PI tool-use limitations
6. **No YAML workflow engine** — Python orchestrates two independent processes
7. **No brief node** — no fact corruption, no scope expansion
8. **No dictionary in generate** — model builds creatively, dictionary only in polish context

---

## Harness Files — Where Everything Lives

```
pi-harness-stable/                              ← repo root
├── .pi/
│   └── ux-production-standards.md              ← THE DICTIONARY (62 rules, 11 categories)
│
└── qwen-27b-dense-re-test-W-v2-pi-harness/    ← benchmark test dir
    ├── run-v42m-C-split.py                     ← V4.2C HARNESS (production)
    ├── run-v42C-batch60.py                     ← Current running batch (55 components)
    ├── run-v42m-B-split.py                     ← B variant (persona only)
    ├── run-v42m-split.py                       ← M variant (baseline)
    ├── prompts/
    │   └── all-100-prompts.json                ← 100 component prompts
    │
    ├── condition-M-C-harness-v42/              ← V4.2C OUTPUT (60 components, running)
    ├── condition-M-B-harness-v42/              ← V4.2B A/B test (5 components)
    ├── condition-M-harness-v42/                ← V4.2 production (50 components)
    ├── condition-L-harness-v42/                ← V4.2 first run (12 components)
    ├── condition-K-harness-v41/                ← V4.1 split (12 components)
    ├── condition-J-harness-v4/                 ← V4 raw+dict (4 components, killed)
    ├── condition-I-harness-v3/                 ← V3 dictionary (9 components)
    ├── condition-G-harness/                    ← V2 baseline (76 components)
    ├── condition-H-opencode/                   ← OpenCode test (7 components)
    │
    ├── scores/                                 ← All scoring data
    │   ├── harness-gpt54-scores.jsonl          ← V2 GPT-5.4 scores (76 records)
    │   ├── v3-dict-gpt54-scores.jsonl          ← V3 scores (9 records)
    │   ├── v1-vs-harness-comparison.jsonl       ← V1 vs V2 paired
    │   ├── difficulty-analysis.json             ← Per-prompt difficulty
    │   └── regression-analysis.md               ← V2 regression analysis
    │
    ├── score-all-harness.sh                    ← V1 scoring rubric script
    ├── score-v3-harness.sh                     ← V3 scoring + factual accuracy
    │
    ├── pi-harness-v4.md                        ← THIS DOCUMENT
    ├── pi-harness-v3.md                        ← V3 architecture doc
    ├── pi-harness-v2.md                        ← V2 architecture doc
    ├── v3-harness-adaptions.md                 ← V3→V4 analysis
    └── training-data-map.md                    ← Full data provenance
```

### V1 Raw Data (separate repo)
```
/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/
├── assets/components/component-NNN-run0/
│   ├── component.html                         ← V1 raw 27B output
│   └── improved.html                          ← Codex GPT-5.4 improved
├── db/dataset.sqlite                          ← Baseline scores + eval scores
└── ...
```

---

## AutoDL Instance

- **SSH**: `ssh -p 21340 root@connect.westb.seetacloud.com` (port changes on reboot)
- **GPU**: RTX 4090 48GB (cloud variant, doubled VRAM)
- **Model**: `/root/autodl-tmp/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf` (19GB)
- **llama-server**: `/root/autodl-tmp/llama-mtp/build-ada/bin/llama-server` (sm_89/Ada)
- **Launch**: `-m <model> --port 11434 -c 131072 -np 1 -ngl 99 -fa on`
- **VRAM**: ~28GB / 49GB used
- **MTP**: Active (~90-100 tok/s)
- **PI Agent**: `/root/autodl-tmp/node-v22.15.0-linux-x64/bin/pi` v0.73.1
- **models.json**: `contextWindow: 131072`, `maxTokens: 32768`

### Restart llama-server:
```bash
nohup /root/autodl-tmp/llama-mtp/build-ada/bin/llama-server \
  -m /root/autodl-tmp/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf \
  --port 11434 -c 131072 -np 1 -ngl 99 -fa on \
  > /tmp/llama-server.log 2>&1 &
```

---

## Orphan & Process Protection

1. **`kill_everything()` at script startup** — kills other python batch scripts + pi processes
2. **`kill_stale_pi()` before each component** — kills lingering pi
3. **`os.setsid()` + `os.killpg()` on timeout** — kills entire process group
4. **`validate_output()`** — checks output matches prompt (anti-contamination)
5. **Never run two batch scripts simultaneously** — they compete for -np 1

**Known issue**: PI SkillCreator extension hangs 5-10min after generating. Fix: kill pi manually, script recovers.

---

## Dictionary — 62 Rules, 11 Categories

File: `.pi/ux-production-standards.md`

| Category | Code | Rules | Key items |
|----------|------|:-----:|-----------|
| Spacing | SP | 6 | 8px grid, 48-64px section gaps |
| Typography | TY | 8 | **TY-08: display ≥48px (prompt-aware, price only not plan names)** |
| Interactive States | IS | 7 | Hover, focus-visible, active, disabled, transitions |
| Color & Contrast | CC | 5 | WCAG AA 4.5:1, max 3 accents |
| Visual Depth | VD | 5 | **VD-05: visible card elevation** |
| Animation | AM | 5 | Reduced-motion, GPU-only properties |
| Layout | LS | 7 | **LS-07: saturated CTA color** |
| Component Patterns | CP | 5 | **CP-05: pricing card flow (name→price→divider→features)** |
| Color Direction | CD | 4 | **CD-01: follow prompt colors**, no default AI purple |
| Craft & Polish | CR | 10 | **CR-08: green checks**, **CR-09: glow 0.15-0.35**, CR-10: solid headings |

## Checklist — 21 Items (Prompt-Aware)

```python
has_tokens, has_hover, has_focus_visible, has_active, has_disabled,
has_transitions, has_reduced_motion, has_responsive, has_svg_icons,
has_aria, has_multi_shadow, has_hover_lift, has_letter_spacing,
has_word_break, has_display_size (prompt-aware), has_green_checks,
has_clean_glow, has_solid_headings, has_price_flow, has_cta_saturated,
has_visible_shadow
```

---

## Codex Scoring

### V1 Rubric (apples-to-apples):
```bash
codex exec -m gpt-5.4 --dangerously-bypass-approvals-and-sandbox --ephemeral \
  "You are a senior product designer..." -i <screenshot.png>
```

### Factual Rubric (prompt-aware):
Adds original prompt + dimension 7: factual accuracy. Caps at 6 if key value wrong.

### Screenshot: Playwright 1280×900, fullPage: true

---

## Evolution Summary

```
8B base:       4.50/10 (10 prompts)
8B fine-tuned: 5.50/10 (10 prompts)
27B raw:       5.96/10 (94 prompts) ← BASELINE
OpenCode:      5.57/10 (7 prompts)  ← worse than raw
V2 8-node:     6.53/10 (76 prompts, 24 timeouts, ~20min)
V3 9-node:     6.50/10 (9 prompts, 3 failures, ~25min)
V4 7-node:     killed (scope expansion)
V4.1 split:    12/12, 0 failures, ~5.5min, near-Codex visual quality
V4.2:          50/50, 0 failures, ~5.5min, + TY-08/LS-07/CD
V4.2C:         5/5 test + 55 running, expert persona + prompt-aware polish ← PRODUCTION
```

**The key insight**: the 27B model generates good creative output raw — it just needs
production polish. The split pipeline preserves raw creativity while the YAML work order
adds measurable quality items with accountability. Adding the expert persona and injecting
the original prompt into the polish step closes the remaining quality and factual gaps.

---

## Known Issues & Next Improvements

1. **Stochastic variation**: same prompt produces different output each run
2. **PI SkillCreator hangs**: kill pi manually after ~10min, script recovers
3. **Typography scale compression**: 27B uses smaller display text than Codex — TY-08 helps but conservative
4. **Polish is conservative**: adds ~3-5KB, could add more interactive states
5. **No layout quality check**: checklist catches measurable items but not subjective layout quality
6. **Prompt-order A/B**: not yet tested — current: prompt→work order→HTML. Alternative: work order→HTML→prompt (recency effect)
7. **Full 100-prompt run**: need to complete remaining 40 components after current 60
