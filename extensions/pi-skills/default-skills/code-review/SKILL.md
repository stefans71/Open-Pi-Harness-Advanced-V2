---
id: code-review
name: Code Review
version: 1.0.0
triggers: [review, code review, check code, analyze code, security review]
tags: [code, quality, security, review]
tools_required: [read, grep, find]
providers: [ollama, claude, openai, gemini]
estimated_turns: 3-5
---

# Code Review

## Purpose
Perform structured code review covering security, performance, correctness, and style.

## Instructions

When activated, follow these phases:

### 1. Gather Context
- Read the target files
- Check git diff if available (`git diff --cached` or `git diff HEAD~1`)
- Understand the project structure via grep/find

### 2. Security Review
- Check for injection vulnerabilities (SQL, command, XSS)
- Validate input sanitization at system boundaries
- Review authentication and authorization logic
- Check for hardcoded secrets or credentials
- Review error messages for information leakage

### 3. Correctness Review
- Trace logic paths for edge cases
- Check null/undefined handling
- Verify error handling covers failure modes
- Look for off-by-one errors in loops and slices
- Check race conditions in async code

### 4. Performance Review
- Identify N+1 query patterns
- Check for unnecessary allocations in hot paths
- Review loop complexity (nested loops, large iterations)
- Flag blocking operations in async contexts

### 5. Style Review
- Check naming consistency
- Verify function length (flag > 50 lines)
- Look for dead code or unused imports
- Check comment quality (prefer none over wrong)

## Output Format

```
## Review Summary
[One-line assessment: APPROVE / REQUEST CHANGES / BLOCK]

## Critical Issues
[Must fix before merge — security, correctness, data loss risks]

## Warnings
[Should fix — performance, maintainability, edge cases]

## Suggestions
[Nice to have — style, naming, minor improvements]

## Positive Notes
[What's done well — acknowledge good patterns]
```

## Provider Notes

### Ollama (local models)
- May need to chunk large files (> 500 lines) — read in sections
- Focus on one analysis phase per turn to stay within context

### Claude / GPT
- Can handle larger context in single pass
- Use extended thinking for complex security analysis
