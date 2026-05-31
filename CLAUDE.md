# Open PI Harness Advanced V2

> Note: PI Agent reads `AGENTS.md` (slim workflow context) instead of this file. This file is for Claude Code.

## What This Is

Four modular PI Agent extensions: pi-memory, pi-orchestrator, pi-skills, pi-workflows.
Built as pure extensions -- no PI core modifications.
pi-workflows is the primary workhorse -- it executes multi-step YAML workflows with DAG-based dependency resolution, artifact tracking, approval gates, and session management.

V2 additions over V1: DAG execution engine with `depends_on`/`when` conditionals, loop and cancel node types, skill self-improvement (curator + usage tracker + skill creator), VRAM monitoring, adaptive retrieval, and nudge-based memory prompting.

## Repo Structure

TypeScript monorepo using npm workspaces. Each extension is an independent package.

```
open-pi-harness-advanced-v2/
├── package.json              <- root workspace config (npm run build builds all)
├── vitest.workspace.ts       <- workspace-level test config
├── tsconfig.base.json        <- shared TS config
├── extensions/
│   ├── pi-memory/            <- cross-session vector memory (SQLite-vec + embeddings)
│   │   └── src/              <- config, embedding, fact-extractor, memory-store, context-injector, vram-monitor
│   ├── pi-orchestrator/      <- role-based multi-agent task decomposition
│   │   └── src/              <- task-analyzer, role-loader, subprocess-manager, result-synthesizer, llm-helper
│   ├── pi-skills/            <- declarative skill discovery, trigger matching, self-improvement
│   │   ├── src/              <- skill-scanner, trigger-matcher, complexity-detector, curator, usage-tracker, skill-creator
│   │   ├── test/             <- vitest tests
│   │   └── default-skills/   <- 7 bundled SKILL.md definitions
│   └── pi-workflows/         <- YAML workflow execution engine with DAG support
│       └── src/              <- executor.ts, dag.ts, schema.ts, index.ts, __tests__/
├── .pi/
│   ├── workflows/            <- YAML workflow definitions (13 files)
│   ├── METHODOLOGY.md        <- workflow playbook for new projects
│   └── workflow-artifacts/   <- per-run output dirs (gitignored)
├── agents/                   <- agent role definitions (.md with YAML frontmatter)
├── scripts/                  <- sync-autodl.sh
└── LICENSE                   <- Apache-2.0
```

**Build:** `npm install && npm run build` from root, or `npm run build:memory` etc. for individual extensions.

**PI entry point:** Each extension's `package.json` has `"pi": "src/index.ts"` -- PI Agent discovers and loads this automatically from `.pi/extensions/`.

## How the System Works

### Overview
PI Agent handles the live conversation. The four extensions hook into its lifecycle events to add persistent memory, multi-agent orchestration, skill-based instruction injection, and YAML workflow execution -- all without modifying PI's core.

### pi-memory -- Cross-Session RAG

The KV cache (GPU VRAM) holds the current conversation. pi-memory adds a persistent layer that survives across sessions using vector search, not KV cache.

**Write path (compaction time):**
1. Conversation fills up, PI triggers compaction
2. `session_before_compact` hook fires -- pi-memory receives messages about to be discarded
3. Fact extractor sends those messages to Qwen3.6 via `/v1/chat/completions` for JSON fact extraction
4. Each fact gets embedded via `nomic-embed-text` (768-dim vectors) through `/v1/embeddings`
5. Facts + vectors stored in SQLite-vec on disk (cosine similarity index)
6. Deduplication: >0.95 cosine similarity updates rather than duplicates

**Read path (every prompt):**
1. User types a prompt, `before_agent_start` hook fires
2. pi-memory embeds the prompt via nomic-embed-text
3. Cosine similarity search against stored facts (top-K, threshold 0.6)
4. Relevant facts injected into the system prompt as a `[LONG-TERM MEMORY]` block

**Adaptive retrieval:** When context window usage is high (>60%), pi-memory reduces topK and token budget automatically. Thresholds are configurable via `adaptiveRetrieval.contextThresholds`.

**Nudge system:** Every N turns (configurable via `nudge.intervalTurns`), pi-memory prompts the model to surface relevant stored facts.

**VRAM monitor:** Checks llama-server `/health` endpoint to report server liveness and warn when VRAM usage exceeds threshold.

**Storage:** SQLite + sqlite-vec. Facts table + vector virtual table. WAL mode for concurrent reads. Max 10,000 facts with decay (90-day half-life on access scores).

### pi-orchestrator -- Multi-Agent Task Decomposition

Explicitly invoked via `/orchestrate "task description"`. Not auto-triggered.

**Flow:**
1. Task analyzer classifies as simple (skip) or complex (decompose into steps)
2. Each step gets assigned a role (coder, reviewer, researcher) from `agents/*.md`
3. User sees the plan and confirms
4. Subprocess manager spawns sequential PI sessions: `pi --json --no-input --system-prompt-file <role>`
5. Each sub-agent runs against the same llama-server instance -- no extra model loads
6. Result synthesizer merges outputs

**Single-GPU constraint:** Steps run sequentially to avoid VRAM contention.

### pi-skills -- Declarative Instruction Injection

Skills are Markdown files (SKILL.md) with trigger keywords. They enhance the model's response by injecting structured instructions -- no extra LLM calls for matching.

**Flow:**
1. User types a prompt, `input` hook fires
2. Trigger matcher scores prompt against all skill triggers (keyword/phrase matching)
3. If confidence >= 0.5, the best-matching skill's instructions get appended to the prompt

**Usage tracking:** `UsageTracker` records view/match/use counts and confidence scores per skill in `.pi/skills/.usage.json`.

**Skill curator:** `SkillCurator` analyzes usage data to identify stale, underperforming, or overlapping skills. Can suggest merges via LLM analysis.

**Skill creator:** `SkillCreator` extracts reusable skills from workflow execution traces -- analyzes events.jsonl output and generates SKILL.md files via LLM.

**Workflow suppression:** During workflow execution, `globalThis.__piWorkflowRunning` skips trigger matching + complexity detection.

**7 default skills:** debug, code-review, refactor, test-generation, document, explain, web-design.

### pi-workflows -- YAML Workflow Execution Engine

Runs multi-step workflows defined in YAML with optional DAG dependencies. Invoked via `/workflow run <name> <task>`.

**Node types:**
- **prompt** -- sends a message to the LLM. Supports `fresh_context`, `allowed_tools`, `expected_artifacts`, `output_format`.
- **bash** -- runs a shell command via `child_process.spawn`. Supports `timeout` and `allow_failure`.
- **approval** -- interactive confirm/reject gate. Supports `capture_response` and `on_reject: cancel | rollback | continue`.
- **loop** -- repeats a prompt up to `max_iterations` times with optional `until` condition.
- **cancel** -- terminates workflow execution with a message.

**DAG execution (V2):** Nodes can declare `depends_on: [nodeId, ...]` for dependency ordering and `when: "expression"` for conditional execution. `dag.ts` performs topological sort into execution layers. Bash nodes in the same layer can run in parallel (`bash_parallel` mode). Without `depends_on`, nodes execute sequentially (V1 behavior).

**Variable substitution:** `$USER_MESSAGE`, `$ARTIFACTS_DIR`, `$REJECTION_REASON`, `$<nodeId>.output` resolved in all node fields before execution.

**Session management:** When a prompt node has `fresh_context: true`, the executor calls `ctx.newSession({ withSession })` and recurses into the callback for all remaining nodes. A module-level `pendingAllowedTools` variable (survives session replacement) is consumed by a `session_start` handler to restrict tools structurally.

**Artifacts:** Each run creates `.pi/workflow-artifacts/<name>-<timestamp>/` containing `events.jsonl` and `workflow-state.json`. Resume via `/workflow run <name> --resume <run-id|latest>`.

**13 bundled workflows:** add-tests, adversarial-review, code-task, fix-bug, fix-github-issue, investigate, prd-to-code, refactor, self-improve, smart-review, smoke-executor, trace-gen, web-design.

### Embedding Model

`nomic-embed-text-v1.5` (Q8_0, 140MB) runs as a second llama-server instance on CPU (port 8081, zero VRAM). The generation server (GPU, port 11434) and embedding server (CPU, port 8081) run side-by-side.

pi-memory config: `extensions/pi-memory/src/config.ts`
- `shared.generationUrl`: `http://localhost:11434` -- llama-server `/v1/chat/completions`
- `shared.embeddingUrl`: `http://localhost:8081` -- llama-server `/v1/embeddings`
- `shared.embeddingDimension`: `768`
- DB: `.pi/memory.db` (SQLite + sqlite-vec, project-local)

Config file lookup: `.pi/extensions/pi-memory/config.json` (project) or `~/.pi/agent/extensions/pi-memory/config.json` (global). Falls back to built-in defaults.

## Gotchas

- **vec0 KNN queries**: sqlite-vec v0.1.9 requires `WHERE embedding MATCH ? AND k = ?` -- `LIMIT ?` alone throws `SQLITE_ERROR`
- **sqlite-vec path**: Use npm package's `sqliteVec.load(db)` -- don't hardcode `.so` path
- **Skill discovery**: `SkillScanner` needs `import.meta.url`-relative path for bundled `default-skills/`
- **`pi -p "/command"`**: Extension slash commands don't work in `-p` mode -- passed as literal prompt
- **ESM modules**: All extensions need `"type": "module"` in `package.json`
- **Node.js HTTP through SSH tunnel**: `fetch()` and undici `Pool` fail with "other side closed". Use `undici.request()` (stateless)
- **ctx.newSession({ withSession })**: After `newSession()` returns, the outer ctx is permanently stale. All remaining workflow nodes must execute inside the `withSession` callback via recursive `runFrom()`
- **sendAndWait race**: `pi.sendUserMessage` is fire-and-forget. Must poll `isIdle()` to detect streaming start before calling `waitForIdle()`
- **pi.exec after session replacement**: Calls `runtime.assertActive()` and throws. Executor uses `child_process.spawn` directly for bash nodes
- **pi.appendEntry after session replacement**: Also guarded by `assertActive()`. Executor uses try/catch and falls back to filesystem-only `events.jsonl` logging
- **DAG cycle detection**: `buildDag()` validates that processed count equals total nodes; throws on cycles
- **AutoDL setup-pi.sh symlinks**: The `setup-pi.sh` script on AutoDL creates extension symlinks pointing at `/root/autodl-tmp/pi-modular/`. After syncing V2, update the target to `/root/autodl-tmp/open-pi-harness/` or re-run with updated paths

## Key Constraints

- Target runtime: PI Agent v0.70.x with llama-server backend (Qwen3.6-27B Dense MTP, UD-Q5_K_XL on RTX 5090)
- Extensions must work with any PI-supported provider -- they do not import PI internals
- Local-first: no cloud dependencies for core functionality
- Each extension is independently installable
- pi-memory requires two endpoints: generation + embedding (see Embedding Model section)

## Reference Documents

- `.pi/METHODOLOGY.md` -- practical playbook for using PI Agent with new projects
- `docs/PROJECT-USAGE.md` -- how to use PI Agent on your own projects (dev/stable setup)
- `docs/llm-setups/` -- model/GPU setup guides (Qwen 3.6 MTP, VL web-design, DeepSeek V4)
- `docs/personal/AUTODL-SETUP.md` -- personal AutoDL deployment reference
