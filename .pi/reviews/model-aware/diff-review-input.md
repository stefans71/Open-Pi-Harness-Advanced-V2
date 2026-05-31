# Model-Aware Workflow Recommendations — Review Input

## Summary

Detect the running model via `ctx.model` and inject `$MODEL_ID`, `$MODEL_NAME`, `$MODEL_SIZE`, `$MODEL_CONTEXT`, `$MODEL_VISION` as template variables into all workflow prompts. The web-design workflow uses these to adapt review/rework behavior based on model capabilities.

**Why review/rework only, not implement?** Small-model self-critique degrades output quality (tested: 8B VL base 4.50→4.00, fine-tuned 5.50→5.15). Generation works fine at any size with structured SKILL.md instructions. Model awareness belongs in the critique steps.

## Files Changed

| File | Action | Lines |
|---|---|---|
| `extensions/pi-workflows/src/model-info.ts` | NEW | ~48 lines |
| `extensions/pi-workflows/src/executor.ts` | MODIFY | +21 lines (import, property, detection, logging, variable substitution) |
| `.pi/workflows/web-design.yaml` | MODIFY | +32 lines (MODEL AWARENESS in review + rework nodes) |
| `extensions/pi-workflows/src/__tests__/model-info.test.ts` | NEW | ~62 lines, 9 test cases |
| `extensions/pi-workflows/src/__tests__/model-variables.test.ts` | NEW | ~33 lines, 4 test cases |

## Key Design Decisions

1. **Threshold-based size parsing**: `inferSizeClass()` extracts numeric XB from model id/name, classifies `<9B`=small, `9-35B`=medium, `36B+`=large. Matches YAML's "sub-9B" language exactly.
2. **Typed interface assertion** instead of `as any` — `initialCtx as { model?: ... }` for ctx.model access.
3. **All 13 workflows** get the variables via executor's `resolveVariables()` — zero extra cost. Only web-design.yaml uses them initially.
4. **First-match heuristic** for size regex — documented with MoE compound-name test case. Acceptable for current PI model id formats.

## Codex Review History

### v1 (5 findings — all addressed)
1. HIGH: review/rework-only scope — **intentional** (self-critique degrades small models)
2. MEDIUM: size regex misses 10B-13B — **fixed** with threshold parsing
3. MEDIUM: no executor-level tests — **fixed** with model-variables.test.ts
4. LOW: `as any` cast — **fixed** with typed interface
5. LOW: no unknown branch — **fixed** in both YAML sections

### v2 (1 finding — addressed)
6. MEDIUM: 8B boundary mismatch (`<=8` vs "sub-9B") — **fixed**: changed to `< 9`

## Verification Results

- **TypeScript**: `npx tsc --noEmit -p extensions/pi-workflows` — clean (0 errors)
- **Tests**: 315 passed (16 files), including 13 new test cases across 2 new test files
- **Diff**: 100 lines across 3 modified/new source files + 2 test files

## Raw Diff

See `raw.diff` in this directory for the complete diff.
