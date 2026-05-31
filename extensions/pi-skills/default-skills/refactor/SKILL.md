---
id: refactor
name: Refactor
version: 1.0.0
triggers: [refactor, clean up, simplify, restructure, extract, inline, rename]
tags: [refactoring, cleanup, code-quality]
tools_required: [read, bash, grep, find]
providers: [ollama, claude, openai, gemini]
estimated_turns: 5-10
---

# Refactor

## Purpose
Improve code structure without changing behavior. Extract, inline, rename, simplify.

## Instructions

### 1. Understand Current State
- Read the target code
- Identify all callers and dependents via grep
- Run existing tests if available to establish a baseline

### 2. Plan the Refactor
- State the specific smell or problem (duplication, long function, unclear naming, etc.)
- Describe the target structure
- List files that will change
- Confirm the plan before making changes

### 3. Execute
- Make one refactoring move at a time
- Preserve behavior exactly — no feature changes, no bug fixes mixed in
- Update all call sites when renaming or moving
- Keep each change small enough to verify

### 4. Verify
- Run tests after each change
- If no tests exist, manually verify key paths
- Check that all references are updated (grep for old names)

## Output Format

```
## Refactor Summary
- **Problem**: What was wrong with the structure
- **Changes**: List of structural changes made
- **Files Modified**: List of files touched
- **Verification**: How behavior preservation was confirmed
- **Risk**: Any areas that need manual testing
```

## Provider Notes

### Ollama (local models)
- Break large refactors into small sequential steps
- Verify after each step before proceeding to the next
- Prefer explicit rename-and-update over clever abstractions
