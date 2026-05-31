# Self-Improvement Loop

How PI Agent learns from its own workflow runs and automatically creates new skills.

## Overview

When a workflow completes, the system analyzes the execution trace and generates a reusable skill. Next time a similar prompt comes in, the skill fires automatically — the model gets better instructions without needing the full workflow.

This is the core learning loop, inspired by [Hermes Agent](https://github.com/NousResearch/hermes-agent)'s autonomous skill creation and Curator pattern.

## The Loop

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        SELF-IMPROVEMENT LOOP                            │
│                                                                          │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ 1. USER RUNS A WORKFLOW                                            │ │
│  │                                                                     │ │
│  │    /workflow run code-task "build a REST API with auth"             │ │
│  │         │                                                           │ │
│  │         ▼                                                           │ │
│  │    ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐      │ │
│  │    │  plan    │──▶│implement │──▶│ validate │──▶│  review  │      │ │
│  │    │ (prompt) │   │ (prompt) │   │  (bash)  │   │ (prompt) │      │ │
│  │    └──────────┘   └──────────┘   └──────────┘   └──────────┘      │ │
│  │                                                       │            │ │
│  │                              Each node logs to events.jsonl        │ │
│  │                                                       │            │ │
│  └───────────────────────────────────────────────────────┼────────────┘ │
│                                                          │              │
│  ┌───────────────────────────────────────────────────────┼────────────┐ │
│  │ 2. WORKFLOW COMPLETES → EVENT EMITTED                 │            │ │
│  │                                                       ▼            │ │
│  │    pi-workflows emits:                                             │ │
│  │    ┌────────────────────────────────────────────────────────────┐  │ │
│  │    │  workflow:completed                                        │  │ │
│  │    │  {                                                         │  │ │
│  │    │    eventsPath: ".pi/workflow-artifacts/code-task-1748.../   │  │ │
│  │    │                 events.jsonl",                              │  │ │
│  │    │    workflowName: "code-task",                               │  │ │
│  │    │    userMessage: "build a REST API with auth"                │  │ │
│  │    │  }                                                         │  │ │
│  │    └────────────────────────────────────────────────────────────┘  │ │
│  │                          │                                         │ │
│  └──────────────────────────┼─────────────────────────────────────────┘ │
│                             │                                           │
│  ┌──────────────────────────┼─────────────────────────────────────────┐ │
│  │ 3. SKILL CREATOR LISTENS │ (pi-skills extension)                   │ │
│  │                          ▼                                         │ │
│  │    pi-skills/src/index.ts:                                         │ │
│  │    pi.events.on("workflow:completed", (data) => {                  │ │
│  │        skillCreator.createFromTrace(                                │ │
│  │            event.eventsPath,                                       │ │
│  │            event.workflowName,                                     │ │
│  │            event.userMessage                                       │ │
│  │        ).catch(err => /* non-fatal */);                            │ │
│  │    });                                                             │ │
│  │                          │                                         │ │
│  │                          ▼                                         │ │
│  │    SkillCreator reads events.jsonl                                 │ │
│  │    Sends trace to LLM: "extract a reusable skill"                 │ │
│  │    LLM returns SKILL.md content (or "NO_SKILL" if trivial)        │ │
│  │                          │                                         │ │
│  │                          ▼                                         │ │
│  │    Writes: .pi/skills/<id>/SKILL.md                                │ │
│  │                                                                    │ │
│  │    Example generated skill:                                        │ │
│  │    ┌──────────────────────────────────────────────────────────┐    │ │
│  │    │  ---                                                     │    │ │
│  │    │  id: rest-api-auth                                       │    │ │
│  │    │  triggers: [REST API, authentication, JWT, auth middleware] │  │ │
│  │    │  ---                                                     │    │ │
│  │    │  ## Instructions                                         │    │ │
│  │    │  1. Set up express with cors and helmet                  │    │ │
│  │    │  2. Create auth middleware before routes                 │    │ │
│  │    │  3. Use bcrypt for passwords, JWT for sessions           │    │ │
│  │    │  4. Always add rate limiting to auth endpoints           │    │ │
│  │    └──────────────────────────────────────────────────────────┘    │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 4. NEXT TIME: SKILL FIRES AUTOMATICALLY                           │  │
│  │                                                                    │  │
│  │    User types: "add JWT auth to my Express server"                 │  │
│  │         │                                                          │  │
│  │         ▼                                                          │  │
│  │    TriggerMatcher scores prompt against all skills                 │  │
│  │    "rest-api-auth" matches at confidence 0.85                      │  │
│  │         │                                                          │  │
│  │         ▼                                                          │  │
│  │    Skill instructions injected into prompt                         │  │
│  │    Model follows the learned playbook automatically                │  │
│  │                                                                    │  │
│  │    No workflow needed — the knowledge is now a skill               │  │
│  │                                                                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 5. CURATOR MAINTAINS QUALITY                                       │  │
│  │                                                                    │  │
│  │    /skill curator                                                  │  │
│  │         │                                                          │  │
│  │         ▼                                                          │  │
│  │    SkillCurator scans all skills + usage data:                     │  │
│  │                                                                    │  │
│  │    ┌──────────┐     ┌──────────┐     ┌──────────┐                 │  │
│  │    │ Active   │────▶│  Stale   │────▶│ Archived │                 │  │
│  │    │          │     │ (30 days │     │ (90 days │                 │  │
│  │    │ Recently │     │  unused) │     │  unused) │                 │  │
│  │    │ used     │     │          │     │          │                 │  │
│  │    └──────────┘     └──────────┘     └──────────┘                 │  │
│  │         ▲                │                                         │  │
│  │         └────────────────┘                                         │  │
│  │           used again                                               │  │
│  │                                                                    │  │
│  │    Also detects: overlapping triggers, merge candidates            │  │
│  │    Bundled skills (7 defaults) are protected — never archived      │  │
│  │                                                                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Components

### SkillCreator (`extensions/pi-skills/src/skill-creator.ts`)

Called asynchronously after workflow completion. Reads `events.jsonl`, summarizes the trace, sends it to the LLM with a prompt asking it to extract a reusable SKILL.md. Skips workflows with fewer than 3 completed nodes (too simple to learn from).

**Key constraint:** The LLM call is fire-and-forget — it doesn't block workflow completion or conflict with in-flight inference. pi-workflows emits the event; pi-skills consumes it. The two extensions are decoupled via the event bus.

### UsageTracker (`extensions/pi-skills/src/usage-tracker.ts`)

Tracks per-skill telemetry to `.pi/skills/.usage.json`:
- `viewCount` — skill name seen during scanning
- `matchCount` — trigger matched (confidence >= 0.5)
- `useCount` — full instructions injected into prompt
- `avgConfidence` — running average match score
- `lastUsed` — ISO timestamp

This data feeds into both the Curator (staleness detection) and the self-improve meta-workflow (skill coverage analysis).

### SkillCurator (`extensions/pi-skills/src/curator.ts`)

Invoked via `/skill curator`. Scans all skills, checks usage data, and produces a report:
- **Stale** (30+ days unused) — flagged for attention
- **Archived** (90+ days unused) — moved to `.archive/`, recoverable
- **Merge candidates** — skills with overlapping triggers, detected by comparing trigger keyword sets

Bundled skills (the 7 defaults) and pinned skills are protected — the Curator never touches them.

### Self-Improve Workflow (`.pi/workflows/self-improve.yaml`)

A meta-workflow that analyzes prior runs across 5 dimensions:
1. **Efficiency** — nodes taking >120s, high retry counts
2. **Information flow** — data lost at fresh_context boundaries
3. **Artifact quality** — outputs missing concrete actions
4. **Skill coverage** — prompts that triggered no skill but should have
5. **Completion rate** — workflows that failed vs completed

Requires approval gates before applying any changes. Changes are written as proposed files first, diffed against originals, and only applied after a second approval.

## How It Connects to Research

| This Feature | Hermes Equivalent | Key Difference |
|---|---|---|
| SkillCreator | Autonomous skill creation (GEPA evolution) | We use workflow traces, not conversation history |
| SkillCurator | Curator agent (stale/overlap detection) | Ours is a command, not a background agent |
| UsageTracker | Usage-weighted skill selection | Same concept, simpler implementation |
| self-improve.yaml | Living Loop (observe-learn-adapt-share) | Ours is an explicit workflow, not a continuous loop |

The Hermes "Living Loop" runs continuously in the background. Our version is deliberately explicit — you run `/workflow run self-improve` when you want it, review the analysis, and approve changes. This fits the single-GPU constraint where background inference would compete with interactive use.
