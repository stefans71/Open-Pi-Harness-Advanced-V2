# PI Harness V3 — Dictionary-Enhanced Workflow

**Branch**: `feat/dictionary-enhanced-harness`
**Workflow**: `.pi/workflows/web-design-benchmark-dict.yaml` (9 nodes)
**Dictionary**: `.pi/ux-production-standards.md` (42 rules, 8 categories)

## What's Different from V2

V2 (the original 8-node `web-design-benchmark.yaml`) uses a free-form "hostile senior engineer" review that produces 15-25KB of unstructured critique. The rework node then tries to fix everything at once. This causes two failure modes:

1. **Review overload** (component 059): 276-line review → rework attempts full rewrite → exceeds max_tokens → output truncated mid-HTML. Score dropped from 7.0 to 5.0.
2. **Polish degradation** (YouTuber test): Rework applies fixes inconsistently — partially replaced tokens, styles that don't propagate. GPT-5.4 scored polish at 6/10 vs 8/10 for raw output.

V3 makes 4 changes to address these:

### Change 1: Implement reads the dictionary

The implement node now reads `.pi/ux-production-standards.md` before building. The model knows the measurable standards upfront — spacing grid, heading scale ratios, transition timing, ARIA patterns — and builds to them from the start rather than discovering violations later.

**Why this helps**: In V2, the model makes arbitrary design decisions during implement (random spacing, mixed font units, no reduced-motion). The review finds 30 violations. The rework fixes them badly. In V3, the model builds correctly the first time, so review finds fewer issues and rework is lighter.

### Change 2: Automated dictionary lint (new bash node)

A new `dict-lint` bash node runs 12 automated checks between verify and review:
- SP-04: 8px grid compliance (grep for off-grid px values)
- CC-01: Hardcoded hex outside :root (count violations)
- IS-01/02: Hover and focus-visible state counts
- IS-05: CSS transition presence
- AM-03: Reduced motion media query
- LS-04: Responsive breakpoint count
- CP-02: Tab ARIA (tablist + tabpanel)
- VD-04: Border-radius consistency
- Token density (var() reference count)

**Why this helps**: Catches measurable violations in 2 seconds without an LLM call. The review node reads these findings and doesn't need to re-discover them.

### Change 3: Structured review by rule ID

Instead of "be hostile, find everything wrong," the review checks each dictionary category systematically:

```
## SPACING
- SP-01 Section Gap: PASS | Sections use var(--space-12) = 48px ✓
- SP-02 Card Padding: FAIL | `.stat-card { padding: 8px }` → min 24px

## TYPOGRAPHY
- TY-01 Heading Scale: PASS | H1=36px, H2=28px, ratio 1.29 ✓
...
```

Every finding cites a rule ID and a CSS selector. No free-form essays. No 276-line reviews.

**Why this helps**: Bounded output. The review can't spiral into an unbounded critique because it's walking a finite checklist (42 rules). The rework node gets specific, actionable items with rule IDs, not paragraphs of opinion.

### Change 4: Ordered rework in 4 passes

Instead of fixing everything at once, rework applies fixes in dependency order:

1. **Pass 1 — Spacing & Layout** (SP-*, LS-*): Structural foundation. Section gaps, card padding, grid, breakpoints.
2. **Pass 2 — Typography** (TY-*): Heading scale, line-heights, weights. After layout so text reflows correctly.
3. **Pass 3 — Interactive States & Animation** (IS-*, AM-*): Hover, focus, active, disabled, transitions, reduced-motion. Additive — doesn't move elements.
4. **Pass 4 — Color & Visual Depth** (CC-*, VD-*): Token replacement, contrast, shadows, radii. Last so you're not repainting things that moved in pass 1.

**Why this helps**: In V2, fixing a spacing issue and a color issue simultaneously can conflict — you move an element then change its color, but the color was already correct at the old position. Ordered passes prevent cascading rework errors.

## The 42 Rules (8 Categories)

| Category | Code | Rules | Key thresholds |
|----------|------|:-----:|----------------|
| Spacing | SP | 6 | 8px grid, 48-64px section gaps, 24px min card padding |
| Typography | TY | 7 | 1.25-2x heading scale, 1.5x line-height, 75ch max width |
| Interactive States | IS | 7 | Hover on all clickable, focus-visible, 150-200ms transitions |
| Color & Contrast | CC | 5 | 4.5:1 WCAG AA, max 3 accents, color+meaning pairing |
| Visual Depth | VD | 4 | Consistent shadows, consistent radii, glassmorphism rules |
| Animation | AM | 5 | Enter 200-300ms, exit 150-200ms, prefers-reduced-motion |
| Layout | LS | 6 | Squint test, mobile-first 375px, above-fold impact |
| Component Patterns | CP | 4 | Table readability, tab ARIA, empty states, modal pattern |

## Test Plan

**12 prompts** — the 10 validation prompts + 2 extra hard cases:

| ID | V1 Raw | V2 Harness | V2 Delta | Difficulty | Why included |
|----|:------:|:----------:|:--------:|:----------:|-------------|
| 002 | 7.0 | 7 | +0.0 | EASY | Validation set — baseline tie |
| 003 | 4.0 | 7 | +3.0 | HARD | Validation — harness big win |
| 008 | 5.0 | 7 | +2.0 | HARD | Validation — harness big win |
| 010 | 6.0 | 6.5 | +0.5 | MED | Validation — moderate improvement |
| 015 | 6.5 | 7 | +0.5 | EASY | Validation — moderate improvement |
| 027 | 4.0 | 5 | +1.0 | HARD | Extra — V2 improved but still low |
| 035 | 6.0 | 6 | +0.0 | MED | Validation — tie, room to improve |
| 040 | — | 5 | — | N/A | Extra — V2 scored low, no V1 baseline |
| 043 | 5.0 | 3 | -2.0 | HARD | Validation — V2 regression (screenshot bug) |
| 044 | 7.0 | 7 | +0.0 | EASY | Validation — tie |
| 052 | 6.5 | 7 | +0.5 | EASY | Validation — moderate improvement |
| 059 | 7.0 | 5 | -2.0 | EASY | Validation — V2 regression (truncation) |

**Hypothesis**: V3 dictionary harness should:
- Fix 059 regression (structured review prevents overload → no truncation)
- Fix 043 regression (if screenshot bug, same result; if real, dictionary catches it)
- Improve polish on easy prompts (V2 scored 6/10 polish on YouTuber test)
- Maintain V2's advantage on hard prompts (+1.36 avg)
- Beat V2 on medium prompts (structured review catches what free-form misses)

**Also testing**: Features-only version of YouTuber mega-prompt (Condition I/G/G-dict 3-way A/B).

## Node Flow Comparison

```
V2 (8 nodes):
brief → tokens → implement → verify → review → gate → rework → verify-rework

V3 (9 nodes):
brief → tokens → implement* → verify → dict-lint* → review* → gate → rework* → verify-rework
                 ↑ reads dictionary      ↑ new bash     ↑ structured    ↑ 4 ordered passes
```

## Files

- **Workflow**: `.pi/workflows/web-design-benchmark-dict.yaml`
- **Dictionary**: `.pi/ux-production-standards.md`
- **Existing UX dict** (framework-specific, for 24-node workflow): `.pi/ux-dictionary.md`
- **V2 explainer**: `pi-harness-v2.md`
- **Features-only prompt**: `youtube-test/features-only-prompt.txt`
- **Validation prompt IDs**: `scores/validation-10-ids.json` + [027, 040]

## Known Issues to Watch

1. **Token budget**: V3 implement reads 3 files (brief + tokens + dictionary) vs V2's 2. The dictionary is ~4KB. Should be fine within 131K context but monitor.
2. **Dict-lint false positives**: The bash grep for off-grid px values will flag things like `375px` (viewport width) and `1080px` (breakpoint). Current regex excludes common values but may need tuning.
3. **--space-0.5 bug**: The tokens node template generates `--space-0.5` which is invalid CSS (dots not allowed in custom properties). Need to fix to `--space-half` or `--space-05`.
4. **Rework token limit**: If review still produces many FAIL items, 4-pass rework could exceed max_tokens. The ordered approach should mitigate by keeping each pass focused, but monitor 059 specifically.
