# GitHub Pipelines

Automated issue-to-PR resolution and conditional multi-agent code review.

**Source:** [Archon](https://github.com/coleam00/Archon) — `archon-fix-github-issue`, `archon-comprehensive-pr-review`
**Phase:** 6 (YAML-only, no TypeScript changes)

## Overview

Two workflows that use the Phase 4 DAG engine to automate GitHub workflows via the `gh` CLI. Both require `gh` installed and authenticated.

## fix-github-issue.yaml

End-to-end pipeline from GitHub issue to draft PR:

```
┌──────────────┐   ┌───────────┐   ┌──────────┐
│ preflight    │──▶│fetch-issue│──▶│ classify  │
│ (bash: check │   │(bash: gh  │   │(prompt,   │
│  gh CLI)     │   │ issue view│   │ output_   │
└──────────────┘   └───────────┘   │ format)   │
                                    └─────┬─────┘
                                          │
                            ┌─────────────┴──────────────┐
                            │                            │
                       ┌────▼────┐                 ┌────▼────┐
                       │investig.│                 │  plan   │
                       │ when:   │                 │ when:   │
                       │ type==  │                 │ type!=  │
                       │ 'bug'   │                 │ 'bug'   │
                       └────┬────┘                 └────┬────┘
                            │                            │
                            └────────────┬───────────────┘
                                         │
                                    ┌────▼────┐
                                    │implement│  loop, max_iterations: 10
                                    └────┬────┘
                                         │
                                    ┌────▼────┐
                                    │validate │  bash: npm test, tsc
                                    └────┬────┘
                                         │
                                    ┌────▼────┐
                                    │create-pr│  gh pr create --draft
                                    └────┬────┘
                                         │
                                    ┌────▼────┐
                                    │  review │  conditional multi-agent
                                    └────┬────┘
                                         │
                                    ┌────▼────┐
                                    │self-fix │  fix review findings
                                    └────┬────┘
                                         │
                                    ┌────▼────┐
                                    │ report  │  gh issue comment
                                    └─────────┘
```

**Key features:**
- Conditional routing: bugs get investigation, features get planning
- Loop-based implementation with test validation
- Draft PR created (not published — user pushes manually)
- Self-fix node applies review findings before reporting

## smart-review.yaml

Conditional multi-agent PR review that only spawns reviewers that are needed:

```yaml
nodes:
  - id: scope
    type: prompt
    output_format:
      type: object
      properties:
        needs_error_review: { type: boolean }
        needs_test_review: { type: boolean }
        needs_docs_review: { type: boolean }
    prompt: "Analyze the git diff. What review types are needed?"

  - id: code-review       # always runs
    depends_on: [scope]

  - id: error-review       # conditional
    depends_on: [scope]
    when: "$scope.output.needs_error_review == true"

  - id: test-review        # conditional
    depends_on: [scope]
    when: "$scope.output.needs_test_review == true"

  - id: docs-review        # conditional
    depends_on: [scope]
    when: "$scope.output.needs_docs_review == true"

  - id: synthesize         # merges all findings
    depends_on: [code-review, error-review, test-review, docs-review]
```

```
          ┌──────────┐
          │  scope   │  Structured output: which reviews needed?
          └─────┬────┘
                │
    ┌───────┬───┼───────┬───────┐
    │       │   │       │       │
    ▼       ▼   ▼       ▼       ▼
 ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
 │ code │ │error │ │ test │ │ docs │    Conditional: only needed
 │review│ │review│ │review│ │review│    reviewers run
 └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘
    │        │        │        │
    └────┬───┴────┬───┴────┬───┘
         │        │        │
         ▼        ▼        ▼
       ┌──────────────────────┐
       │     synthesize       │    Merge all findings
       └──────────────────────┘
```

**Key features:**
- Scoping node prevents unnecessary review work
- All reviewers run in the same DAG layer (serialized on single GPU)
- Synthesizer only sees findings from reviewers that actually ran
- Skipped reviewers (when condition false) don't block the synthesizer

## Prerequisites

Both workflows include a preflight node that checks for `gh` CLI:

```yaml
- id: preflight
  type: bash
  command: |
    if ! command -v gh &>/dev/null; then
      echo "ERROR: gh CLI not found"
      exit 1
    fi
    if ! gh auth status &>/dev/null; then
      echo "ERROR: gh CLI not authenticated. Run: gh auth login"
      exit 1
    fi
```

Failing fast at the start is better than failing 8 nodes deep after minutes of analysis.

## Implementation

No TypeScript changes — both workflows are pure YAML files that use Phase 4 features (`depends_on`, `when`, `output_format`, `loop`).
