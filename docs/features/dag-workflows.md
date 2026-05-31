# DAG Workflows

Dependency-aware workflow execution with conditional routing, loop nodes, and structured output.

**Source:** [Archon](https://github.com/coleam00/Archon) — DAG executor, conditional routing
**Phase:** 4 (4a: DAG + validation, 4b: loops + structured output)

## What Is a DAG?

A **DAG** (Directed Acyclic Graph) is a way of organizing steps where each step declares which other steps it depends on, and no step can depend on itself in a circle. "Directed" means dependencies flow one way (A must finish before B). "Acyclic" means there are no loops in the dependency chain (A → B → C → A would be invalid).

In practice: instead of "run step 1, then step 2, then step 3" (a flat list), a DAG says "step 3 needs steps 1 and 2 to finish first, but steps 1 and 2 don't depend on each other." This lets workflows branch, skip steps conditionally, and merge results — the engine figures out the right execution order automatically.

```
Flat list (V1):          DAG (V2):

  1 → 2 → 3 → 4           1
                          / \
                         2   3   (2 and 3 are independent)
                          \ /
                           4     (4 waits for both)
```

## Overview

V1 ran nodes in a flat sequential loop — every node ran, in order, unconditionally. V2 adds dependency-aware scheduling so workflows can express branching, conditional routing, and iteration.

## Node Types

| Node | Purpose | Key Options |
|---|---|---|
| `prompt` | Send a message to the LLM | `fresh_context`, `allowed_tools`, `expected_artifacts`, `output_format` |
| `bash` | Run a shell command | `timeout`, `allow_failure` |
| `approval` | Interactive confirm/reject gate | `capture_response`, `on_reject` (cancel/rollback/continue) |
| `loop` | Repeat a prompt until a condition is met | `max_iterations`, `until`, `fresh_context` |
| `cancel` | Abort the workflow | `message` |

## DAG Execution

Nodes can declare `depends_on` to control execution order:

```yaml
nodes:
  - id: classify
    type: prompt
    output_format: { type: object, properties: { type: { type: string } } }
    prompt: "Classify this issue as bug or feature"

  - id: investigate
    type: prompt
    depends_on: [classify]
    when: "$classify.output.type == 'bug'"
    prompt: "Investigate the root cause"

  - id: plan
    type: prompt
    depends_on: [classify]
    when: "$classify.output.type != 'bug'"
    prompt: "Create an implementation plan"

  - id: implement
    type: prompt
    depends_on: [investigate, plan]
    prompt: "Implement the fix or feature"
```

```
    ┌───────────┐
    │  classify  │
    └─────┬─────┘
          │
     ┌────┴────┐
     │         │
     ▼         ▼
┌─────────┐ ┌──────┐
│investig.│ │ plan │   Conditional: only one runs
└────┬────┘ └──┬───┘
     │         │
     └────┬────┘
          ▼
    ┌───────────┐
    │ implement  │   Runs after whichever branch completed
    └───────────┘
```

### Scheduling Algorithm

1. Build adjacency map from `depends_on` declarations
2. Topological sort using Kahn's algorithm
3. Group ready nodes into execution layers
4. All layers execute serially (single-GPU constraint)
5. `fresh_context` nodes are isolated into their own single-node layer
6. Workflows without `depends_on` run identically to V1 (sequential)

### Condition Expressions (`when:`)

Minimal expression language — not a general-purpose evaluator:

```
expr        := comparison ( ("AND" | "OR") comparison )*
comparison  := operand operator operand
operand     := variable | string_literal | number_literal | "true" | "false"
variable    := "$" nodeId ".output" ("." field)*
operator    := "==" | "!=" | "contains"
```

- AND binds tighter than OR
- No parentheses, no type coercion
- Missing variable (node didn't run) → comparison returns false (node skipped)
- Parse errors throw `ConditionParseError` — node is marked FAILED, not silently skipped

## Loop Nodes

```yaml
- id: implement
  type: loop
  max_iterations: 10
  until: "ALL_TESTS_PASS"
  fresh_context: true
  prompt: |
    Iteration $ITERATION of $MAX_ITERATIONS.
    Read the failing tests and fix them.
    When all tests pass, include "ALL_TESTS_PASS" in your response.
```

```
┌──────────────────────────────────────┐
│           Loop Node Runner            │
│                                       │
│  iteration = 0                        │
│  while (iteration < max_iterations):  │
│    ├── if fresh_context: newSession() │
│    ├── resolve vars ($ITERATION)      │
│    ├── sendAndWait(prompt)            │
│    ├── check output for until: signal │
│    │     ├── found → break (success)  │
│    │     └── not found → continue     │
│    ├── check expected_artifacts       │
│    ├── logEvent(loop_iteration)       │
│    └── iteration++                    │
│                                       │
│  if exhausted: throw WorkflowFailed   │
└──────────────────────────────────────┘
```

## Structured Output (`output_format`)

When a prompt node has `output_format`, the executor enforces JSON output:

```yaml
- id: scope
  type: prompt
  output_format:
    type: object
    properties:
      needs_error_review: { type: boolean }
      needs_test_review: { type: boolean }
    required: [needs_error_review, needs_test_review]
  prompt: "Analyze the diff. What review types are needed?"
```

Enforcement is prompt-based (works with any model, no runtime API needed). The executor appends schema instructions and validates JSON parse after model responds. Failed parse triggers retry via the Phase 1 guardrails.

Downstream nodes access structured output via dot-notation: `$scope.output.needs_error_review`.

## Variable Substitution

| Variable | Resolves To |
|---|---|
| `$USER_MESSAGE` | Original user input to the workflow |
| `$ARTIFACTS_DIR` | Per-run artifacts directory path |
| `$REJECTION_REASON` | Text from rejected approval node |
| `$<nodeId>.output` | String output from a previous node |
| `$<nodeId>.output.field` | Dot-notation into structured JSON output |
| `$ITERATION` | Current loop iteration (0-indexed) |
| `$MAX_ITERATIONS` | Loop's max_iterations value |

## Implementation

- `extensions/pi-workflows/src/dag.ts` — `buildDag()` (Kahn's algorithm), `evaluateCondition()`
- `extensions/pi-workflows/src/schema.ts` — `LoopNode`, `CancelNode` types, `depends_on`/`when` fields
- `extensions/pi-workflows/src/executor.ts` — DAG runner, loop runner, structured output enforcement
