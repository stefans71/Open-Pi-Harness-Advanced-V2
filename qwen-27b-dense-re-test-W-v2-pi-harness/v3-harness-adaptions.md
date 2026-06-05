# V3 Harness — Proposed Adaptations (V4 Direction)

**Date**: 2026-06-04
**Status**: Analysis complete. Waiting on 12-prompt batch data to validate.

## The Core Finding

The V3 dictionary harness has two opposite effects depending on prompt complexity:

| Prompt Type | Example | Raw Score | V3 Score | Effect |
|-------------|---------|:---------:|:--------:|--------|
| **Simple/vague** (<100 words) | Component 002 — "pricing card" | 7.0 (6.5KB, single card) | TBD (45KB, full page with 3 tiers + comparison table + FAQ) | Harness **massively improves** |
| **Detailed mega-prompt** (>200 words, feature list) | Dashboard — 20 features listed | 7.0 (65KB, 12 canvas charts, 2130 JS lines) | 7.0 (70KB, 0 canvas charts, 120 JS lines) | Harness **strips ambition** |

Same score, completely different stories. On the simple prompt, V3 turned a single card into a complete pricing page. On the detailed prompt, V3 built a standards-compliant skeleton while raw built a feature-rich dashboard with animated charts.

## Root Cause 0: Data Fidelity Loss in the Brief Node

The brief node **rewrites** the user's prompt into a design document. During this rewrite, specific factual values can be corrupted:

- Component 002 prompt says `$49/month` → V3 brief wrote `$9/month` → implement built $9
- V2 harness got $49 correct on the same prompt (stochastic, not systematic)
- V1 raw got $49 correct (no brief node to corrupt it)

This is a hallucination during the brief's "User Request Summary" section. The brief also expanded the single-card prompt into a 3-tier page (Pro $9, Free $0, Enterprise Custom) — creative but factually wrong on the price.

**Fix**: The brief node should include a "FACTUAL PASSTHROUGH" section that copies exact values from the original prompt verbatim: prices, dimensions, specific counts, named features. The brief can add design interpretation, but must not rewrite hard facts. Alternatively, the implement node should read the original `$USER_MESSAGE` alongside the brief, so it can cross-check facts.

## Root Cause 1: Compliance vs. Ambition Trade-off

When the implement node reads 3 documents (brief + tokens + 42-rule dictionary), it optimizes for **passing the review** rather than **building impressive output**. This manifests as:

1. **Token budget displacement**: The model spends its output tokens writing standards-compliant CSS (reduced-motion, focus-visible, ARIA, proper spacing tokens) instead of building features (canvas charts, animations, interactive elements)
2. **Fear of review**: The model knows it will be checked against measurable standards, so it avoids anything that might fail (complex animations → AM-05, varied radii → VD-04)
3. **No feature completeness check**: The review validates 42 standards rules but never asks "did you build what was requested?"

On simple prompts this trade-off is net positive — the brief fills the intent gap and the standards raise quality. On detailed prompts, the model already knows what to build and the constraints are pure overhead.

## Evidence

### Component 002 — "Design a pricing card" (simple prompt)

4-way comparison shows the harness progression:

| Version | Size | What it built |
|---------|------|---------------|
| V1 Raw (27B, no harness) | 6.5KB | Single pricing card, 5 features, minimal |
| Codex 4.5 improved | 7KB | Same card, slightly cleaner typography |
| V2 Harness (8 nodes) | 18KB | Better single card — richer copy, billing info, trial CTA |
| **V3 Dict Harness (9 nodes)** | **45KB** | **Full pricing page** — 3 tiers, feature comparison table, tabbed FAQ, footer |

Screenshots: `youtube-test/ab-test/c002-v1-raw.png`, `c002-codex-improved.png`, `c002-v2-harness.png`, `c002-v3-dict.png`

V3's brief node thought about the domain: "who visits a pricing page? They need to compare plans. They have questions." The implement node built a complete page, not just a card. **This is the harness working as designed — filling the intent gap.**

### Features-Only Dashboard — 20 features listed (detailed prompt)

| Version | Size | JS Lines | Canvas Charts | Animations |
|---------|------|:--------:|:-------------:|:----------:|
| Raw Q5 | 65KB | 2,130 | 12 | 9 |
| V2 Harness | 94KB | — | — | — |
| V3 Dict | 70KB | 120 | 0 | 0 |

Scores (V1 benchmark rubric via GPT-5.4):
- Raw: 7.0/10
- V2: 6.5/10 (harness hurts)
- V3: 7.0/10 (dictionary recovers to tie raw)

The raw output has animated GPU meters, radar charts, line charts, bar charts in each tab. V3 has proper ARIA and standards-compliant spacing but flat text and tables. **The V1 rubric can't see interactivity from a single screenshot, so they scored equally — but the raw output is clearly richer as a product.**

Scores: `youtube-test/ab-test/ab-scores-v1rubric.jsonl`
Screenshots: `youtube-test/ab-test/raw-desktop.png`, `v3-dict-desktop.png`

### 100-Prompt V2 Benchmark — Difficulty Stratification

| Prompt Difficulty | V2 Harness Delta vs V1 Raw | Win Rate |
|-------------------|:--------------------------:|:--------:|
| Hard (V1 ≤ 5.0) | **+1.36** | 89% |
| Medium (V1 5.5–6.0) | +0.52 | 74% |
| Easy (V1 ≥ 6.5) | +0.08 | 42% |

Data: `scores/difficulty-analysis.json`, `scores/v1-vs-harness-comparison.jsonl`
Full analysis: `pi-harness-v2.md` (section: "Why It Helps Hard Prompts but Hurts Easy Ones")

## Proposed Adaptations

### Adaptation 0: Factual Passthrough in Brief Node

The brief node rewrites the user's prompt and can hallucinate specific values. Component 002: `$49/month` became `$9/month` in the brief. Fix options:

**Option A — Passthrough block**: Add to the brief node prompt: "Before writing the brief, copy ALL specific values from the user's request verbatim into a FACTUAL REQUIREMENTS section: prices, dimensions, counts, named features, exact text. Your brief must not contradict these."

**Option B — Dual-read in implement**: The implement node reads both `brief.md` AND the original `$USER_MESSAGE`. The brief provides design direction; the original prompt is the source of truth for facts. Add: "If the brief and user request conflict on a specific value (price, count, name), trust the user request."

**Option C — Validation gate**: A bash node after brief that greps the original prompt for prices/numbers and checks they appear in brief.md. Flag mismatches before implement runs.

Option B is simplest and most robust — it doesn't require the brief to be perfect, just the implement to cross-check.

### Adaptation 1: Prompt Complexity Detection (Adaptive Pipeline)

Add a lightweight classifier (bash or single LLM call) as node 0 that categorizes the prompt:

**Mode A — Full Pipeline** (simple/vague prompts, <100 words, no feature list):
```
brief → tokens → implement → verify → dict-lint → review → gate → rework → verify-rework
```
Current V3 pipeline. The brief fills the gap. Dictionary constrains from the start. This is where V3 shines — component 002 went from 6.5KB single card to 45KB full page.

**Mode B — Raw-First Pipeline** (detailed prompts, >200 words OR lists 5+ specific features):
```
implement-raw → verify → dict-lint → review → gate → rework-polish → verify-rework
```
Skip brief and tokens. Let the raw model build everything first (preserving its natural ambition). Then apply dictionary review and rework as a polishing pass, not a creative constraint.

Trigger signals for Mode B:
- Word count > 200
- Contains numbered/bulleted feature list (5+ items)
- Contains specific keywords: "dashboard", "command center", "admin panel", "data visualization"
- Contains styling instructions: "glassmorphism", specific colors, named sections

### Adaptation 2: Draft-Then-Polish Implement (Alternative to Mode B)

Instead of skipping the brief entirely, split implement into two nodes:

**implement-draft** (reads brief + tokens, NO dictionary):
> "Build the most feature-complete, visually ambitious implementation possible. Prioritize every feature in the brief. Include canvas charts, animations, interactive elements. Don't hold back — build everything."

**implement-polish** (reads dictionary + draft output):
> "Apply UX production standards to the existing implementation. Fix spacing, add ARIA, add focus-visible, fix token usage. Do NOT remove features, simplify charts, or reduce interactivity."

This separates creative generation from compliance. The model builds ambitiously first (like raw does), then the dictionary constrains only the surface-level quality.

### Adaptation 3: Feature Completeness Gate (New Review Dimension)

Add a 9th category to the structured review:

```
## FEATURE COMPLETENESS (FC)
- FC-01: Does the implementation include ALL features described in the brief/prompt?
- FC-02: Are interactive elements (charts, animations, expandable sections) actually functional?
- FC-03: Does each tab/section have meaningful, distinct content (not placeholder text)?
- FC-04: Is JS complexity proportional to the feature set? (>500 lines expected for 10+ features)
```

Currently the review checks 42 rules but never asks "did you build what was requested?" A standards-compliant skeleton that's missing 12 features gets APPROVE. This gate prevents that.

### Adaptation 4: Rework Should ADD, Not Just FIX

Current rework prompt: "Fix FAIL items IN THIS ORDER"
Proposed addition: "Fix FAIL items AND implement any features marked FC-FAIL. For missing features, build them to the same standard as existing features."

### Adaptation 5: Domain-Specific Dictionaries

Instead of one universal 42-rule dictionary, route to specialized versions:

| Prompt Domain | Dictionary Focus | Key Additions |
|---------------|-----------------|---------------|
| Dashboard/data-viz | Charts, data density, tab content | Canvas chart standards, animation budgets, data realism |
| Landing page/marketing | Hero sections, CTAs, social proof | Conversion patterns, scroll narrative, trust signals |
| Form/CRUD | Input validation, error states, flow | Form accessibility, field grouping, progressive disclosure |
| Component (card, modal, etc.) | Single-element polish | Edge cases, state coverage, responsive behavior |

This prevents the dashboard from being reviewed against card-padding rules that don't matter for data-dense screens, while ensuring a pricing card gets the spacing/typography polish it needs.

### Adaptation 6: Scope Preservation in Brief Node

The brief node always EXPANDS. Component 002: user asked for "a pricing card" → V3 built a full page with 3 tiers, comparison table, and FAQ. Impressive for a benchmark, but wrong if the user wanted exactly one card.

Three distinct prompt intents:
- **"Build me a page"** → brief should expand (add sections, navigation, flow)
- **"Build me a component"** → brief should enrich but NOT expand scope (better design, tokens, polish — still one component)
- **"Build me exactly this"** → brief should passthrough (preserve scope, add only design direction)

**Fix**: Add a SCOPE CHECK to the brief node prompt:

```
SCOPE CHECK — Before writing the brief, determine the scope:
  - If the user asked for a SINGLE COMPONENT (card, button, modal, nav bar):
    Design that ONE component. Do not expand into a full page.
    Do not add sibling components (e.g. don't add Free/Enterprise tiers when asked for one Pro card).
  - If the user asked for a PAGE or DASHBOARD:
    Full page design is appropriate.
  - If the user specified exact values (prices, labels, counts):
    Use those values exactly. Do not change $49 to $9.

State your scope decision at the top of the brief: "SCOPE: single component" or "SCOPE: full page"
```

This prevents the brief from turning "pricing card for $49" into a 3-tier comparison page, while still allowing it to enrich "build me a dashboard" into a full design spec.

**Evidence**: Component 002 prompt says "Design a pricing card" (singular). V3 built a 45KB page with 3 plans, comparison table, FAQ, footer. V1 raw correctly built one card (6.5KB). V2 harness correctly built one card (18KB). V3's brief decided "a pricing page needs comparison" — creative but wrong for the scope.

### Adaptation 7: MTP Speed — Already Active, Not the Bottleneck

The AutoDL server already runs `Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf` with the `llama-mtp` binary. MTP is active — tok/s is ~90-100 (not 50 as previously reported). The 20-35min runtime per component is NOT a speed issue — it's the cost of 5 sequential LLM calls (brief → tokens → implement → review → rework), each generating ~15-25K tokens.

Speed improvements must come from pipeline structure, not model speed:
- Fewer nodes (merge brief+tokens, skip review if implement quality is high)
- Parallel nodes (brief and tokens could theoretically run in parallel)
- Shorter prompts to review/rework (less context = faster generation)
- Skip rework when review score ≥ 8 (already implemented but rarely triggers)

## Scoring Rubric Problem (CRITICAL — discovered during V3 scoring)

The V1 benchmark rubric scores from a **single static screenshot**. It can't see:
- Scroll depth (V3 003 is a full scrolling page — scored 6.5 same as a flat card)
- Tab content (V3 builds working tabbed interfaces — invisible in screenshot)
- Animations/transitions
- Interactive states (hover, expand, sort)

**Result**: V3 scores 6.50/10 (V1 rubric) vs V2's 6.53 — essentially tied. But visual inspection shows V3 output is dramatically richer. The rubric is the bottleneck, not the harness.

**Factual accuracy scoring attempt**: We built a 7-dimension rubric adding original prompt comparison + hard cap at 6 for wrong values. This was too aggressive — capped every score because the brief node's creative expansion (adding tiers, expanding scope) counted as "factual mismatch." Scored 4.22/10. Saved in `scores/v3-dict-gpt54-scores-factual.jsonl` for reference.

**Recommendation**: Keep V1 rubric for apples-to-apples baseline comparison. Add a separate "feature richness" metric that evaluates from the HTML source (JS lines, canvas elements, section count, token usage) rather than screenshots.

## What We're Waiting On (Updated 2026-06-05)

### 12-Prompt Batch (COMPLETE — 9/12 succeeded)

9 components completed, 3 missing (027 no artifact, 040 timeout x2, 044 timeout):
- **V3 avg: 6.50/10** (V1 rubric, N=9)
- V1 raw baseline: 5.96 → **V3 delta: +0.54**
- V2 harness baseline: 6.53 → **V3 delta: -0.03** (tied)
- **059 FIXED**: V2 scored 5.0 (truncation), V3 scores 7.0 — structured review prevented rework collapse
- **043 FIXED**: V2 scored 3.0, V3 scores 6.5 — biggest single improvement
- V3 scores: `scores/v3-dict-gpt54-scores.jsonl`
- Factual accuracy scores (separate rubric): `scores/v3-dict-gpt54-scores-factual.jsonl`

### Still Missing: 027, 040, 044

027: `clean_stale_artifacts()` removed everything, pi found no artifact dir. Bug in rerun script.
040: Timed out at both 25min and 35min. Prompt may generate very long rework.
044: Timed out at 35min. Same pattern as 040.
These 3 need a 45min+ timeout or investigation into what makes them slow.

### Decision Criteria

- If V3 beats V2 on hard prompts AND ties/beats on easy prompts → V3 is the winner, adaptations are optimization
- If V3 beats V2 on hard but loses on easy (like mega-prompt) → adaptive pipeline is necessary
- If V3 loses on hard prompts → something else is wrong, dictionary may be net negative

## Reference Documents

| Document | Path | What it contains |
|----------|------|-----------------|
| V2 architecture explainer | `pi-harness-v2.md` | 8-node pipeline, fresh context rationale, difficulty stratification |
| V3 architecture explainer | `pi-harness-v3.md` | 4 dictionary changes, 42-rule overview, test plan |
| V3 workflow YAML | `.pi/workflows/web-design-benchmark-dict.yaml` (relative to `pi-harness-stable/`) | 9-node workflow definition |
| UX production standards | `.pi/ux-production-standards.md` (relative to `pi-harness-stable/`) | 42 rules, 8 categories |
| V2 workflow YAML | `.pi/workflows/web-design-benchmark.yaml` (relative to `pi-harness-stable/`) | 8-node baseline workflow |
| Training data map | `training-data-map.md` | Full data provenance, scoring methodology, file paths |
| 100-prompt V2 results | `scores/v1-vs-harness-comparison.jsonl` | Paired V1 vs V2 scores with deltas |
| Difficulty analysis | `scores/difficulty-analysis.json` | Per-prompt difficulty + type + delta |
| Regression analysis | `scores/regression-analysis.md` | 4 V2 regression failure modes |
| Features-only A/B scores | `youtube-test/ab-test/ab-scores-v1rubric.jsonl` | Raw 7.0, V2 6.5, V3 7.0 (V1 rubric) |
| YouTuber head-to-head | `youtube-test/comparison.md` | Full 3-condition comparison with scores |
| Component 002 screenshots | `youtube-test/ab-test/c002-*.png` | 4-way visual comparison (raw, codex, V2, V3) |
| V3 batch plan | `v3-batch-run-plan.md` | 12-prompt batch execution plan + resume checklist |
| V3 batch script | `run-v3-batch.py` | Python script running on AutoDL |
| V1 raw components | `/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/assets/components/` | component-NNN-run0/component.html |
| V1 improved components | Same path | component-NNN-run0/improved.html (Codex 4.5) |
| V1 SQLite DB | `/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/db/dataset.sqlite` | Baseline scores in critique_text |
| V2 harness output | `condition-G-harness/` | 76 component subdirs with harness-output.html |
| V3 harness output | `condition-I-harness-v3/` | 12 component subdirs (batch in progress) |
| V2 scores | `scores/harness-gpt54-scores.jsonl` | 76 GPT-5.4 scores |
| V3 scores | `scores/v3-dict-gpt54-scores.jsonl` | (to be created after batch) |
