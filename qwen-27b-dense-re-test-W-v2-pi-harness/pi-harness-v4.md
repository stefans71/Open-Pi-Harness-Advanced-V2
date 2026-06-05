# PI Harness V4.2 — Split Pipeline (Current Production)

**Branch**: `feat/dictionary-enhanced-harness`
**Status**: Running Condition M batch (50 components)
**Last updated**: 2026-06-05

---

## Architecture

Two completely separate sessions per component, orchestrated by Python (no YAML workflow engine):

```
┌─────────────────────────────────────────────────────────────────────┐
│                    V4.2 SPLIT PIPELINE                              │
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────────────┐  │
│  │  SESSION 1    │     │    BASH      │     │    SESSION 2       │  │
│  │  pi -p "..."  │────▶│  CHECKLIST   │────▶│  Direct API call   │  │
│  │              │     │  21 items    │     │  to llama-server   │  │
│  │  Raw generate │     │             │     │                    │  │
│  │  from prompt  │     │  Greps HTML  │     │  YAML work order   │  │
│  │  only (no     │     │  for missing │     │  + sign-off        │  │
│  │  dictionary)  │     │  production  │     │                    │  │
│  │              │     │  items       │     │  Reads raw HTML    │  │
│  │  Writes:     │     │             │     │  + fix list        │  │
│  │  index.html  │     │  Writes:    │     │  + dictionary      │  │
│  │              │     │  checklist   │     │                    │  │
│  │  ~2min       │     │  .md        │     │  Writes:           │  │
│  └──────────────┘     │  ~0s        │     │  polished HTML     │  │
│                       └──────────────┘     │  + sign-off.yaml   │  │
│                                            │  ~3min             │  │
│                                            └────────────────────┘  │
│                                                                     │
│  Total: ~5min per component, 2 LLM calls, 0 failures              │
└─────────────────────────────────────────────────────────────────────┘
```

### Data flow:
```
USER PROMPT
    │
    ▼
┌─────────────┐
│ RAW GENERATE │──▶ index.html (6-25KB)
│ pi -p "..."  │──▶ artifacts/raw-output.html (copy)
└─────────────┘
    │
    ▼
┌─────────────┐
│ CHECKLIST    │──▶ artifacts/checklist.md (21 items: PASS/MISSING)
│ Python grep  │──▶ missing_items list
└─────────────┘
    │ if missing items > 0
    ▼
┌─────────────┐
│ POLISH       │──▶ index.html (polished, +3-8KB)
│ Direct API   │──▶ artifacts/sign-off.yaml (fix confirmations)
│ + YAML work  │──▶ artifacts/rework-summary.md (before/after stats)
│   order      │
└─────────────┘
    │
    ▼
┌─────────────┐
│ OUTPUT       │──▶ harness-output.html (final)
│ Copy to      │──▶ condition-M-harness-v42/component-NNN-run0/
│ component dir│
└─────────────┘
```

**Key innovations over V2/V3:**
- No YAML workflow engine — Python orchestrates two independent processes
- No brief node — raw model generates directly from prompt (no fact corruption, no scope expansion)
- No dictionary in generation context — model builds creatively, dictionary only in polish
- YAML work order with sign-off — model confirms each fix applied
- Prompt-aware checklist — TY-08 display size only triggers for pricing/headline prompts
- Direct API for polish — bypasses PI tool-use limitations

## Harness Files — The Pipeline Itself

The V4.2 harness is NOT a YAML workflow. It's a Python script + dictionary + checklist:

```
pi-harness-stable/                              ← repo root
├── .pi/
│   └── ux-production-standards.md              ← THE DICTIONARY (62 rules, 11 categories)
│
└── qwen-27b-dense-re-test-W-v2-pi-harness/    ← benchmark test dir
    ├── run-v42m-split.py                       ← MAIN HARNESS SCRIPT (batch 1: 12 components)
    ├── run-v42m-batch2.py                      ← BATCH 2 SCRIPT (38 more components)
    ├── prompts/
    │   └── all-100-prompts.json                ← 100 component prompts
    ├── condition-M-harness-v42/                ← OUTPUT (50 components)
    │   ├── component-002-run0/
    │   │   ├── harness-output.html             ← final polished HTML
    │   │   └── artifacts/
    │   │       ├── raw-output.html             ← pre-polish raw
    │   │       ├── checklist.md                ← 21-item audit
    │   │       ├── sign-off.yaml               ← model fix confirmations
    │   │       └── rework-summary.md           ← before/after stats
    │   ├── component-003-run0/
    │   └── ... (50 total)
    ├── score-v3-harness.sh                     ← Codex GPT-5.4 scoring script
    ├── pi-harness-v4.md                        ← THIS DOCUMENT
    ├── pi-harness-v3.md                        ← V3 architecture doc
    ├── pi-harness-v2.md                        ← V2 architecture doc
    └── v3-harness-adaptions.md                 ← V3→V4 design analysis
```

The harness is entirely in `run-v42m-split.py` (~450 lines). It contains:
- `run_pi()` — launches `pi -p` for raw generation
- `call_llm_direct()` — calls llama-server API for polish
- `run_checklist()` — 21-item production audit (prompt-aware)
- `build_fixes_yaml()` — generates YAML work order from missing items
- `build_polish_prompt()` — embeds raw HTML + work order for polish
- `validate_output()` — checks output matches prompt (anti-contamination)
- `kill_everything()` — orphan protection

## All Output Folders — Where Data Lives

### On VPS (this machine)

| File | Path | Purpose |
|------|------|---------|
| **Batch script (M)** | `run-v42m-split.py` | Runs 12 test components to condition-M |
| **Batch script (M batch2)** | `run-v42m-batch2.py` | Runs 38 more components for 50 total |
| **Dictionary** | `.pi/ux-production-standards.md` (in pi-harness-stable root) | 62 rules, 11 categories |
| **V4.2 output** | `condition-M-harness-v42/component-NNN-run0/` | Current run output |
| **V4.1 output** | `condition-K-harness-v41/component-NNN-run0/` | Previous run (no TY-08/LS-07/CP-05) |
| **V4.2 L output** | `condition-L-harness-v42/component-NNN-run0/` | First V4.2 run (TY-08 too aggressive) |
| **V3 output** | `condition-I-harness-v3/component-NNN-run0/` | 9-node dictionary harness |
| **V2 output** | `condition-G-harness/component-NNN-run0/` | 8-node baseline harness |
| **V1 raw** | `/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/assets/components/component-NNN-run0/component.html` | Raw 27B baseline |
| **Codex improved** | Same path, `improved.html` | GPT-5.4 improved version |
| **V1 SQLite** | `/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/db/dataset.sqlite` | Baseline scores |
| **Prompts** | `prompts/all-100-prompts.json` | All 100 component prompts |
| **V2 scores** | `scores/harness-gpt54-scores.jsonl` | 76 GPT-5.4 scores |
| **V3 scores** | `scores/v3-dict-gpt54-scores.jsonl` | 9 GPT-5.4 scores |
| **Scoring script** | `score-v3-harness.sh` | GPT-5.4 scoring with factual accuracy |
| **Screenshot script** | `screenshot-v3.js` | Playwright 1280×900 fullPage |
| **Architecture docs** | `pi-harness-v2.md`, `pi-harness-v3.md`, `pi-harness-v4.md` | Evolution docs |
| **Adaptations analysis** | `v3-harness-adaptions.md` | V3→V4 design decisions |
| **Training data map** | `training-data-map.md` | Full data provenance |

### On AutoDL

| File | Path | Purpose |
|------|------|---------|
| **Batch scripts** | `/root/autodl-tmp/pi-harness-stable/run-v42m-split.py`, `run-v42m-batch2.py` | Running scripts |
| **Dictionary** | `/root/autodl-tmp/pi-harness-stable/.pi/ux-production-standards.md` | Must match VPS copy |
| **Output** | `/root/autodl-tmp/pi-harness-stable/condition-M-harness-v42/` | Rsync to VPS |
| **Prompts** | `/root/autodl-tmp/pi-harness-stable/prompts/all-100-prompts.json` | Prompt source |
| **Model** | `/root/autodl-tmp/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf` | 19GB Q5_K_XL |
| **llama-server** | `/root/autodl-tmp/llama-mtp/build-ada/bin/llama-server` | Built for Ada/sm_89 |
| **PI Agent** | `/root/autodl-tmp/node-v22.15.0-linux-x64/bin/pi` | v0.73.1 |
| **Logs** | `/tmp/v42m-split-log.txt`, `/tmp/v42m-batch2-log.txt` | Batch logs |

## AutoDL Instance

- **SSH**: `ssh -p 21340 root@connect.westb.seetacloud.com` (port changes on reboot — check dashboard)
- **GPU**: RTX 4090 48GB (cloud variant, doubled VRAM vs consumer 24GB)
- **llama-server**: `-m Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf --port 11434 -c 131072 -np 1 -ngl 99 -fa on`
- **VRAM**: ~28GB / 49GB used
- **models.json**: `/root/.pi/agent/models.json` — `contextWindow: 131072`, `maxTokens: 32768`
- **MTP**: Active (model file + binary both support it, ~90-100 tok/s)

### Restart llama-server after reboot:
```bash
nohup /root/autodl-tmp/llama-mtp/build-ada/bin/llama-server \
  -m /root/autodl-tmp/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf \
  --port 11434 -c 131072 -np 1 -ngl 99 -fa on \
  > /tmp/llama-server.log 2>&1 &
```
Wait ~30s for model load, verify: `curl http://localhost:11434/health`

## Orphan & Process Protection

The split pipeline has 3 layers of protection:

1. **`kill_everything()` at script startup** — kills ALL other python batch scripts and pi processes (except itself)
2. **`kill_stale_pi()` before each component** — kills any lingering pi process
3. **`os.setsid()` + `os.killpg()` on timeout** — kills entire process group if pi hangs

**Known issue**: PI's `SkillCreator` extension can hang for 5-10min after generating output (calling LLM for skill extraction). The index.html is already written but pi doesn't exit. Fix: manually `kill -9` the pi PID, script recovers and continues.

**Never run two batch scripts simultaneously** — they compete for the `-np 1` llama-server slot and contaminate each other's output directories.

## Dictionary — 62 Rules, 11 Categories

File: `.pi/ux-production-standards.md`

| Category | Code | Rules | Key thresholds |
|----------|------|:-----:|----------------|
| Spacing | SP | 6 | 8px grid, 48-64px section gaps, 24px min card padding |
| Typography | TY | 8 | Heading scale 1.25-2x, line-height 1.5x, **TY-08: display ≥ 48px (prompt-aware)** |
| Interactive States | IS | 7 | Hover on all clickable, focus-visible, 150-200ms transitions |
| Color & Contrast | CC | 5 | WCAG AA 4.5:1, max 3 accents |
| Visual Depth | VD | 5 | Consistent shadows, **VD-05: visible card elevation** |
| Animation | AM | 5 | Enter 200-300ms, reduced-motion, GPU-only properties |
| Layout | LS | 7 | Mobile-first, responsive, **LS-07: saturated CTA color** |
| Component Patterns | CP | 5 | Table, tabs, empty states, modal, **CP-05: pricing card flow** |
| Color Direction | CD | 4 | **Follow prompt colors**, no default AI purple, reference real design systems |
| Craft & Polish | CR | 10 | SVG icons, multi-layer shadows, hover lift, **CR-08: green checks**, **CR-09: glow 0.15-0.35** |

## Checklist — 21 Items (Prompt-Aware)

The checklist runs on the raw output and determines what the polish needs to fix:

```python
has_tokens          # var(-- count >= 20
has_hover           # :hover count >= 4
has_focus_visible   # focus-visible count >= 2
has_active          # :active with scale/darken/brightness
has_disabled        # :disabled with opacity/not-allowed
has_transitions     # transition count >= 3 with ease
has_reduced_motion  # prefers-reduced-motion present
has_responsive      # @media at 768px AND 1024px
has_svg_icons       # <svg count >= 2
has_aria            # aria- count >= 2
has_multi_shadow    # box-shadow count >= 3
has_hover_lift      # translateY in :hover context
has_letter_spacing  # letter-spacing present
has_word_break      # word-break or overflow present
has_display_size    # font-size >= 3rem (ONLY if prompt has price/headline keywords)
has_green_checks    # green color on checkmark SVGs (if checkmarks present)
has_clean_glow      # no 60px box-shadow at 0.5 opacity
has_solid_headings  # no -webkit-text-fill-color: transparent
has_price_flow      # no tagline between plan-name and price (if pricing component)
has_cta_saturated   # button background uses saturated color
has_visible_shadow  # box-shadow spread >= 8px
```

## YAML Work Order (Polish)

When the checklist finds missing items, it generates a YAML work order:

```yaml
fixes:
  - id: IS-01
    item: hover
    css_example: ":hover { }"
    instruction: "Add :hover with visible change + transition 150ms..."
    sign_off: false
  - id: CR-01
    item: svg_icons
    css_example: "<svg viewBox='0 0 24 24'>...</svg>"
    instruction: "Replace ALL emoji/text checkmarks with inline <svg>..."
    sign_off: false
```

The model applies each fix, outputs complete HTML + sign-off YAML confirming each item.

## Per-Component Output Structure

```
condition-M-harness-v42/
├── component-002-run0/
│   ├── harness-output.html          ← final polished HTML
│   └── artifacts/
│       ├── raw-output.html          ← pre-polish raw generate
│       ├── checklist.md             ← 21-item audit results
│       ├── rework-summary.md        ← polish before/after stats
│       ├── sign-off.yaml            ← model's fix confirmations
│       └── timing.json              ← per-session timing data (if present)
├── component-002-run0-harness-desktop.png  ← Playwright screenshot (1280×900)
└── ...
```

## Codex Scoring

### V1 Rubric (visual only — apples-to-apples with V1/V2 baseline):
```bash
codex exec -m gpt-5.4 --dangerously-bypass-approvals-and-sandbox --ephemeral \
  "You are a senior product designer reviewing a UI component screenshot. ..." \
  -i component-NNN-run0-harness-desktop.png
```
Script: `score-all-harness.sh` (original V1), `score-v3-harness.sh` (with factual accuracy)

### Factual Rubric (prompt-aware — checks prices, labels, colors):
Adds dimension 7: "Factual accuracy — does the output match the original prompt?"
If key value wrong (price, label), caps score at 6.

### Screenshot at 1280×900:
```javascript
await page.setViewportSize({width: 1280, height: 900});
await page.screenshot({path: png, fullPage: true});
```

## Running a Batch

### Deploy to AutoDL:
```bash
scp -P PORT run-v42m-split.py root@connect.westb.seetacloud.com:/root/autodl-tmp/pi-harness-stable/
scp -P PORT .pi/ux-production-standards.md root@connect.westb.seetacloud.com:/root/autodl-tmp/pi-harness-stable/.pi/
```

### Launch:
```bash
ssh -p PORT root@connect.westb.seetacloud.com
cd /root/autodl-tmp/pi-harness-stable
killall -9 python3 pi 2>/dev/null  # clean slate
nohup python3 -u run-v42m-split.py > /tmp/v42m-split-log.txt 2>&1 &
```

### Monitor:
```bash
grep "OK component" /tmp/v42m-split-log.txt | wc -l   # completion count
grep -E "(OK |Raw:|Checklist:|Sign-off:|Polished:)" /tmp/v42m-split-log.txt | tail -10
```

### Rsync to VPS:
```bash
rsync -avz -e "ssh -p PORT -o StrictHostKeyChecking=no" \
  root@connect.westb.seetacloud.com:/root/autodl-tmp/pi-harness-stable/condition-M-harness-v42/ \
  /root/tinkering/Local-LLMs/Local-LLM-Agent/pi-harness-stable/qwen-27b-dense-re-test-W-v2-pi-harness/condition-M-harness-v42/
```

## Performance

| Metric | V2 (8-node) | V3 (9-node) | V4.2 Split |
|--------|:-----------:|:-----------:|:----------:|
| Completion rate | 76% | 75% | **100%** |
| Avg time/component | ~20min | ~25min | **~5.5min** |
| LLM calls | 5 | 5 | **2** (raw + polish API) |
| Dictionary rules | 0 | 42 | **62** |
| Checklist items | 0 | 12 | **21** |
| Sign-off | No | No | **Yes (YAML)** |

## Known Issues & Next Improvements

1. **Stochastic variation**: same prompt produces different output each run. Some runs nail the design, others miss. The checklist catches measurable issues but can't catch layout quality or creative choices.

2. **PI SkillCreator hangs**: after generating output, pi sometimes hangs for 5-10min on skill creation. Kill pi manually — the output is already written.

3. **Glow opacity tuned**: CR-09 set to 0.15-0.35 range. Below 0.15 is invisible, above 0.35 bleeds through card face.

4. **TY-08 prompt-aware**: only triggers for prompts with price/headline/hero keywords. Prevents giant button text on non-display components.

5. **CP-05 pricing flow**: catches tagline-between-name-and-price but uses class name matching which can miss variants.

6. **Color direction**: CD rules steer away from AI purple but don't enforce prompt-specific colors (e.g. "subtle purple glow" in prompt may not appear if raw model doesn't add it).

7. **Typography scale compression**: 27B consistently uses smaller display text than Codex. TY-08 catches the worst cases but the overall scale remains more conservative.

8. **Polish is not prompt-aware**: the polish step sees raw HTML + YAML work order but NOT the original prompt. It can't verify prompt-specific requirements like "Pro column in blue" or "subtle purple glow." Next improvement: pass `$USER_MESSAGE` to the `build_polish_prompt()` function so the model can cross-check colors, labels, and layout instructions against the original prompt. This would catch stochastic deviations where the raw model ignores specific prompt instructions.

## Evolution Summary

```
V2:   brief → tokens → implement → review → rework (5 LLM, 20min, 76% completion)
V3:   + dictionary in implement/review (5 LLM, 25min, 75% completion)
V3.1: + scope check + factual passthrough (5 LLM, 11min, fixed $49 bug)
V4:   raw-first + dictionary in generate (3 LLM, 8min, scope expansion bug)
V4.1: split pipeline — raw pi + API polish + YAML sign-off (2 LLM, 5.5min, 100%)
V4.2: + TY-08 display, LS-07 CTA, CR-08 green, CP-05 flow, CD color (2 LLM, 5.5min, 100%)
```

The key insight: **the 27B model generates good creative output raw — it just needs production polish.** The split pipeline preserves raw creativity while the YAML work order adds measurable quality items with accountability.
