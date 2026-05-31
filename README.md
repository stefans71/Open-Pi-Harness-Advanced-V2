# Open PI Harness Advanced V2

Four modular TypeScript extensions that give [PI Agent](https://github.com/nicholasgasior/pi-coding-agent) persistent memory, multi-agent orchestration, skill-based prompt augmentation, and YAML workflow execution.

## Overview

PI Agent is a local-first LLM coding agent by Mario Zechner that runs against any OpenAI-compatible inference server (llama-server, Ollama, vLLM). It provides a terminal UI, tool use, and an extension API for lifecycle hooks.

This project ships four independent extensions that plug into PI Agent without modifying its core:

- **pi-memory** -- Cross-session vector memory using SQLite-vec and a local embedding model. Facts are extracted during context compaction, embedded as 768-dim vectors, and retrieved via cosine similarity on every turn. The model sees relevant long-term context without manual copy-paste.

- **pi-orchestrator** -- Multi-agent task decomposition. Sends the user's task to the LLM for complexity analysis, generates a step-by-step plan with role assignments (coder, reviewer, researcher), and executes each step as a sequential PI subprocess against the same model instance.

- **pi-skills** -- Declarative instruction injection. Markdown skill files define trigger keywords and structured instructions. When the user's prompt matches a skill's triggers, the instructions are appended automatically. Includes a complexity detector that suggests orchestration for multi-step tasks.

- **pi-workflows** -- YAML workflow execution engine. Supports prompt, bash, approval, loop, and cancel node types with DAG dependencies (`depends_on`), conditional execution (`when`), variable substitution, fresh context windows, tool restrictions, expected artifact validation, and run resume.

## Architecture

```
PI Agent (llama-server on GPU)
  |
  +-- Extension API (lifecycle hooks)
  |     |
  |     +-- pi-memory        session_start, session_before_compact, before_agent_start
  |     +-- pi-orchestrator   session_start (loads roles)
  |     +-- pi-skills         session_start (scans skills), input (trigger matching)
  |     +-- pi-workflows      input (natural language triggers), commands
  |
  +-- Embedding Server (llama-server on CPU, port 8081)
        |
        +-- nomic-embed-text for pi-memory vector operations
```

**Extension discovery:** PI Agent loads extensions declared in each package's `"pi"` field. Symlink each extension directory into `~/.pi/agent/extensions/` or configure the path in PI's settings.

**Two-server setup:** The generation model (e.g., Qwen3-32B on GPU, port 11434) handles all LLM inference. A lightweight embedding model (nomic-embed-text-v1.5, 140MB, CPU-only, port 8081) provides vectors for pi-memory. Both expose OpenAI-compatible endpoints.

**Single-GPU execution:** Orchestrator steps run sequentially, not in parallel, to avoid VRAM contention. Each sub-agent gets a fresh context window against the same llama-server instance.

## Quick Start

### Prerequisites

- Node.js 18+
- [PI Agent](https://github.com/nicholasgasior/pi-coding-agent) v0.70+
- llama-server (or any OpenAI-compatible endpoint) for generation
- llama-server with an embedding model for pi-memory (optional)

### Build

```bash
git clone <repo-url> && cd Open-Pi-Harness-Advanced-V2
npm install
npm run build
```

Build individual extensions:

```bash
npm run build:memory
npm run build:orchestrator
npm run build:skills
npm run build:workflows
```

### Link Extensions

Run the setup script to create symlinks:

```bash
bash scripts/setup.sh
```

Or manually symlink each extension:

```bash
mkdir -p ~/.pi/agent/extensions
ln -s $(pwd)/extensions/pi-memory ~/.pi/agent/extensions/pi-memory
ln -s $(pwd)/extensions/pi-orchestrator ~/.pi/agent/extensions/pi-orchestrator
ln -s $(pwd)/extensions/pi-skills ~/.pi/agent/extensions/pi-skills
ln -s $(pwd)/extensions/pi-workflows ~/.pi/agent/extensions/pi-workflows
```

### Configure Your Model

Choose and configure an inference backend. See [`docs/llm-setups/`](docs/llm-setups/) for detailed guides covering different models and GPUs.

Edit `~/.pi/agent/models.json` with your model's endpoint — see the setup guide for the exact config.

### Configure pi-memory (Optional)

pi-memory defaults to `localhost:11434` (generation) and `localhost:8081` (embeddings). Override via config file at `.pi/extensions/pi-memory/config.json` or `~/.pi/agent/extensions/pi-memory/config.json`.

### Start a New Project

```
/project new my-app       # inside PI Agent — interactive workflow selection
bash scripts/init-project.sh ./my-app   # standalone — copies general workflows
```

See [`docs/PROJECT-USAGE.md`](docs/PROJECT-USAGE.md) for full details, including the recommended dev/stable setup for extension developers.

## Extensions

### pi-memory -- Cross-Session RAG

Persists facts across sessions using vector search over a SQLite-vec database.

**Write path:** When PI triggers compaction, the `session_before_compact` hook extracts facts from messages about to be discarded, embeds them, and stores them with deduplication (>0.95 cosine similarity merges).

**Read path:** On every turn, the `before_agent_start` hook embeds the user's prompt, searches for relevant facts, and injects them into the system prompt as a `[LONG-TERM MEMORY]` block.

**Commands:** `/remember <fact>`, `/forget <query>`, `/memories [query]`, `/vram`

**Tools:** `pi_remember` -- lets the model store facts directly during conversation.

### pi-orchestrator -- Multi-Agent Decomposition

Breaks complex tasks into role-specialized steps executed as sequential PI subprocesses.

**Agent roles** are defined in `agents/*.md` with YAML frontmatter specifying allowed tools, bash access level, max turns, and output format. Four roles are bundled: coder, orchestrator, researcher, reviewer.

**Commands:** `/orchestrate <task>`, `/agents`, `/roles`

### pi-skills -- Declarative Instruction Injection

Scans `.pi/skills/` and bundled `default-skills/` for SKILL.md files. Each skill declares trigger keywords, tags, and structured instructions. The `input` hook scores the user's prompt against all triggers and appends the best-matching skill's instructions.

**Seven bundled skills:** code-review, debug, document, explain, refactor, test-generation, web-design.

**Thinking mode:** Prompts containing diagnostic keywords (debug, investigate, root cause, "think hard") automatically enable high thinking level.

**Skill lifecycle:** A curator (`/skill curator`) identifies stale, unused, and overlapping skills. A creator auto-generates new skills from completed workflow traces.

**Commands:** `/skills`, `/skill <name>`, `/skill create <name>`, `/skill curator`

### pi-workflows -- YAML Workflow Engine

Executes multi-step workflows defined in YAML with five node types:

| Node | Purpose |
|------|---------|
| `prompt` | Send a message to the LLM. Supports `fresh_context`, `allowed_tools`, `expected_artifacts`. |
| `bash` | Run a shell command with optional `timeout` and `allow_failure`. |
| `approval` | Interactive confirm/reject gate. Supports `capture_response` and `on_reject` (cancel/rollback/continue). |
| `loop` | Repeat a prompt up to `max_iterations` times, optionally until a condition is met. |
| `cancel` | Abort the workflow. |

**DAG dependencies:** Nodes can declare `depends_on` to control execution order beyond the default sequence.

**Conditional execution:** Nodes can declare `when` expressions evaluated against workflow state.

**Variable substitution:** `$USER_MESSAGE`, `$ARTIFACTS_DIR`, `$REJECTION_REASON`, `$<nodeId>.output` are resolved in all node fields.

**Resume:** Each run writes `workflow-state.json` to its artifacts directory. Resume with `--resume <run-id|latest>`.

**Commands:** `/workflow run <name> [task]`, `/workflow list`, `/workflow status`, `/workflow version`

## Workflows

Thirteen bundled workflows in `.pi/workflows/`:

| Workflow | Description |
|----------|-------------|
| `add-tests` | Analyze existing code and generate test coverage |
| `adversarial-review` | GAN-inspired build, attack, revise cycle with strict scoring |
| `code-task` | Plan, implement, and verify a coding task |
| `fix-bug` | Reproduce, locate, fix, and verify a bug |
| `fix-github-issue` | End-to-end GitHub issue resolution with branch preparation |
| `investigate` | Read, grep, analyze, and report on a codebase question |
| `prd-to-code` | Multi-phase PRD to implementation pipeline with artifact handoff |
| `refactor` | Analyze, plan, execute incremental refactoring, verify |
| `self-improve` | Analyze prior workflow runs and suggest system improvements |
| `smart-review` | Conditional multi-agent code review with DAG-parallel reviewers |
| `smoke-executor` | Minimal end-to-end executor smoke test |
| `trace-gen` | Structured task execution for fine-tuning trace generation |
| `web-design` | Design-first frontend workflow: intent, tokens, inventory, build, review |

## Documentation

| Doc | Description |
|-----|-------------|
| [`docs/PROJECT-USAGE.md`](docs/PROJECT-USAGE.md) | How to use PI Agent on your own projects |
| [`docs/llm-setups/`](docs/llm-setups/) | Model/GPU setup guides (Qwen 3.6 MTP, VL web-design, DeepSeek V4) |
| [`.pi/METHODOLOGY.md`](.pi/METHODOLOGY.md) | Practical playbook for using PI workflows on new projects |

## Deployment

For GPU cloud deployment, see `scripts/sync-autodl.sh` for rsync-based deployment. The script syncs the project to a remote server and can be wired as a post-commit hook.

Typical setup: llama-server with a quantized model on GPU (port 11434) + a second llama-server with nomic-embed-text on CPU (port 8081). See [`docs/llm-setups/`](docs/llm-setups/) for specific configurations.

## License

Apache-2.0. See [LICENSE](LICENSE) for details.
