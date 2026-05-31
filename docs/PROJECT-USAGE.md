# Using PI Agent on Your Projects

This guide explains how to use the Open PI Harness extensions on your own projects, separate from extension development.

## Key Concept: Extensions Are Global, Project State Is Local

PI Agent loads extensions from `~/.pi/agent/extensions/` (set up once via `scripts/setup.sh`). But workflows, memory, and skills are stored per-project in each project's `.pi/` directory. You don't need a copy of this repo in every project.

| Component | Scope | Location |
|---|---|---|
| Extensions (code) | Global | `~/.pi/agent/extensions/pi-*` (symlinks) |
| Model config | Global | `~/.pi/agent/models.json` |
| Workflows | Per-project | `<project>/.pi/workflows/` |
| Skills | Per-project + bundled | `<project>/.pi/skills/` + bundled defaults |
| Memory | Per-project | `<project>/.pi/memory.db` |
| Workflow artifacts | Per-project | `<project>/.pi/workflow-artifacts/` |

## Quick Start

### Option A: Using the `/project` command (inside PI Agent)

```
/project new my-project
```

PI Agent prompts you to choose which workflow categories to include, then creates the project with `.pi/workflows/`, `.gitignore`, and `git init`.

To add PI support to an existing project you're already working in:

```
/project add
```

### Option B: Using the standalone script (no PI required)

```bash
# From the repo directory:
bash scripts/init-project.sh ./my-project

# Copy all workflows (not just general-purpose):
bash scripts/init-project.sh ./my-project --all
```

### Option C: Manual setup

```bash
mkdir my-project && cd my-project
git init
mkdir -p .pi/workflows
cp /path/to/Open-Pi-Harness-Advanced-V2/.pi/workflows/code-task.yaml .pi/workflows/
pi
```

PI Agent picks up the global extensions automatically. Workflows, skills, and memory are created in your project's `.pi/` directory.

## Dev vs Stable Setup

If you're both developing extensions AND using PI Agent on real projects, keep two clones:

```
/your/workspace/
├── Open-Pi-Harness-Advanced-V2/     <- DEV: code, test, review PRs
├── pi-harness-stable/               <- STABLE: symlinks point here
│   └── extensions/
└── projects/
    ├── my-app/                       <- your project
    └── another-project/
```

**Setup:**

```bash
# Dev copy (you already have this)
cd /your/workspace/Open-Pi-Harness-Advanced-V2

# Stable copy (clone separately)
cd /your/workspace
git clone https://github.com/stefans71/Open-Pi-Harness-Advanced-V2.git pi-harness-stable
cd pi-harness-stable
npm install
bash scripts/setup.sh   # symlinks point to THIS copy
```

**Day-to-day workflow:**

1. Use PI Agent: `cd projects/my-app && pi` (uses stable extensions)
2. Find a bug or want a feature: fix it in the dev repo
3. Push from dev: `cd Open-Pi-Harness-Advanced-V2 && git push`
4. Update stable: `cd pi-harness-stable && git pull && npm install`
5. Projects automatically pick up the changes via symlinks

## Bundled Workflows

The repo includes 13 workflows in `.pi/workflows/`. Copy the ones you need into your project.

### General Purpose

These work in any project:

| Workflow | What it does |
|---|---|
| `code-task.yaml` | Plan, implement, and verify a coding task |
| `fix-bug.yaml` | Reproduce, fix, and verify a bug |
| `add-tests.yaml` | Analyze code and generate tests |
| `refactor.yaml` | Analyze, plan, approve, and refactor code |
| `investigate.yaml` | Read-only codebase investigation |
| `web-design.yaml` | Design-first web development (4-phase methodology) |
| `adversarial-review.yaml` | Multi-pass adversarial code review |

### Require GitHub

| Workflow | What it does |
|---|---|
| `fix-github-issue.yaml` | Issue-to-fix pipeline with branch routing |
| `smart-review.yaml` | Conditional multi-agent PR review |

### Meta / Development

| Workflow | What it does |
|---|---|
| `self-improve.yaml` | Analyze workflow traces and create new skills |
| `trace-gen.yaml` | Generate execution traces for analysis |
| `prd-to-code.yaml` | Full PRD-to-implementation pipeline |
| `smoke-executor.yaml` | Workflow engine smoke test |

## Project `.pi/` Directory

After running PI Agent, your project will have:

```
my-project/
├── .pi/
│   ├── workflows/            <- your workflow definitions
│   ├── skills/               <- auto-created project skills (gitignored)
│   ├── memory.db             <- cross-session memory (gitignored)
│   ├── memory.db-journal     <- SQLite journal (gitignored)
│   └── workflow-artifacts/   <- run outputs (gitignored)
├── src/
└── ...
```

Add to your project's `.gitignore`:

```
.pi/memory.db
.pi/memory.db-journal
.pi/skills/
.pi/workflow-artifacts/
```

The `.pi/workflows/` directory should be committed — it defines your project's available workflows.
