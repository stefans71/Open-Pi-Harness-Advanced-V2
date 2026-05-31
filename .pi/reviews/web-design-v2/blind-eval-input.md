# Blind Evaluation — Web-Design Workflow v2: Calibration + PRD Pipeline

## Task Description

A YAML workflow engine executes multi-step workflows for a local LLM coding agent. Each workflow consists of typed nodes (prompt, bash, approval) executed sequentially. The executor has a `resolveVariables()` method that substitutes `$VARIABLE` placeholders in all node fields before execution. Prompt nodes are **single-turn**: the model generates one response with tool calls, then the node completes — it cannot ask questions and wait for answers.

The task: upgrade an existing 14-node web-design workflow to 23 nodes by adding:
1. A **user calibration pipeline** (5 nodes) that detects or creates a user preference profile, lets the user review/adjust it via an approval gate, and persists it to disk for future runs.
2. A **PRD + planning pipeline** (4 nodes) that transforms design artifacts into a structured Product Requirements Document and step-by-step implementation plan with verification commands.
3. **Profile-aware adaptations** to 7 existing nodes so they adjust communication depth, CSS approach, and review style based on the user's saved preferences.

**Specification:**

### User Profile Schema

Stored at `~/.pi/user-profile.json` (global). Project-level override at `.pi/user-profile.json` takes precedence.

```json
{
  "version": 1,
  "updated_at": "ISO timestamp",
  "experience": {
    "frontend_level": 1-10,
    "design_background": "designer" | "know_what_i_want" | "just_build_it"
  },
  "preferences": {
    "tech_stack": "react_tailwind" | "vue" | "svelte" | "vanilla" | "you_decide",
    "css_approach": "tailwind" | "css_modules" | "styled_components" | "vanilla_css" | "you_decide",
    "design_tools": "figma" | "canva" | "none",
    "communication_style": "show_options" | "just_build_it" | "explain_decisions"
  },
  "adaptive": {
    "you_decide_count": integer,
    "auto_decide_technical": boolean
  }
}
```

### Calibration Pipeline Requirements

1. `read-profile` (bash): Load existing profile from disk. Project-local first, global fallback. Must write a sentinel `{"exists": false}` FIRST so the next node always has valid input even if the read fails. `allow_failure: true`.

2. `calibrate` (prompt): Single-turn node. Reads the existing profile (or sentinel). If first run: infer preferences from `$USER_MESSAGE`, write a draft profile to `$ARTIFACTS_DIR/draft-profile.json`, present a readable summary. If profile exists: copy it to draft, present summary. Must have `expected_artifacts` for draft-profile.json.

3. `gate-calibrate` (approval): User reviews draft. `on_reject: continue` with `capture_response: true` so rejection text flows as `$REJECTION_REASON` to the next node.

4. `refine-profile` (prompt): Reads `$REJECTION_REASON`. Three paths:
   - Empty/approved: copy draft to `$ARTIFACTS_DIR/user-profile.json` unchanged
   - Specific changes: parse and apply, update timestamp
   - "Start fresh": write defaults with `auto_decide_technical: true`
   Must have `expected_artifacts` for user-profile.json.

5. `save-profile` (bash): Copy `$ARTIFACTS_DIR/user-profile.json` to `~/.pi/user-profile.json`. Also update `.pi/user-profile.json` if a project-level file already exists. `allow_failure: true`.

### PRD + Planning Pipeline Requirements

6. `prd` (prompt): `fresh_context: true`. Reads HANDOFF, user-profile, brief, design-tokens, components. Explores existing codebase. Writes `$ARTIFACTS_DIR/prd.md` with sections: Goal, Tech Stack, Requirements, Files to Create, Files to Modify, Dependencies, Acceptance Criteria. Must have `expected_artifacts`.

7. `gate-prd` (approval): User reviews PRD. `on_reject: cancel`.

8. `plan` (prompt): `fresh_context: true`. Reads PRD, user-profile, components, design-tokens, tokens.css. Writes `$ARTIFACTS_DIR/plan.md` as ordered steps with: File, Change, Verify (concrete command), Est. tool calls, Files to read first. Must have `expected_artifacts`.

9. `estimate` (bash): Context budget check. `allow_failure: true`, `timeout: 30000`. Uses `$MODEL_CONTEXT` as inline substitution (NOT `process.env.MODEL_CONTEXT`). Uses `$ARTIFACTS_DIR` as inline substitution (NOT `process.env.ARTIFACTS_DIR`). Writes `context-estimate.md` if all goes well.

### Modified Node Requirements

10. `brief`: Add reading of `$ARTIFACTS_DIR/user-profile.json`. Add COMMUNICATION ADAPTATION block that adapts explanation depth based on `frontend_level`, `design_background`, and `communication_style`.

11. `tokens`: Add reading of `$ARTIFACTS_DIR/user-profile.json`. Replace unconditional "use Tailwind v4 @theme syntax" with profile-conditional CSS approach:
    - tailwind/you_decide → @theme syntax
    - css_modules → :root custom properties with module-scoped imports
    - vanilla_css → :root custom properties with fallbacks
    - styled_components → ThemeProvider with JS theme object

12. `inventory`: Add reading of `$ARTIFACTS_DIR/user-profile.json`. Add design_tools adaptation (figma: reference Figma conventions; none: be more prescriptive with dimensions).

13. `gate-plan`: Update message from "begin implementation" to "proceed to PRD generation" (since PRD now comes after gate-plan).

14. `implement`: Add reading of plan.md, context-estimate.md (optional — skip if missing), prd.md, user-profile.json. Add `$ARTIFACTS_DIR/implement-log.md` to `expected_artifacts`. Execute steps from plan.md with per-step logging.

15. `review`: Add reading of user-profile.json, prd.md, plan.md, implement-log.md. Add USER ADAPTATION block (frontend_level-based review communication). Add ACCEPTANCE CRITERIA CHECK (verify each criterion from prd.md).

16. `rework`: Add reading of `$ARTIFACTS_DIR/user-profile.json`. Add USER ADAPTATION block (frontend_level 1-3: explain fixes; 7-10: just fix and list).

### Engine Constraints

- Variable substitution: `$USER_MESSAGE`, `$ARTIFACTS_DIR`, `$REJECTION_REASON`, `$MODEL_ID`, `$MODEL_NAME`, `$MODEL_SIZE`, `$MODEL_CONTEXT`, `$MODEL_VISION` are text-replaced in ALL node fields before execution
- `$REJECTION_REASON` is set by approval nodes with `on_reject: continue` and contains the user's rejection text (empty string if approved)
- `fresh_context: true` opens a new LLM session — the model loses all memory and must read from disk
- `expected_artifacts` checks file existence after node completion; retries once if missing
- `allow_failure: true` on bash nodes means workflow continues on non-zero exit
- Valid `on_reject` values: `cancel` (stop workflow), `rollback` (git stash), `continue` (proceed with $REJECTION_REASON)
- Valid node types: `prompt`, `bash`, `approval`, `loop`, `cancel`

---

## Implementation

### File: `.pi/workflows/web-design.yaml` (MODIFIED — 443 → 810 lines)

```yaml
name: web-design
description: |
  Design-first frontend workflow with user calibration + PRD pipeline.
  Phase 0: scaffold, read-profile, calibrate, gate-calibrate, refine-profile, save-profile.
  Phase 1: brief, gate-brief.
  Phase 2: tokens, inventory, gate-plan.
  Phase 3: prd, gate-prd, plan, estimate.
  Phase 4: implement, verify.
  Phase 5: review, gate-final, rework, verify-rework, gate-rework.
  Phase 6: persist-handoff.
  23 nodes total. Each fresh_context node reads inputs from disk (ARTIFACTS_DIR + HANDOFF.md).

nodes:

  # ── Phase 0 — Setup + Calibration ──────────────────────────────────

  - id: scaffold
    type: bash
    allow_failure: true
    timeout: 300000
    command: bash .pi/scaffold.sh

  - id: read-profile
    type: bash
    allow_failure: true
    command: |
      # Write sentinel FIRST so calibrate always has input
      echo '{"exists": false}' > "$ARTIFACTS_DIR/existing-profile.json"

      PROFILE_PATH=""
      if [ -f ".pi/user-profile.json" ]; then
        PROFILE_PATH=".pi/user-profile.json"
        echo "Found project-level profile"
      elif [ -f "$HOME/.pi/user-profile.json" ]; then
        PROFILE_PATH="$HOME/.pi/user-profile.json"
        echo "Found global profile"
      fi

      if [ -n "$PROFILE_PATH" ]; then
        if cp "$PROFILE_PATH" "$ARTIFACTS_DIR/existing-profile.json" 2>/dev/null; then
          echo "Profile loaded from $PROFILE_PATH"
        else
          echo "Failed to read profile - using first-run mode"
        fi
      else
        echo "No existing profile - first run calibration"
      fi

  - id: calibrate
    type: prompt
    allowed_tools: [read, write]
    expected_artifacts:
      - $ARTIFACTS_DIR/draft-profile.json
    prompt: |
      You are in the USER CALIBRATION phase. This is a single-turn node — you
      cannot ask questions interactively. Instead, read context and write a draft
      profile for the user to review at the next gate.

      Read $ARTIFACTS_DIR/existing-profile.json and note the user's request: $USER_MESSAGE

      IF the file contains {"exists": false} — FIRST RUN:
        Infer preferences from $USER_MESSAGE context where possible.
        For anything you cannot infer, use these defaults:
          - frontend_level: 5 (intermediate)
          - design_background: "know_what_i_want"
          - tech_stack: "react_tailwind"
          - css_approach: "tailwind"
          - design_tools: "none"
          - communication_style: "explain_decisions"

        Write $ARTIFACTS_DIR/draft-profile.json with the full schema:
          {
            "version": 1,
            "updated_at": "<ISO timestamp>",
            "experience": { "frontend_level": N, "design_background": "..." },
            "preferences": { "tech_stack": "...", "css_approach": "...", "design_tools": "...", "communication_style": "..." },
            "adaptive": { "you_decide_count": 0, "auto_decide_technical": false }
          }

        In your chat response, present the draft as a readable summary:
          "Here's your draft profile based on what I can infer:
           - Frontend level: [N]/10 — [why you chose this]
           - Design background: [value]
           - Tech stack: [value]
           - CSS: [value]
           - Design tools: [value]
           - Communication: [value]

          Review at the next gate. Approve if correct, or reject with your
          preferred values (e.g., 'frontend_level: 8, tech_stack: vue')."

      IF the file contains an existing profile:
        Copy it to $ARTIFACTS_DIR/draft-profile.json unchanged.
        Present a readable summary in chat:
          "Your saved profile:
           - Frontend level: [N]/10
           - Design background: [value]
           - Tech stack: [value]
           - CSS: [value]
           - Design tools: [value]
           - Communication: [value]

          Approve to keep, or reject with changes."

  - id: gate-calibrate
    type: approval
    capture_response: true
    on_reject: continue
    message: |
      Draft profile at $ARTIFACTS_DIR/draft-profile.json

      Review your preferences:
        - Approve to use this profile as-is
        - Reject with your corrections, e.g.:
          "frontend_level: 8, tech_stack: vue, css_approach: css_modules"
          or "start fresh — ask me everything"

  - id: refine-profile
    type: prompt
    allowed_tools: [read, write]
    expected_artifacts:
      - $ARTIFACTS_DIR/user-profile.json
    prompt: |
      You are in the PROFILE REFINEMENT phase.

      Rejection reason: $REJECTION_REASON

      Read $ARTIFACTS_DIR/draft-profile.json.

      IF $REJECTION_REASON is empty or "[approved]":
        Copy $ARTIFACTS_DIR/draft-profile.json to $ARTIFACTS_DIR/user-profile.json
        unchanged. Say "Profile confirmed."

      IF $REJECTION_REASON contains specific field changes:
        Parse the changes, update the profile accordingly, and write the updated
        version to $ARTIFACTS_DIR/user-profile.json. Update the "updated_at"
        timestamp. Say "Profile updated with your changes: [list what changed]."

      IF $REJECTION_REASON says "start fresh" or similar:
        Write a profile with these defaults and note in chat that the user should
        run the workflow again after this to refine further:
          - frontend_level: 5
          - design_background: "know_what_i_want"
          - tech_stack: "you_decide"
          - css_approach: "you_decide"
          - design_tools: "none"
          - communication_style: "show_options"
          - you_decide_count: 6 (auto_decide_technical: true)

  - id: save-profile
    type: bash
    allow_failure: true
    command: |
      if [ -f "$ARTIFACTS_DIR/user-profile.json" ]; then
        # Always save to global
        mkdir -p "$HOME/.pi"
        cp "$ARTIFACTS_DIR/user-profile.json" "$HOME/.pi/user-profile.json"
        echo "Profile persisted to ~/.pi/user-profile.json"

        # If a project-level override existed, update it too
        if [ -f ".pi/user-profile.json" ]; then
          cp "$ARTIFACTS_DIR/user-profile.json" ".pi/user-profile.json"
          echo "Project-level profile also updated"
        fi
      else
        echo "No profile artifact - skipping"
      fi

  # ── Phase 1 — Design ───────────────────────────────────────────────

  - id: brief
    type: prompt
    allowed_tools: [read, write]
    expected_artifacts:
      - $ARTIFACTS_DIR/brief.md
      - $ARTIFACTS_DIR/HANDOFF.md
    prompt: |
      You are in the DESIGN BRIEF phase. No code yet.

      User request:
      $USER_MESSAGE

      Read $ARTIFACTS_DIR/user-profile.json for the user's preferences.

      First, check if a project-level handoff exists: read .pi/HANDOFF.md
      (if it exists, this is a subsequent slice - incorporate prior context).

      Apply the Intent First methodology. Answer all five questions:
        1. Who is the user and what is their context?
        2. What is the primary action this UI must enable?
        3. What does success feel like? (words that exclude alternatives)
        4. What domain vocabulary does this world use?
        5. What makes this different from a generic app?

      Then write an Intent Statement:
        "This [component/screen] helps [who] to [primary action] so they can [outcome].
        It should feel [adjective]. The user is typically [context/environment].
        The most important thing to get right is [constraint]."

      Then run Domain Exploration - produce all four before moving on:
        - Domain vocabulary: 5-8 concepts native to this domain
        - Color world: 5 physical objects or environments -> what colors do they suggest?
        - Signature element: one detail that could only exist in this product
        - Rejecting: 3 obvious design defaults -> what replaces each for this domain

      Write your direction proposal to $ARTIFACTS_DIR/brief.md.

      Initialize $ARTIFACTS_DIR/HANDOFF.md with this exact structure:
        # HANDOFF - Community Coach / Run 1: Primitives
        ## Project Overview
        [one paragraph - stays fixed across all runs]
        ## Completed So Far
        [empty for first run]
        ## Current State
        - design-system/tokens.css: placeholder (tokens phase will fill)
        - src/utils/cn.ts: cn() helper ready
        ## Next Task
        Brief phase - awaiting gate-brief approval
        ## Breadcrumbs
        [empty for first run]

      COMMUNICATION ADAPTATION (from user profile):
      - frontend_level 1-3: explain design concepts. Define "tokens", "intent statement",
        "domain vocabulary". Use analogies.
      - frontend_level 4-6: brief explanations. Assume HTML/CSS familiarity.
      - frontend_level 7-10: be concise. Use design terminology freely.

      - design_background "designer": use proper design terms (kerning, visual weight).
      - design_background "know_what_i_want": translate their descriptions into design terms.
      - design_background "just_build_it": make confident choices. One strong direction.

      - communication_style "show_options": present 2-3 options for color direction and layout.
      - communication_style "just_build_it": choose the best option and explain briefly.
      - communication_style "explain_decisions": add rationale paragraph for each decision.

      End your chat response with: "Does that direction feel right?"
      Do not write any code. Do not define tokens yet.

  - id: gate-brief
    type: approval
    capture_response: true
    on_reject: cancel
    message: |
      Design brief written to $ARTIFACTS_DIR/brief.md

      Review the direction:
        - Intent statement: does it name the right person and the right action?
        - Domain vocabulary: does the language belong to this world?
        - Color world: do the color references feel right for this domain?
        - Signature element: is it genuinely specific, not generic SaaS?
        - Rejecting: are defaults being replaced with better alternatives?

      Approve to proceed to token design.
      Reject with a reason to cancel (no code has been written).

  # ── Phase 2 — Tokens + Inventory ───────────────────────────────────

  - id: tokens
    type: prompt
    fresh_context: true
    allowed_tools: [read, write]
    expected_artifacts:
      - $ARTIFACTS_DIR/design-tokens.md
      - design-system/tokens.css
    prompt: |
      You are in the TOKEN SYSTEM phase. You have NO memory of prior phases.

      Read these files first:
        1. $ARTIFACTS_DIR/HANDOFF.md         - project context
        2. $ARTIFACTS_DIR/brief.md           - confirmed design direction
        3. $ARTIFACTS_DIR/user-profile.json  - user preferences

      Define the COMPLETE design token system for this project.

      COLOR ARCHITECTURE (use oklch() color space for Tailwind v4):
        - Primary brand (main actions, CTAs)
        - Secondary (structural elements, headers)
        - Accent (highlights, ratings, warnings)
        - Neutrals: ink (text), canvas (card bg), surface (page bg), border
        - State colors: error, success, warning, info

      NAMING RULE - tokens must evoke the domain, not describe the color:
        Bad: --blue-600, --gray-50
        Good: --turf, --sky, --kit, --pitch, --ink, --canvas
        TOKEN TEST: read your variable names out loud.
        Do they sound like they belong to this product's world?
        If any could belong to any app, rename them.

      ALSO DEFINE:
        - Typography scale (base 0.9375rem/15px for outdoor readability)
        - Spacing scale (4px base unit: --space-1 through --space-16)
        - Touch target: --touch-min: 3rem (48px WCAG 2.2 minimum)
        - Border radius (--radius-sm through --radius-full)
        - Shadows (--shadow-sm, --shadow-md, --shadow-lg)

      CSS APPROACH (from user profile):
      If css_approach is "tailwind" or "you_decide": use Tailwind v4 @theme syntax
        (NO tailwind.config.ts — v4 uses CSS-native config):
        @theme {
          --color-primary: oklch(...);
          --color-primary-lt: oklch(...);
        }
      If "css_modules": use :root CSS custom properties with module-scoped imports.
        Do NOT use @theme syntax.
      If "vanilla_css": use :root custom properties with documented fallbacks.
        Do NOT use @theme syntax.
      If "styled_components": use a ThemeProvider with a JS theme object.
        Do NOT use @theme syntax.

      Write to:
        $ARTIFACTS_DIR/design-tokens.md  - documentation + rationale + usage examples
        design-system/tokens.css         - actual token definitions (this is the source of truth)

      Update $ARTIFACTS_DIR/HANDOFF.md:
        - Add: Tokens written: [list key token names]
        - Update Current State: design-system/tokens.css [filled with real tokens]
        - Add Breadcrumb: "Token naming: [pattern used]"

  - id: inventory
    type: prompt
    fresh_context: true
    allowed_tools: [read, write]
    expected_artifacts:
      - $ARTIFACTS_DIR/components.md
    prompt: |
      You are in the INVENTORY phase. You have NO memory of prior phases.

      Read these files first:
        1. $ARTIFACTS_DIR/HANDOFF.md         - project context
        2. $ARTIFACTS_DIR/brief.md           - design direction
        3. $ARTIFACTS_DIR/design-tokens.md   - token system
        4. $ARTIFACTS_DIR/user-profile.json  - user preferences

      List ALL components needed for this slice.
      This is Run 1 - primitives: Button, Badge, Skeleton, Card.

      For EACH component:
        ## ComponentName
        - Purpose: one sentence
        - File: src/components/ui/ComponentName.tsx
        - Props: TypeScript interface (write it out)
        - Variants: list all variant options (e.g. size: sm/md/lg, intent: primary/secondary)
        - States: which data states apply (loading, empty, error, populated, disabled)
        - User action: what does the user DO with this?
        - Mobile layout: describe at 375px
        - Accessibility: role, aria-label, keyboard behavior
        - Acceptance criteria:
            1. [testable check]
            2. [testable check]
            3. [testable check]

      If design_tools is "figma": reference Figma component naming conventions.
        Mention that the user can export assets.
      If design_tools is "none": be more prescriptive about visual specifications.
        Include detailed dimensions in Mobile Layout descriptions.

      Order by dependency (Button and Badge first, Skeleton, then Card which uses them).

      Also produce a domain vocabulary -> UI vocabulary table mapping 5 domain concepts.

      Write to $ARTIFACTS_DIR/components.md.

      Update $ARTIFACTS_DIR/HANDOFF.md:
        - List all 4 components with status
        - Set "Next Task" to "Button (first, no dependencies)"

  - id: gate-plan
    type: approval
    capture_response: true
    on_reject: cancel
    message: |
      Component inventory written to $ARTIFACTS_DIR/components.md

      Review the plan:
        - All 4 primitives listed: Button, Badge, Skeleton, Card?
        - Dependency order correct (primitives before Card)?
        - Props interfaces defined?
        - Acceptance criteria testable?
        - Mobile layouts described?

      Approve to proceed to PRD generation.
      Reject with reason to cancel (no code written yet).

  # ── Phase 3 — PRD + Planning ───────────────────────────────────────

  - id: prd
    type: prompt
    fresh_context: true
    allowed_tools: [read, grep, find, ls, write]
    expected_artifacts:
      - $ARTIFACTS_DIR/prd.md
    prompt: |
      You are in the PRD phase. You have NO memory of prior phases.

      Read in this order:
        1. $ARTIFACTS_DIR/HANDOFF.md         - project context
        2. $ARTIFACTS_DIR/user-profile.json  - user preferences and tech stack
        3. $ARTIFACTS_DIR/brief.md           - design direction + intent
        4. $ARTIFACTS_DIR/design-tokens.md   - token system
        5. $ARTIFACTS_DIR/components.md      - component inventory + acceptance criteria

      Explore the existing codebase to understand current state:
        - Read package.json, tsconfig.json for project config
        - Check src/ structure for existing patterns
        - Identify files that need to be created or modified

      Write $ARTIFACTS_DIR/prd.md with EXACTLY these sections:

        # PRD: <short title from brief>

        ## Goal
        One paragraph: what the user wants and why (from brief.md intent statement).

        ## Tech Stack
        From user-profile.json preferences. If "you_decide", choose based on the
        project's existing setup or recommend React + Tailwind as default.

        ## Requirements
        Bullet list of functional requirements derived from components.md.
        Each requirement must be specific and testable.

        ## Files to Create
        Bullet list of `path:purpose` — every component, test, and config file.

        ## Files to Modify
        Bullet list of `path:reason` — existing files that need updates.

        ## Dependencies
        Libraries to install. "None" if all deps are already present.

        ## Acceptance Criteria
        Numbered, testable checks. Each must be verifiable by running a command
        or reading a specific file. Merge criteria from components.md with
        structural checks (typecheck, lint, build, tests pass).

      Output ONLY the PRD file. Do not summarize in chat.

  - id: gate-prd
    type: approval
    capture_response: true
    on_reject: cancel
    message: |
      PRD written to $ARTIFACTS_DIR/prd.md

      Review:
        - Requirements match the component inventory?
        - Tech stack matches your preferences?
        - File lists accurate?
        - Acceptance criteria testable?

      Approve to proceed to planning.
      Reject with reason to cancel (no code written yet).

  - id: plan
    type: prompt
    fresh_context: true
    allowed_tools: [read, grep, find, ls, write]
    expected_artifacts:
      - $ARTIFACTS_DIR/plan.md
    prompt: |
      You are in the PLAN phase. You have NO memory of prior phases.

      Read in this order:
        1. $ARTIFACTS_DIR/prd.md             - requirements + acceptance criteria
        2. $ARTIFACTS_DIR/user-profile.json  - user tech stack preferences
        3. $ARTIFACTS_DIR/components.md      - component specs with props and variants
        4. $ARTIFACTS_DIR/design-tokens.md   - token system
        5. design-system/tokens.css          - actual token values

      Read every file listed under "Files to Modify" in the PRD.

      Write $ARTIFACTS_DIR/plan.md as an ordered list of steps:

        ## Step N — <verb phrase>
        - **File:** <path> (or "new file: <path>")
        - **Change:** one sentence describing the edit
        - **Verify:** the exact command that proves the step worked
        - **Est. tool calls:** integer 1-5
        - **Files to read first:** comma-separated paths (or "none")

      RULES:
        - Each step must be doable in 1-5 tool calls. Split bigger steps.
        - Build components in dependency order (from components.md).
        - Include a test-writing step for each component.
        - Every "Verify" must be a concrete command, not "check it looks right".

      End with:
        ## Summary
        - Total steps: N
        - Files touched: <list>
        - Build order: <component dependency order>

  - id: estimate
    type: bash
    allow_failure: true
    timeout: 30000
    command: |
      node -e '
        const fs = require("fs");
        const path = require("path");
        const ARTIFACTS = "$ARTIFACTS_DIR";
        const planPath = path.join(ARTIFACTS, "plan.md");
        if (!fs.existsSync(planPath)) { console.error("plan.md not found"); process.exit(2); }
        const plan = fs.readFileSync(planPath, "utf8");
        const steps = plan.split(/^## Step /m).slice(1);
        const CTX = $MODEL_CONTEXT || 196608;
        const BUDGET = Math.floor(CTX * 0.6);
        const warnings = [];
        steps.forEach((s, i) => {
          const files = [...s.matchAll(/(?:^|\s)([\w./\-]+\.\w+)/g)].map(m => m[1]);
          let bytes = 0;
          for (const f of new Set(files)) { try { bytes += fs.statSync(f).size; } catch {} }
          const tokens = Math.ceil(bytes / 4);
          if (tokens > BUDGET) {
            warnings.push("Step " + (i+1) + ": ~" + tokens + " tokens > " + BUDGET + " budget — SPLIT");
          }
        });
        const out = warnings.length
          ? "CONTEXT WARNINGS:\n" + warnings.join("\n")
          : "All steps fit in context budget (" + BUDGET + " token cap).";
        fs.writeFileSync(path.join(ARTIFACTS, "context-estimate.md"), out + "\n");
        console.log(out);
      '

  # ── Phase 4 — Build ────────────────────────────────────────────────

  - id: implement
    type: prompt
    fresh_context: true
    allowed_tools: [read, grep, find, ls, edit, write, bash]
    expected_artifacts:
      - $ARTIFACTS_DIR/build-summary.md
      - $ARTIFACTS_DIR/implement-log.md
    prompt: |
      You are in the IMPLEMENTATION phase. You have NO memory of prior phases.

      Read in this order:
        1. $ARTIFACTS_DIR/plan.md              - your step-by-step guide (follow this)
        2. $ARTIFACTS_DIR/context-estimate.md  - context budget warnings (if it exists)
        3. $ARTIFACTS_DIR/HANDOFF.md           - project context + what is built
        4. $ARTIFACTS_DIR/prd.md               - requirements + acceptance criteria
        5. $ARTIFACTS_DIR/user-profile.json    - user preferences
        6. $ARTIFACTS_DIR/design-tokens.md     - token system rationale
        7. design-system/tokens.css            - actual token values (READ THIS FILE)
        8. $ARTIFACTS_DIR/components.md        - component list + acceptance criteria
        9. src/utils/cn.ts                     - cn() helper you must use

      If $ARTIFACTS_DIR/context-estimate.md does not exist, skip context budget
      warnings and proceed normally.
      If $ARTIFACTS_DIR/build-summary.md exists: read it to see what is done already.
      Do not re-implement existing files - read them first.

      Execute steps from plan.md in order, one at a time. For EACH step:
        1. Read the files listed under "Files to read first" for that step.
        2. Make the change exactly as described in "Change".
        3. Run the "Verify" command for that step.
        4. If verification fails, diagnose and fix (up to 3 attempts).
        5. Append to $ARTIFACTS_DIR/implement-log.md:
             Step N: <done | fixed-after-K-tries | skipped — reason>

      IMPLEMENTATION RULES:
        - Build in order: Button -> Badge -> Skeleton -> Card
        - Mobile-first: base styles for 375px, md: and lg: overrides for desktop
        - Every interactive element needs ALL states: default, hover, active, focus-visible, disabled
        - Touch targets: min-h-[var(--touch-min)] or min-h-12 (48px) on every tappable element
        - Use CSS variables: bg-[var(--color-surface)], text-[var(--color-ink)]
          If Tailwind picked up @theme tokens as utility classes, prefer those
        - Use cn() from @/utils/cn for conditional className construction
        - Zero hardcoded hex values. Zero hardcoded px sizes outside the token system.

      After EACH component, write a Vitest test (src/components/ui/ComponentName.test.tsx):
        - Render test: renders without throwing
        - Props test: key variants render correct DOM
        - Accessibility: role and aria attributes present where defined

      After each component:
        - Run: bun run typecheck 2>&1 | tail -10
        - Fix TypeScript errors before moving to the next component
        - Append to $ARTIFACTS_DIR/build-summary.md:
            ComponentName OK - src/components/ui/ComponentName.tsx + test

      MANDATE CHECK before marking each component done:
        [] Touch targets >= 48px on all interactive elements
        [] All interactive states present (hover, focus-visible, disabled)
        [] Zero hardcoded values - only tokens or Tailwind utilities
        [] TypeScript: bun run typecheck passes

      When all 4 components are done:
        Update $ARTIFACTS_DIR/HANDOFF.md - mark all 4 done, update breadcrumbs
        Output to chat: "Built 4 components: Button OK Badge OK Skeleton OK Card OK. TypeScript clean."

  - id: verify
    type: bash
    allow_failure: true
    timeout: 180000
    command: |
      REPORT="$ARTIFACTS_DIR/quality-report.md"
      printf '# Quality Report\nGenerated: %s\n\n' "$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M JST')" > "$REPORT"
      PASS=0; FAIL=0
      run_check() {
        local name="$1"; shift
        printf '## %s\n' "$name" >> "$REPORT"
        if "$@" >> "$REPORT" 2>&1; then
          printf 'PASS\n\n' >> "$REPORT"; PASS=$((PASS+1))
        else
          printf 'FAIL\n\n' >> "$REPORT"; FAIL=$((FAIL+1))
        fi
      }
      run_check "TypeScript"  bun run typecheck
      run_check "ESLint"      bun run lint
      run_check "Prettier"    bun run format:check
      run_check "Unit tests"  bun run test -- --reporter=verbose
      run_check "Vite build"  bun run build
      if [ -d dist ]; then
        run_check "Bundle size" bun run size
      fi
      IMG=$(grep -rn '<img' src/ 2>/dev/null | grep -v 'loading=' | wc -l || echo 0)
      printf '## Lazy loading\n' >> "$REPORT"
      if [ "$IMG" -eq 0 ]; then
        printf 'PASS\n\n' >> "$REPORT"; PASS=$((PASS+1))
      else
        printf 'FAIL - %d img tags missing loading attribute\n\n' "$IMG" >> "$REPORT"; FAIL=$((FAIL+1))
      fi
      printf '---\nSummary: %d passed, %d failed\n' "$PASS" "$FAIL" >> "$REPORT"
      echo "Quality: $PASS passed, $FAIL failed"

  # ── Phase 5 — Review + Rework ──────────────────────────────────────

  - id: review
    type: prompt
    fresh_context: true
    allowed_tools: [read, grep, find, ls, bash, write]
    prompt: |
      You are a hostile senior engineer reviewing a pull request. Find every shortcoming.
      Be specific - vague feedback is useless. You have NO memory of prior phases.

      Read in this order:
        1. $ARTIFACTS_DIR/HANDOFF.md           - project context
        2. $ARTIFACTS_DIR/brief.md             - what was promised
        3. $ARTIFACTS_DIR/design-tokens.md     - the token system the code must follow
        4. $ARTIFACTS_DIR/quality-report.md    - automated gate results
        5. $ARTIFACTS_DIR/components.md        - acceptance criteria per component
        6. src/components/ui/                  - the actual implementation (read each file)
        7. $ARTIFACTS_DIR/user-profile.json    - adapt review communication
        8. $ARTIFACTS_DIR/prd.md               - acceptance criteria to verify
        9. $ARTIFACTS_DIR/plan.md              - what was planned vs. what was built
        10. $ARTIFACTS_DIR/implement-log.md    - step completion status

      For EACH component (Button, Badge, Skeleton, Card), check:

      DESIGN CONFORMANCE
        [] Only token values? No hardcoded hex or arbitrary [#...] values?
        [] Token names match the domain-evocative design system?
        [] Typography follows defined scale?

      MOBILE FIRST
        [] Base styles for mobile (375px)?
        [] Touch targets >= 48px on interactive elements?

      COMPONENT COMPLETENESS
        [] All interactive states: default, hover, active, focus-visible, disabled?
        [] focus-visible styled and not suppressed?

      CRAFT
        [] Squint test: hierarchy clear without reading text?
        [] Does anything feel specific to this domain vs generic SaaS?

      ACCESSIBILITY
        [] Buttons have accessible names?
        [] ARIA roles on custom interactive elements?

      Score each: PASS / FAIL / WARN with file:line for FAIL items.

      Overall score 1-10:
        10 = production-ready, 7 = acceptable v1, 5 = needs work, below 5 = reject

      USER ADAPTATION (from profile):
      - frontend_level 1-3: frame FAIL items as learning opportunities. Explain WHY
        each issue matters. Include fix suggestions with code snippets.
      - frontend_level 4-6: standard technical review.
      - frontend_level 7-10: terse, direct. Focus on architectural issues. Skip
        explanations for obvious fixes.

      ACCEPTANCE CRITERIA CHECK:
      For each numbered criterion from prd.md, verify PASS/FAIL with evidence.

      MODEL AWARENESS:
      You are running as $MODEL_NAME (size: $MODEL_SIZE, context: $MODEL_CONTEXT tokens, vision: $MODEL_VISION).

      Adapt your review depth to your capabilities:
      - small (sub-9B): focus on structural correctness (HTML semantics, prop types, token usage,
        build passes). Skip nuanced visual design critique — flag items you are uncertain about and
        recommend the user verify visually or with a larger model.
      - medium (9B-35B): full design conformance review including domain-specificity, intent
        alignment, color harmony, and spacing rhythm.
      - large (36B+): full review plus architectural critique (component composition, state
        management patterns, performance implications).
      - unknown: treat as medium — give full review but note that model capabilities could not
        be determined, so visual/subjective assessments may be less reliable.

      If $ARTIFACTS_DIR/vl-critique.md exists (from a vision model): incorporate those
      visual findings into your scoring.

      Write to $ARTIFACTS_DIR/review-report.md.
      End with: "RECOMMENDATION: APPROVE (score N/10)" or "RECOMMENDATION: REJECT (score N/10) - [reason]"

  - id: gate-final
    type: approval
    capture_response: true
    on_reject: continue
    message: |
      Review at $ARTIFACTS_DIR/review-report.md
      Quality report at $ARTIFACTS_DIR/quality-report.md

      APPROVE -> slice accepted. Rework node will self-terminate.
      REJECT  -> provide specific issues. Rework addresses only FAIL items.
                 Second rejection (gate-rework) will rollback all changes.

  - id: rework
    type: prompt
    fresh_context: true
    allowed_tools: [read, grep, find, ls, edit, write, bash]
    prompt: |
      You are in the REWORK phase. You have NO memory of prior phases.

      Rejection reason: $REJECTION_REASON

      FIRST: check if rework is actually needed.
        Read $ARTIFACTS_DIR/review-report.md.
        If $REJECTION_REASON is empty or "[approved]" or score is >= 7 with no specific rejection:
          Write "No rework needed - slice was approved." to $ARTIFACTS_DIR/rework-summary.md
          Stop immediately. Do not touch any source files.

      IF REWORK IS NEEDED:
        Read:
          1. $ARTIFACTS_DIR/HANDOFF.md           - current state
          2. $ARTIFACTS_DIR/review-report.md     - every FAIL item with file:line
          3. design-system/tokens.css            - token values for corrections
          4. $ARTIFACTS_DIR/user-profile.json    - adapt communication

        Fix ONLY items marked FAIL. Do not refactor PASS items.
        For each fix:
          - Read the file at the specified location
          - Make the surgical change
          - Run: bun run typecheck 2>&1 | tail -5
          - Append to $ARTIFACTS_DIR/rework-summary.md: "Fixed: [file:line] - [what changed]"

        USER ADAPTATION:
        - frontend_level 1-3: explain each fix (what was wrong, why, what the fix does).
        - frontend_level 7-10: just fix and list changes.

        MODEL AWARENESS:
        You are $MODEL_NAME (size: $MODEL_SIZE).
        - small (sub-9B): fix only concrete FAIL items (TypeScript errors, missing tokens, wrong
          HTML elements). Do not attempt subjective design improvements — self-critique at this
          size tends to degrade output quality.
        - medium or large (9B+): fix all FAIL items and improve WARN items where you are
          confident in the improvement.
        - unknown: fix FAIL items. Attempt WARN improvements but flag uncertainty.

        When done append: "Rework complete. N items fixed."

  - id: verify-rework
    type: bash
    allow_failure: true
    timeout: 180000
    command: |
      REPORT="$ARTIFACTS_DIR/quality-report-rework.md"
      printf '# Quality Report (Post-Rework)\nGenerated: %s\n\n' "$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M JST')" > "$REPORT"
      PASS=0; FAIL=0
      run_check() {
        local name="$1"; shift
        printf '## %s\n' "$name" >> "$REPORT"
        if "$@" >> "$REPORT" 2>&1; then
          printf 'PASS\n\n' >> "$REPORT"; PASS=$((PASS+1))
        else
          printf 'FAIL\n\n' >> "$REPORT"; FAIL=$((FAIL+1))
        fi
      }
      run_check "TypeScript" bun run typecheck
      run_check "ESLint"     bun run lint
      run_check "Unit tests" bun run test -- --reporter=verbose
      printf '---\nSummary: %d passed, %d failed\n' "$PASS" "$FAIL" >> "$REPORT"
      echo "Post-rework: $PASS passed, $FAIL failed"

  - id: gate-rework
    type: approval
    capture_response: true
    on_reject: rollback
    message: |
      Rework complete.
        $ARTIFACTS_DIR/rework-summary.md        - what was fixed
        $ARTIFACTS_DIR/quality-report-rework.md - post-rework gates

      APPROVE -> accept this slice. HANDOFF will be persisted.
      REJECT  -> all changes rolled back via git stash.

  # ── Phase 6 — Persist ──────────────────────────────────────────────

  - id: persist-handoff
    type: bash
    allow_failure: true
    command: |
      if [ -f "$ARTIFACTS_DIR/HANDOFF.md" ]; then
        mkdir -p .pi
        cp "$ARTIFACTS_DIR/HANDOFF.md" .pi/HANDOFF.md
        echo "HANDOFF persisted to .pi/HANDOFF.md for next slice."
      else
        echo "No HANDOFF.md in ARTIFACTS_DIR - skipping."
      fi
```

---

## Evaluation Rubric

Score each dimension 1–5 (1 = major issues, 5 = excellent). Provide specific evidence for each score.

### 1. Correctness
Does the workflow execute correctly given the engine's mechanics? Are variable substitutions valid? Do data flows (artifacts, $REJECTION_REASON) connect the right producers to consumers? Are there runtime failure paths?

### 2. Spec Fidelity
Does the implementation match every point in the specification? Are there missing nodes, extra nodes, or deviations from the stated requirements? Are all 16 specification points addressed?

### 3. Code Quality
Is the YAML clean, consistent, and maintainable? Are prompts clear and unambiguous for the LLM? Is there unnecessary duplication or complexity?

### 4. Integration
Does the workflow integrate cleanly with the existing engine? Does it follow established patterns (variable substitution, approval flow, fresh_context, expected_artifacts)? Are there breaking changes or side effects?

### 5. Test Coverage
Are there enough gates and verification points to catch failures? Are failure paths handled (allow_failure, optional artifacts, sentinel patterns)? What could fail silently?

---

**Output format:** For each dimension, provide the score and 2–3 sentences of evidence. End with an overall assessment: PASS (no dimension below 3, average >= 4) or FAIL (any dimension below 3, or average < 4).
