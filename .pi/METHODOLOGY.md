# PI Agent v1 — Project Methodology

> How to use PI Agent v1 with new projects.
> Last updated: 2026-05-27 JST

## Overview

PI Agent v1 is a local-first AI coding assistant that runs on AutoDL (RTX 5090) with Qwen3.6-27B. It extends PI Agent with four capabilities: persistent memory, multi-agent orchestration, skill injection, and YAML workflow execution.

This document is the practical playbook for starting a new project and using PI effectively across its lifecycle.

---

## 1. Project Bootstrap

### 1a. Create the project

```bash
# On AutoDL (where PI runs)
cd /root/autodl-tmp
mkdir my-project && cd my-project
git init

# Scaffold your project (framework-specific)
# e.g., bun create vite my-app --template react-ts
# e.g., npm init -y && npx tsc --init
```

### 1b. Create the .pi directory structure

PI Agent looks for `.pi/` in the project root for local workflows and extensions.

```bash
mkdir -p .pi/workflows .pi/extensions .pi/skills
```

| Directory | Purpose |
|---|---|
| `.pi/workflows/` | Project-specific YAML workflows (supplements global ones) |
| `.pi/extensions/` | Project-local PI extensions (rare — use global) |
| `.pi/skills/` | Custom skill definitions (SKILL.md files) |
| `.pi/workflow-artifacts/` | Auto-created per workflow run (gitignore this) |
| `.pi/HANDOFF.md` | Cross-run state for multi-slice workflows |

### 1c. Add to .gitignore

```
.pi/workflow-artifacts/
.pi/memory.db
.pi/memory.db-*
```

### 1d. (Optional) Project-specific scaffold script

For the web-design workflow, create `.pi/scaffold.sh` — runs as the first node to set up project scaffolding (package.json, vite config, tailwind, etc.). The script runs once and should be idempotent.

Example:
```bash
#!/usr/bin/env bash
set -euo pipefail

if [ -f package.json ]; then
  echo "Project already scaffolded — skipping."
  exit 0
fi

bun create vite . --template react-ts
bun add -d tailwindcss @tailwindcss/vite
# ... framework setup
```

---

## 2. Choosing the Right Workflow

PI Agent v1 ships with 10 workflows. Pick based on what you need to do:

### For building new features

| Workflow | When to use | Nodes | Gates |
|---|---|---|---|
| **prd-to-code** | New feature from scratch — needs requirements, planning, implementation, review | 8 (understand → gate-prd → plan → estimate → implement → verify → review → gate-final) | 2 (PRD approval, final approval with rollback) |
| **web-design** | Frontend UI from scratch — design-first methodology with tokens, component inventory, iterative build | 14 (scaffold → brief → gate-brief → tokens → inventory → gate-plan → implement → verify → review → gate-final → rework → verify-rework → gate-rework → persist-handoff) | 3 (brief, plan, final + rework) |
| **adversarial-review** | Build with adversarial evaluation — GAN-style build/attack/revise cycle | 8 (spec → build → evaluate → check → gate-revise → revise → external-review → report) | 1 (revision gate) |

### For modifying existing code

| Workflow | When to use | Nodes | Gates |
|---|---|---|---|
| **code-task** | General implementation task — quick plan/code/verify cycle | 3 (plan → implement → verify) | 0 |
| **fix-bug** | Bug diagnosis and fix — reproduce first, then fix | 3 (reproduce → fix → verify) | 0 |
| **refactor** | Code restructuring — analyze dependencies, plan, execute incrementally | 4 (analyze → approval → refactor → verify) | 1 |
| **add-tests** | Test coverage — analyze what needs testing, write tests, run them | 3 (analyze → write-tests → run-tests) | 0 |

### For investigation and review

| Workflow | When to use | Nodes | Gates |
|---|---|---|---|
| **investigate** | Read-only codebase exploration — find and analyze, no changes | 2 (scan → analyze) | 0 |
| **trace-gen** | Execute a task while generating detailed reasoning traces (for fine-tuning data) | 4 (understand → execute → verify → summary) | 0 |

### Internal

| Workflow | When to use |
|---|---|
| **smoke-executor** | Test the workflow engine itself — artifacts, fresh context, approval gates |

### Decision flowchart

```
New project or new UI?
  ├── Frontend-heavy → web-design
  ├── Backend/library feature → prd-to-code
  └── Want adversarial quality bar → adversarial-review

Existing codebase?
  ├── Bug to fix → fix-bug
  ├── Need tests → add-tests
  ├── Refactoring → refactor
  ├── General task → code-task
  └── Just investigating → investigate
```

---

## 3. Running Workflows

### Basic invocation

```bash
# Start PI Agent
cd /root/autodl-tmp/my-project
pi

# Inside the PI session:
/workflow list                    # see available workflows
/workflow run code-task "add a health check endpoint to the API"
/workflow run prd-to-code "implement user authentication with JWT"
/workflow run web-design "build a dashboard for tracking player stats"
```

### Workflow artifacts

Every run creates a timestamped directory:
```
.pi/workflow-artifacts/code-task-2026-05-17T10-30-00-000Z/
├── events.jsonl           # per-node event log
├── workflow-state.json    # completed node IDs (for resume)
├── prd.md                 # (prd-to-code) requirements document
├── plan.md                # (prd-to-code) implementation steps
├── implement-log.md       # (prd-to-code) step-by-step progress
├── verify.log             # (prd-to-code) typecheck/lint/test results
├── review.md              # (prd-to-code) acceptance criteria review
├── brief.md               # (web-design) design direction
├── design-tokens.md       # (web-design) token system docs
├── components.md          # (web-design) component inventory
├── build-summary.md       # (web-design) implementation progress
├── quality-report.md      # (web-design) automated quality gates
├── review-report.md       # (web-design) peer review
└── HANDOFF.md             # (web-design) cross-run state
```

### Resume after failure

If a workflow crashes or you need to restart from where it left off:

```bash
/workflow run prd-to-code --resume latest     # resume most recent run
/workflow run prd-to-code --resume <run-id>   # resume specific run
```

Resume skips completed nodes and restarts from the first incomplete one.

### Approval gates

When a workflow hits an approval gate:
- **Approve** — workflow continues to next node
- **Reject** — behavior depends on the gate's `on_reject` setting:
  - `cancel` — workflow stops, no code changes rolled back
  - `rollback` — `git stash push -u` reverts all changes, then stops
  - `continue` — workflow continues, rejection reason available as `$REJECTION_REASON` for downstream nodes (used by rework patterns)

**Tip:** At approval gates, open the referenced artifact files and actually review them. The model follows its instructions better when you give specific feedback at gates.

---

## 4. Multi-Slice Workflows (HANDOFF Pattern)

The web-design workflow supports building a project across multiple runs using the HANDOFF.md persistence pattern.

### How it works

1. Each run writes `$ARTIFACTS_DIR/HANDOFF.md` during execution
2. The `persist-handoff` node copies it to `.pi/HANDOFF.md` at the end
3. The next run's `brief` node reads `.pi/HANDOFF.md` to understand prior context
4. Each slice builds on what came before

### Recommended slice progression (frontend)

| Run | Slice | Components |
|---|---|---|
| 1 | Primitives | Button, Badge, Skeleton, Card |
| 2 | Layout | Header, Footer, Nav, PageLayout |
| 3 | Data display | Domain-specific cards, stat badges, lists |
| 4 | Forms | Input forms, builders, selectors |
| 5 | Pages | Full page compositions using all components |

### Running a sequence

```bash
# Run 1
/workflow run web-design "Build primitives: Button, Badge, Skeleton, Card for a soccer training app"
# Review, approve at each gate
# .pi/HANDOFF.md now contains Run 1 state

# Run 2 (new session or same session)
/workflow run web-design "Build layout: Header, Footer, Nav, PageLayout"
# The brief node reads .pi/HANDOFF.md and knows what Run 1 built
```

### Between runs

After each approved slice:
1. Review the generated code
2. Commit the changes: `git add -A && git commit -m "slice 1: primitives"`
3. The HANDOFF.md persists in `.pi/` for the next run

---

## 5. Extension Usage Beyond Workflows

### pi-skills (automatic)

Skills inject structured instructions when your prompt matches trigger keywords. This happens automatically — no command needed.

| Skill | Triggers on | What it injects |
|---|---|---|
| debug | "slow", "broken", "error", "bug", "failing" | Systematic debugging methodology |
| code-review | "review", "check code", "analyze code" | Review checklist with security, performance, correctness |
| refactor | "refactor", "clean up", "simplify", "restructure" | Incremental refactoring approach |
| test-generation | "write tests", "add tests", "unit test" | Test planning and coverage strategy |
| document | "document", "add docs", "docstring" | Documentation templates and conventions |
| explain | "explain", "how does this work", "walk me through" | Structured explanation methodology |
| web-design | "design", "UI", "component", "layout" | Intent First design methodology |

Skills are suppressed during workflow execution (no noise on workflow prompts).

### pi-memory (persistent)

```bash
/remember "the API uses JWT with 24h expiry, refresh tokens in httpOnly cookies"
/memories              # list stored facts
/forget "JWT"          # remove facts matching keyword
```

Facts persist across sessions in SQLite. When you start a new session, pi-memory automatically retrieves relevant facts based on your prompt.

### pi-orchestrator (multi-agent)

```bash
/orchestrate "refactor the auth module, add tests, then update the API docs"
```

Decomposes complex tasks into sequential sub-agent sessions (coder, reviewer, researcher). Each sub-agent gets a role-specific system prompt and tool restrictions. Best for tasks that clearly decompose into distinct specialist roles.

**When to use orchestrate vs. workflows:**
- **Workflow** — when the task follows a known pattern (build, fix, review) and you want structured gates and artifacts
- **Orchestrate** — when the task is ad-hoc complex and needs different specialist perspectives, not a fixed pipeline

---

## 6. Writing Custom Workflows

### YAML schema

```yaml
name: my-workflow
description: What this workflow does

nodes:
  - id: unique-node-id
    type: prompt | bash | approval
    # Type-specific fields below
```

### Node types

**prompt** — send a message to the LLM:
```yaml
- id: plan
  type: prompt
  prompt: |
    $USER_MESSAGE
    Write your plan to $ARTIFACTS_DIR/plan.md
  allowed_tools: [read, grep, find, ls, write]  # structural restriction
  fresh_context: true                             # clean context window
  expected_artifacts:                              # must exist after node
    - $ARTIFACTS_DIR/plan.md
```

**bash** — run a shell command:
```yaml
- id: verify
  type: bash
  command: |
    npm run typecheck 2>&1 | tee "$ARTIFACTS_DIR/verify.log"
  timeout: 120000          # ms (default 60000)
  allow_failure: true      # don't abort on non-zero exit
```

**approval** — human gate:
```yaml
- id: gate
  type: approval
  message: "Review the plan. Approve to proceed."
  capture_response: true           # capture free-text on approve/reject
  on_reject: cancel | rollback | continue
```

### Variables

| Variable | Resolves to |
|---|---|
| `$USER_MESSAGE` | The task description passed to `/workflow run` |
| `$ARTIFACTS_DIR` | Per-run artifact directory path |
| `$REJECTION_REASON` | Text from the most recent rejected approval gate |
| `$<nodeId>.output` | Output of a previous node (captured via `capture_response`) |

### Design patterns

**Read-from-disk, not history:** Each `fresh_context: true` node starts with a blank context. It must read its inputs from artifact files. This avoids context window overflow on long workflows.

**Gate-before-code:** Place approval gates after planning nodes but before implementation. If the user rejects at gate-prd, no code has been written yet.

**Rework loop:** Use `on_reject: continue` on the final gate, then add a rework node that reads `$REJECTION_REASON` and fixes only the failed items. Follow with a second gate using `on_reject: rollback` as the hard stop.

**Handoff persistence:** End multi-run workflows with a bash node that copies `$ARTIFACTS_DIR/HANDOFF.md` to `.pi/HANDOFF.md`. First nodes of subsequent runs read `.pi/HANDOFF.md` for context.

---

## 7. Development Workflow (VPS + AutoDL)

### Architecture

```
VPS (HostDzire) — development
  ├── Claude Code edits code here
  ├── git push to GitHub
  └── rsync to AutoDL for rapid iteration

AutoDL (RTX 5090) — execution
  ├── PI Agent runs here with all extensions
  ├── llama-server (Qwen3.6-27B, GPU, port 11434)
  └── llama-server (nomic-embed-text, CPU, port 8081)
```

### Typical session

1. **Start AutoDL** (if not running)
2. **SSH in**: `ssh -i ~/.ssh/id_ed25519 -p <PORT> root@connect.westc.seetacloud.com`
3. **Start servers**: `bash /root/autodl-tmp/start.sh`
4. **Setup PI**: `bash /root/autodl-tmp/setup-pi.sh`
5. **Sync latest code** (from VPS): `rsync -avz --exclude='node_modules' --exclude='.git' /path/to/project/ -e "ssh -i ~/.ssh/id_ed25519 -p <PORT>" root@connect.westc.seetacloud.com:/root/autodl-tmp/project/`
6. **Run PI**: `cd /root/autodl-tmp/project && pi`
7. **Use workflows**: `/workflow run <name> "task"`
8. **Commit and push** from either VPS or AutoDL

### Starting a new project on AutoDL

```bash
# After SSH + start.sh + setup-pi.sh

cd /root/autodl-tmp
mkdir my-new-project && cd my-new-project
git init

# Bootstrap with scaffold or manually
mkdir -p .pi/workflows

# Copy workflows you need from pi-modular
cp /root/autodl-tmp/pi-modular/.pi/workflows/web-design.yaml .pi/workflows/
cp /root/autodl-tmp/pi-modular/.pi/workflows/prd-to-code.yaml .pi/workflows/

# Start PI — extensions load from global ~/.pi/agent/extensions/
pi
```

Global extensions (pi-memory, pi-skills, pi-workflows, pi-orchestrator) are available in any project directory. Workflows in `.pi/workflows/` are project-local but the global ones from pi-modular are also available via the symlinked extension.

---

## 8. Best Practices

### Prompt quality matters

Qwen3.6-27B at 131K context is capable but not infinite. Help it succeed:
- **Be specific** in workflow task descriptions: "add JWT auth with refresh tokens to the Express API in src/api/" beats "add authentication"
- **Reference files** when you know them: "the bug is in src/api/auth.ts around the token validation"
- **Scope tightly** per workflow run: one feature, one bug, one refactor — not "build the whole app"

### Workflow selection heuristics

- **< 30 min of work** → `code-task` or `fix-bug` (lightweight, no gates)
- **30 min – 2 hours** → `prd-to-code` (structured, gated, reviewable)
- **Multi-session frontend build** → `web-design` (design-first, handoff-based)
- **Quality-critical** → `adversarial-review` (build + attack + revise)
- **Just need to understand** → `investigate` (read-only, no side effects)

### When NOT to use a workflow

- Quick one-off questions → just ask PI directly
- Simple file edits → just tell PI what to change
- Exploratory coding → interactive session, no workflow overhead

Workflows add value when you need **structure, gates, artifact tracking, or fresh context boundaries**. For small tasks, they're overhead.

### Approval gate discipline

- Actually read the artifact files before approving
- Give specific feedback when rejecting (the model reads `$REJECTION_REASON`)
- At prd/brief gates: check that requirements match your intent — it's cheaper to correct here than after implementation

### Memory management

- `/remember` key decisions, preferences, and constraints
- Don't store ephemeral state — that's what workflow artifacts are for
- Memory is project-scoped (`.pi/memory.db`) — each project has its own fact store
