# Guardrails (Tool-Call Reliability)

How PI Agent ensures Qwen3.6 and other local models stay in tool-calling mode during workflow execution.

**Source:** [Forge](https://github.com/antoinezambelli/forge) — tool-call reliability framework
**Phase:** 1 (foundation for all other phases)

## Problem

Local LLMs (especially sub-70B) sometimes break out of tool-calling mode during multi-step workflows:
- Wrapping tool calls in code fences or XML tags
- Generating bare text instead of calling a tool
- Connection errors at session boundaries (`fresh_context`)

Forge measured this at ~96% failure rate on 8B models without guardrails.

## Solution

Four capabilities added to the workflow executor, each addressing a different failure mode:

```
┌──────────────────────────────────────────────────────────────────┐
│                      Prompt Node Execution                       │
│                                                                  │
│  ┌──────────────────┐                                           │
│  │ A. Event Logging │  Telemetry for all tool interactions      │
│  │                  │  tool_call_selected, tool_call_blocked,   │
│  │                  │  rescue_parse, node_retry, bash_result    │
│  └────────┬─────────┘                                           │
│           ▼                                                      │
│  ┌──────────────────┐                                           │
│  │ B. Retry with    │  3 attempts, exponential backoff (3^n s)  │
│  │    Backoff       │  Classifies errors as FATAL vs TRANSIENT  │
│  │                  │  Sends correction on retry                │
│  └────────┬─────────┘                                           │
│           ▼                                                      │
│  ┌──────────────────┐                                           │
│  │ C. Respond Tool  │  Synthetic __respond tool keeps model     │
│  │    Injection     │  in tool-calling mode — captures text     │
│  │                  │  output as tool call, not bare text       │
│  └────────┬─────────┘                                           │
│           ▼                                                      │
│  ┌──────────────────┐                                           │
│  │ D. Rescue Parse  │  Extracts valid JSON from code fences,    │
│  │                  │  XML wrappers, prefixed text              │
│  │                  │  No brace-counting repair (too risky)     │
│  └──────────────────┘                                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Error Classification

```
FATAL (no retry):
  WorkflowCancelled (user rejected)
  WorkflowFailed (structural failure)
  Unknown node type

TRANSIENT (retry with backoff):
  Tool call format error → attempt rescue parse first
  Connection error / timeout
  Empty or unparseable model output
```

## Rescue Parse Patterns

| Pattern | Example | Action |
|---|---|---|
| JSON in code fence | `` ```json {"name": "write", ...} ``` `` | Strip fences, parse JSON |
| Qwen XML wrapper | `<tool_call>{"name": "write", ...}</tool_call>` | Strip XML tags, parse JSON |
| Prefixed text | `I'll use write: {"path": ...}` | Extract JSON object, parse |
| Truncated JSON | `{"name": "write", "arguments": {"path": "..."}` | **Not repaired** — retry instead |

Brace-counting repair is deliberately excluded. Model output that contains code (e.g., a write tool with braces in the content argument) produces silently corrupt JSON when "repaired." The retry mechanism handles this case safely.

## Event Logging

All guardrail actions are logged to `events.jsonl` for analysis by the self-improve workflow:

```jsonl
{"ts":1748400000,"event":"tool_set_activated","nodeId":"implement","tools":["read","write","__respond"]}
{"ts":1748400001,"event":"rescue_parse","nodeId":"implement","format":"code_fence","success":true}
{"ts":1748400002,"event":"node_retry","nodeId":"implement","attempt":1,"maxAttempts":3,"error":"..."}
```

## Results

Measured on Qwen3.6-27B (RTX 5090):
- Workflow completion: 80% → 100%
- Node completion: 87% → 100%
- `fresh_context` crash rate: 25% → 0%

## Implementation

All changes are in `extensions/pi-workflows/src/executor.ts` — no new files, no schema changes, no new dependencies. The guardrails are internal to the executor.
