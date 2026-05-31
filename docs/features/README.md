# Features

Open PI Harness V2 extends PI Agent with capabilities drawn from research into three open-source agent frameworks. Each feature area maps back to a research source and was implemented across 6 upgrade phases.

## Research Sources

| Source | Repo | What We Took |
|---|---|---|
| **Forge** | [antoinezambelli/forge](https://github.com/antoinezambelli/forge) | Tool-call reliability: rescue parsing, synthetic respond tool, retry with backoff |
| **Hermes** | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | Self-improving skills: autonomous creation from traces, usage tracking, Curator lifecycle, periodic memory nudge |
| **Archon** | [coleam00/Archon](https://github.com/coleam00/Archon) | Workflow engine: DAG execution, conditional routing, loop nodes, structured output, GitHub pipelines, self-improve meta-workflow |

## Feature Map

```
                          Research Sources
              ┌──────────┬──────────────┬──────────┐
              │  Forge   │   Hermes     │  Archon  │
              └────┬─────┴──────┬───────┴────┬─────┘
                   │            │            │
         ┌────────┘     ┌──────┘     ┌──────┘
         │              │            │
         ▼              ▼            ▼
  ┌────────────┐ ┌────────────┐ ┌────────────┐
  │  Phase 1   │ │  Phase 2   │ │  Phase 4   │
  │ Guardrails │ │   Skill    │ │  Workflow   │
  │            │ │Intelligence│ │ Engine v2  │
  │ • rescue   │ │ • usage    │ │ • DAG      │
  │   parse    │ │   tracking │ │ • loops    │
  │ • respond  │ │ • auto-    │ │ • when:    │
  │   tool     │ │   create   │ │ • cancel   │
  │ • retry    │ │   from     │ │ • output_  │
  │   backoff  │ │   traces   │ │   format   │
  │ • event    │ │            │ │            │
  │   logging  │ │            │ │            │
  └────────────┘ └──────┬─────┘ └──────┬─────┘
                        │              │
              ┌─────────┘              │
              │                        │
              ▼                        ▼
       ┌────────────┐           ┌────────────┐
       │  Phase 3   │           │  Phase 6   │
       │ Adaptive   │           │  GitHub    │
       │  Memory    │           │Integration │
       │            │           │            │
       │ • periodic │           │ • fix-     │
       │   nudge    │           │   github-  │
       │ • VRAM-    │           │   issue    │
       │   aware    │           │ • smart-   │
       │   tuning   │           │   review   │
       └────────────┘           └────────────┘
              │                        │
              └──────────┬─────────────┘
                         │
                         ▼
                  ┌────────────┐
                  │  Phase 5   │
                  │   Self-    │
                  │Improvement │
                  │            │
                  │ • Curator  │
                  │ • self-    │
                  │   improve  │
                  │   workflow │
                  │ • skill    │
                  │   lifecycle│
                  └────────────┘
```

## Feature Guides

| Guide | Feature | Phase |
|---|---|---|
| [Self-Improvement Loop](self-improvement-loop.md) | How workflows auto-create skills via trace analysis | 2 + 5 |
| [Guardrails](guardrails.md) | Tool-call reliability: rescue parsing, retry, respond tool | 1 |
| [DAG Workflows](dag-workflows.md) | Dependency-aware execution with conditionals and loops | 4 |
| [Adaptive Memory](adaptive-memory.md) | Cross-session RAG with periodic nudge and VRAM tuning | 3 |
| [GitHub Pipelines](github-pipelines.md) | Issue-to-PR automation and conditional code review | 6 |

## Upgrade History

The V2 features were implemented across 6 phases between 2026-05-28 and 2026-05-31. The original upgrade plans with full implementation details, review checklists, and go/no-go gates are preserved in the [V1 repo](https://github.com/stefans71/PI-Agent-V1):

- `PI-HARNESS-V1-UPGRADE-PLAN.md` -- Phases 1-4 of V1 (executor upgrades, prd-to-code, skill fixes)
- `PI-HARNESS-V2-UPGRADE-PLAN.md` -- Phases 1-6 of V2 (guardrails through GitHub integration)
- `FORGE-HERMES-RESEARCH.md` -- Full research report with comparison matrix
