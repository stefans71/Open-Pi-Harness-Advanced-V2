# Adaptive Memory

Cross-session vector memory with periodic nudge and VRAM-aware retrieval tuning.

**Source:** [Hermes Agent](https://github.com/NousResearch/hermes-agent) (periodic nudge), [Forge](https://github.com/antoinezambelli/forge) (VRAM-aware budgeting)
**Phase:** 3

## Overview

pi-memory persists facts across sessions using vector search over a SQLite-vec database. Phase 3 made it adaptive — it no longer waits for compaction to capture facts, and it adjusts retrieval based on available context.

## Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        MEMORY DATA FLOW                              │
│                                                                      │
│  READ PATH (every turn)                                              │
│  ──────────────────────                                              │
│                                                                      │
│  User prompt                                                         │
│       │                                                              │
│       ▼                                                              │
│  Embed query ────────────────────────► Embedding Server (CPU:8081)   │
│       │                                nomic-embed-text → 768-dim    │
│       ▼                                                              │
│  Cosine similarity search ──────────► SQLite-vec (memory.db)        │
│       │                                top-K, threshold 0.6          │
│       ▼                                                              │
│  Inject [LONG-TERM MEMORY] ────────► System prompt                  │
│       │                                                              │
│       ▼                                                              │
│  Model sees relevant facts                                           │
│  in its context window                                               │
│                                                                      │
│                                                                      │
│  WRITE PATH (two triggers)                                           │
│  ─────────────────────────                                           │
│                                                                      │
│  Trigger A: Compaction                                               │
│  ┌──────────────────────────────────────────────────────┐            │
│  │ Context fills up → PI triggers compaction            │            │
│  │      │                                               │            │
│  │      ▼                                               │            │
│  │ session_before_compact hook fires                    │            │
│  │      │                                               │            │
│  │      ▼                                               │            │
│  │ Fact Extractor ──► Generation Server (GPU:11434)     │            │
│  │ "Extract facts   "What facts are worth keeping?"     │            │
│  │  from messages"         │                            │            │
│  │                         ▼                            │            │
│  │                    Embed each fact ──► SQLite-vec     │            │
│  │                    Deduplicate (>0.95 cosine merge)   │            │
│  └──────────────────────────────────────────────────────┘            │
│                                                                      │
│  Trigger B: Periodic Nudge (Phase 3)                                 │
│  ┌──────────────────────────────────────────────────────┐            │
│  │ Turn counter increments each turn                    │            │
│  │      │                                               │            │
│  │  Every N turns (default: 5):                         │            │
│  │      │                                               │            │
│  │      ▼                                               │            │
│  │ [MEMORY NUDGE] appended to system prompt             │            │
│  │ "Review recent conversation. Any facts worth         │            │
│  │  remembering? Use pi_remember tool."                 │            │
│  │      │                                               │            │
│  │      ▼                                               │            │
│  │ Model evaluates and may call pi_remember             │            │
│  │      │                                               │            │
│  │      ▼                                               │            │
│  │ Fact stored immediately (no compaction needed)        │            │
│  └──────────────────────────────────────────────────────┘            │
│                                                                      │
│                                                                      │
│  VRAM-AWARE RETRIEVAL (Phase 3)                                      │
│  ──────────────────────────────                                      │
│                                                                      │
│  Context usage < 60%:  defaults (topK=8, budget=2000 tokens)        │
│  Context usage 60-80%: reduced   (topK=6, budget=1500 tokens)       │
│  Context usage > 80%:  minimal   (topK=4, budget=1000 tokens)       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Storage

```
.pi/memory.db                    SQLite + sqlite-vec
├── facts table                  id, text, created_at, access_score
├── vec_facts virtual table      768-dim vectors, cosine similarity index
└── WAL mode                     concurrent reads during writes
```

- Max 10,000 facts with decay (90-day half-life on access scores)
- Deduplication: new facts with >0.95 cosine similarity to existing ones update rather than duplicate
- sqlite-vec v0.1.9 KNN queries require `WHERE embedding MATCH ? AND k = ?` (not `LIMIT`)

## Commands

| Command | Description |
|---|---|
| `/remember <fact>` | User-initiated fact storage |
| `/forget <query>` | Remove facts matching query |
| `/memories [query]` | Search stored facts |
| `/vram` | Show VRAM usage and memory stats |

## Tool

The `pi_remember` tool lets the model store facts directly during conversation — this is what the periodic nudge triggers. Unlike `/remember` (user-typed), `pi_remember` is called by the model itself when it identifies something worth persisting.

## Implementation

- `extensions/pi-memory/src/index.ts` — hooks, commands, nudge logic, tool registration
- `extensions/pi-memory/src/config.ts` — `adjustForContext()` for VRAM-aware tuning
- `extensions/pi-memory/src/embedding.ts` — embedding client (nomic-embed-text)
- `extensions/pi-memory/src/fact-extractor.ts` — LLM-based fact extraction from messages
- `extensions/pi-memory/src/memory-store.ts` — SQLite-vec storage and retrieval
- `extensions/pi-memory/src/context-injector.ts` — system prompt injection
- `extensions/pi-memory/src/vram-monitor.ts` — VRAM state detection
