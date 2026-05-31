---
id: debug
name: Debug
version: 1.0.0
triggers: [debug, investigate bug, troubleshoot, fix bug, diagnose, slow, slower, performance, not working, broken, fails, failing, error, bug, issue, problem]
tags: [debugging, troubleshooting, bugs]
tools_required: [read, bash, grep, find]
providers: [ollama, claude, openai, gemini]
estimated_turns: 5-10
---

# Debug

## Purpose
Systematic debugging workflow: reproduce, isolate, fix, verify.

## Instructions

### 1. Reproduce
- Understand the reported symptom
- Find or write a minimal reproduction (test case, curl command, script)
- Confirm the bug exists: run the repro and observe the failure

### 2. Isolate
- Read error messages, stack traces, logs
- Use grep to find the relevant code paths
- Trace the execution flow from entry point to failure
- Narrow down to the smallest code change that causes the issue
- Check git log for recent changes in the affected area

### 3. Fix
- Make the minimal change that fixes the root cause
- Do NOT fix symptoms — find why the wrong behavior occurs
- Consider edge cases the fix might affect

### 4. Verify
- Run the reproduction again — confirm it passes
- Run existing tests if available
- Check for regressions in related functionality
- Document what was wrong and why the fix works

## Output Format

```
## Bug Analysis
- **Symptom**: What the user observed
- **Root Cause**: Why it happened (cite file:line)
- **Fix**: What was changed and why
- **Verification**: How we confirmed the fix
- **Risk**: Any regression risk from this change
```
