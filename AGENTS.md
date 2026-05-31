# open-pi-harness-advanced-v2

Four PI Agent extensions: pi-memory, pi-orchestrator, pi-skills, pi-workflows.
TypeScript monorepo, npm workspaces. Build: `npm run build`

## Extension Commands

| Extension | Commands |
|---|---|
| pi-memory | `/remember`, `/forget`, `/memories`, `/vram` |
| pi-orchestrator | `/orchestrate`, `/agents`, `/roles` |
| pi-skills | `/skills`, `/skill`, `/skill create <name>`, `/skill curator` |
| pi-workflows | `/workflow run`, `/workflow list`, `/workflow status`, `/workflow version` |

## pi-workflows Quick Reference

Node types: prompt, bash, approval, loop, cancel
Variables: `$USER_MESSAGE`, `$ARTIFACTS_DIR`, `$REJECTION_REASON`, `$ITERATION`, `$<nodeId>.output`
Artifacts: `.pi/workflow-artifacts/<name>-<timestamp>/` (events.jsonl, workflow-state.json)
Resume: `/workflow run <name> --resume <run-id|latest>`

**prompt** -- LLM message. Supports `fresh_context`, `allowed_tools`, `expected_artifacts`, `output_format` (structured JSON schema), `depends_on`, `when`.
**bash** -- shell via child_process.spawn. Supports `timeout`, `allow_failure`, `depends_on`, `when`. `ARTIFACTS_DIR` available as env var.
**approval** -- human gate. `capture_response` for free-text. `on_reject`: cancel | rollback | continue. Supports `depends_on`, `when`.
**loop** -- iterative LLM prompt. `max_iterations` (required), `until` (stop phrase). Supports `fresh_context`, `allowed_tools`, `expected_artifacts`, `depends_on`, `when`.
**cancel** -- abort with message. Supports `depends_on`, `when`.

### DAG Engine

Nodes with `depends_on: [nodeA, nodeB]` form a dependency graph. The executor topologically sorts them into layers: nodes in the same layer with no dependencies between them can run in parallel (bash nodes run concurrently; prompt nodes serialize due to single GPU). Cycles are detected and rejected at validation time.

**Conditional execution** with `when:` expressions:
- `$nodeId.output == 'value'` / `$nodeId.output != 'value'`
- `$nodeId.output.field == 'value'` (dot-path into JSON output from `output_format`)
- `$nodeId.output contains 'substring'`
- Combine with `AND` / `OR`: `$scope.output.needs_tests == true AND $scope.output.needs_docs == true`
- Skipped nodes pass through -- downstream `depends_on` still resolves.

**Structured output** with `output_format:` -- JSON schema object. The LLM response is parsed and stored as JSON, accessible via `$nodeId.output.field` in downstream `when:` conditions.

### Workflows

13 workflows: add-tests, adversarial-review, code-task, fix-bug, fix-github-issue, investigate, prd-to-code, refactor, self-improve, smart-review, smoke-executor, trace-gen, web-design.

Notable V2 workflows:
- **smart-review** -- DAG-driven conditional review: scopes the diff, runs code/error/test/docs reviewers in parallel based on `when:` conditions, synthesizes findings
- **fix-github-issue** -- end-to-end: fetch issue via `gh`, classify bug vs feature, branch investigation/planning via `when:`, implement in a `loop`, validate, self-review, report back
- **self-improve** -- analyzes recent workflow traces and skill usage, proposes improvements to YAML workflows and skills with approval gates

## pi-skills

7 default skills: debug, code-review, refactor, test-generation, document, explain, web-design.
Suppressed during workflow execution via `globalThis.__piWorkflowRunning`.
Custom skills: `.pi/skills/<id>/SKILL.md`
Skill creation from workflow traces: after a workflow completes, pi-skills can auto-generate a new skill from the execution trace.
Curator: `/skill curator` -- analyzes usage stats, flags stale skills (>30 days), archives unused (>90 days), detects merge candidates.

## pi-memory

Cross-session RAG. Extracts facts during compaction, embeds via nomic-embed-text (768-dim), stores in SQLite-vec. Retrieves relevant facts on every prompt via cosine similarity injected as `[LONG-TERM MEMORY]` system prompt block. Adaptive retrieval scales down as context fills. Memory nudge every 5 turns prompts the model to persist important facts via the `pi_remember` tool.
Config: `extensions/pi-memory/src/config.ts` (generationUrl port 11434, embeddingUrl port 8081).

## pi-orchestrator

Multi-agent task decomposition via `/orchestrate`. Classifies complexity, decomposes into steps with specialist roles (coder, reviewer, researcher, orchestrator from `agents/*.md`), spawns sequential PI subprocesses. Single-GPU: steps run sequentially.

## Coding Gotchas

- **ctx.newSession({ withSession })**: outer ctx is stale after return. All remaining nodes must run inside withSession callback via recursive `runFrom()`
- **sendAndWait race**: `pi.sendUserMessage` is fire-and-forget. Poll `isIdle()` before `waitForIdle()`
- **pi.exec / pi.appendEntry after session replacement**: throws `assertActive()`. Use `child_process.spawn` for bash nodes, try/catch with filesystem fallback for logging
- **pi -p "/command"**: slash commands don't work in `-p` mode -- passed as literal prompt
- **ESM**: all extensions need `"type": "module"` in package.json
- **SkillScanner**: needs `import.meta.url`-relative path for bundled `default-skills/`

## Key Constraints

- Runtime: PI Agent + llama-server (local GPU inference)
- Extensions are provider-agnostic -- no PI internals imported
- Local-first: no cloud dependencies
- pi-memory needs two endpoints: generation (port 11434) + embedding (port 8081)

## Repo Structure

```
open-pi-harness-advanced-v2/
├── extensions/
│   ├── pi-memory/            ← cross-session vector memory
│   ├── pi-orchestrator/      ← multi-agent task decomposition
│   ├── pi-skills/            ← skill discovery, trigger matching, auto-creation, curation
│   │   └── default-skills/   ← 7 bundled SKILL.md definitions
│   └── pi-workflows/         ← DAG workflow engine (executor, dag, schema)
├── .pi/
│   ├── workflows/            ← 13 YAML workflow definitions
│   └── METHODOLOGY.md        ← workflow playbook for new projects
├── agents/                   ← role definitions (coder, reviewer, researcher, orchestrator)
└── scripts/                  ← sync-autodl.sh
```
