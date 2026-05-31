# Diff Review — Web-Design Workflow v2: Calibration + PRD Pipeline

## Summary

Upgrade the web-design workflow from 14 nodes to 23 nodes by adding:
- **User calibration** (5 nodes): read-profile → calibrate → gate-calibrate → refine-profile → save-profile
- **PRD + planning** (4 nodes): prd → gate-prd → plan → estimate

Also modifies 7 existing nodes to read the user profile and adapt communication, review depth, and CSS approach based on user preferences.

**Files changed:** `.pi/workflows/web-design.yaml` only (443 → 810 lines). Pure YAML — no TypeScript changes.

---

## PI Workflow Engine Reference

This workflow runs on the PI Agent workflow executor. The reviewer must understand these mechanics to validate the YAML.

### Node Types (from schema.ts)

```typescript
export type WorkflowNode = PromptNode | BashNode | ApprovalNode | LoopNode | CancelNode;

export interface PromptNode {
    id: string;
    type: "prompt";
    prompt: string;
    allowed_tools?: string[];      // Restrict available tools during this node
    fresh_context?: boolean;       // Open a new LLM session (clean context window)
    expected_artifacts?: string[]; // Files that MUST exist after node completes (retry once if missing)
    output_format?: Record<string, unknown>;
    depends_on?: string[];
    when?: string;
}

export interface BashNode {
    id: string;
    type: "bash";
    command: string;
    timeout?: number;
    allow_failure?: boolean;       // If true, workflow continues even if exit code != 0
    depends_on?: string[];
    when?: string;
}

export interface ApprovalNode {
    id: string;
    type: "approval";
    message: string;
    capture_response?: boolean;    // Capture user's rejection text
    on_reject?: "cancel" | "rollback" | "continue";  // What happens on reject
    depends_on?: string[];
    when?: string;
}
```

### Variable Substitution (from executor.ts resolveVariables ~line 1459)

All `$VARIABLE` placeholders in node fields are **text-substituted** by the executor before the node runs:

```typescript
private resolveVariables(node: WorkflowNode, userMessage: string, iteration?: number): WorkflowNode {
    const resolve = (s: string): string => {
        let result = s
            .replace(/\$USER_MESSAGE/g, userMessage)
            .replace(/\$ARTIFACTS_DIR\b/g, this.artifactsDir ?? "")
            .replace(/\$REJECTION_REASON\b/g, this.rejectionReason ?? "");
        if (iteration !== undefined) {
            result = result.replace(/\$ITERATION\b/g, String(iteration));
        }
        if (this.modelProfile) {
            result = result
                .replace(/\$MODEL_ID\b/g, this.modelProfile.id)
                .replace(/\$MODEL_NAME\b/g, this.modelProfile.name)
                .replace(/\$MODEL_SIZE\b/g, this.modelProfile.sizeClass)
                .replace(/\$MODEL_CONTEXT\b/g, String(this.modelProfile.contextWindow))
                .replace(/\$MODEL_VISION\b/g, String(this.modelProfile.supportsVision));
        }
        // ... $nodeId.output patterns follow
    };
}
```

**Key behaviors:**
- `$REJECTION_REASON` is set when an approval node with `on_reject: continue` is rejected. It contains the user's rejection text. It is reset to `null` before each approval node.
- `$MODEL_CONTEXT` is substituted as a literal number (e.g., `196608`). In bash nodes, `$MODEL_CONTEXT || 196608` becomes `196608 || 196608` — valid JS.
- `$ARTIFACTS_DIR` points to `.pi/workflow-artifacts/<name>-<timestamp>/`
- Prompt nodes are **single-turn**: the model generates one response with tool calls, then the node completes. The model cannot ask questions and wait for answers.
- `expected_artifacts` checks file existence after node completion; retries the node once if any file is missing.
- `fresh_context: true` opens a new LLM session via `ctx.newSession()`. The model loses all memory of prior nodes and must read everything from disk.

### Approval Node Flow

```
gate-calibrate (on_reject: continue)
  → User approves: $REJECTION_REASON = "" for downstream nodes
  → User rejects with text: $REJECTION_REASON = user's text, workflow continues to refine-profile

gate-final (on_reject: continue)
  → Same pattern: rejection text flows to rework node via $REJECTION_REASON
```

---

## Specification

### User Profile Schema

Stored at `~/.pi/user-profile.json` (global). Project-level override at `.pi/user-profile.json` takes precedence.

```json
{
  "version": 1,
  "updated_at": "2026-05-31T10:00:00Z",
  "experience": {
    "frontend_level": 7,
    "design_background": "know_what_i_want"
  },
  "preferences": {
    "tech_stack": "react_tailwind",
    "css_approach": "tailwind",
    "design_tools": "none",
    "communication_style": "explain_decisions"
  },
  "adaptive": {
    "you_decide_count": 0,
    "auto_decide_technical": false
  }
}
```

### Pipeline (23 nodes)

```
Phase 0 — Setup + Calibration
  scaffold          bash      project scaffold
  read-profile      bash      load existing user profile (sentinel-first)
  calibrate         prompt    single-turn: read context, write draft profile
  gate-calibrate    approval  user reviews/adjusts draft profile (on_reject: continue)
  refine-profile    prompt    apply user's adjustments via $REJECTION_REASON
  save-profile      bash      persist to ~/.pi/ (+ project-level if exists)

Phase 1 — Design
  brief             prompt    Intent First methodology (profile-adapted)
  gate-brief        approval  user reviews design direction

Phase 2 — Tokens + Inventory
  tokens            prompt    design token system (fresh_context, profile-adapted)
  inventory         prompt    component inventory (fresh_context, profile-adapted)
  gate-plan         approval  user reviews component plan → "proceed to PRD"

Phase 3 — PRD + Planning
  prd               prompt    structured PRD from design artifacts (fresh_context)
  gate-prd          approval  user reviews PRD
  plan              prompt    step-by-step implementation plan (fresh_context)
  estimate          bash      context budget check ($MODEL_CONTEXT inline sub)

Phase 4 — Build
  implement         prompt    execute plan steps (fresh_context, profile-adapted)
  verify            bash      typecheck + lint + tests + build

Phase 5 — Review + Rework
  review            prompt    adversarial review (fresh_context, profile+model adapted)
  gate-final        approval  approve or reject → rework (on_reject: continue)
  rework            prompt    fix FAIL items (fresh_context, profile+model adapted)
  verify-rework     bash      post-rework quality check
  gate-rework       approval  final approve or rollback (on_reject: rollback)

Phase 6 — Persist
  persist-handoff   bash      copy HANDOFF.md to .pi/ for next slice
```

### Key Design Decisions

1. **Single-turn calibration**: PI prompt nodes can't do interactive Q&A. Solution: calibrate writes a draft → gate-calibrate lets user approve/reject → refine-profile applies changes. Same pattern as gate-final → rework.

2. **Sentinel-first profile read**: read-profile writes `{"exists": false}` before attempting to load the real profile. If the read fails, calibrate still has valid input.

3. **Profile-conditional CSS**: tokens node no longer unconditionally says "use @theme syntax." Instead, CSS approach is conditioned on the user's profile: @theme for tailwind/you_decide, :root for css_modules/vanilla_css, ThemeProvider for styled_components.

4. **estimate allow_failure**: estimate has `allow_failure: true` and may not produce `context-estimate.md`. implement's prompt explicitly handles this: "If context-estimate.md does not exist, skip context budget warnings."

5. **$MODEL_CONTEXT in bash**: The estimate node uses `$MODEL_CONTEXT || 196608` inline. resolveVariables() substitutes the number before bash runs, so this becomes valid JS like `196608 || 196608`.

---

## Review Checklist

For each item, mark PASS / FAIL / WARN with evidence.

### Schema Compliance
1. Every node has a valid `type` (prompt | bash | approval)
2. Every prompt node has a `prompt` string
3. Every bash node has a `command` string
4. Every approval node has a `message` string
5. `on_reject` values are one of: cancel | rollback | continue
6. `allowed_tools` arrays contain valid tool names
7. No duplicate node IDs
8. `expected_artifacts` paths use `$ARTIFACTS_DIR` (resolved at runtime)

### Variable Usage
9. `$USER_MESSAGE`, `$ARTIFACTS_DIR`, `$REJECTION_REASON` used correctly per executor behavior
10. `$MODEL_*` variables used in correct contexts (review, rework, estimate nodes)
11. `$REJECTION_REASON` only referenced in nodes downstream of `on_reject: continue` gates
12. No use of `process.env.MODEL_CONTEXT` in bash nodes (must be inline `$MODEL_CONTEXT`)

### Calibration Flow
13. read-profile writes sentinel before attempting real profile read
14. calibrate is single-turn (no interactive Q&A patterns in prompt)
15. gate-calibrate has `on_reject: continue` so workflow proceeds to refine-profile
16. refine-profile correctly handles all 3 paths: approved, specific changes, start fresh
17. save-profile updates both global and project-level (if exists)

### PRD + Planning Flow
18. prd node has `fresh_context: true` and reads all required artifacts
19. gate-prd provides meaningful review criteria
20. plan node reads PRD and produces structured steps with verify commands
21. estimate uses `$MODEL_CONTEXT` inline (not process.env)

### Modified Node Integrity
22. brief reads `$ARTIFACTS_DIR/user-profile.json` and has COMMUNICATION ADAPTATION block
23. tokens has profile-conditional CSS approach (not unconditional Tailwind)
24. inventory reads user profile and adapts for design_tools preference
25. gate-plan message says "PRD generation" not "implementation"
26. implement reads plan.md, prd.md, context-estimate.md (optional), has both expected_artifacts
27. review reads plan.md, prd.md, implement-log.md, has USER ADAPTATION and ACCEPTANCE CRITERIA blocks
28. rework reads user-profile.json and has USER ADAPTATION block

### Pipeline Correctness
29. Nodes are in correct execution order (no forward references in data flow)
30. All `fresh_context` nodes have complete read lists for required artifacts
31. Artifact names are consistent across producers and consumers
32. No orphaned artifacts (every produced artifact is consumed downstream)

---

## Diff

See `raw.diff` in this directory (553 lines). The file is a full rewrite — the diff is effectively the entire old file removed and new file added.
