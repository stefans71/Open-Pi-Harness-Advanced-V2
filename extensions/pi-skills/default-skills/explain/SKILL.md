---
id: explain
name: Explain
version: 1.0.0
triggers: [explain, how does this work, walk me through, what does this do, understand]
tags: [explanation, learning, understanding]
tools_required: [read, grep, find]
providers: [ollama, claude, openai, gemini]
estimated_turns: 2-4
---

# Explain

## Purpose
Explain code, architecture, or concepts clearly, calibrated to the user's level.

## Instructions

### 1. Identify What to Explain
- Read the target code or find it via grep/find
- Determine scope: single function, module, data flow, or architecture

### 2. Build the Explanation
- Start with a one-sentence summary of what it does and why it exists
- Walk through the logic in execution order, not source order
- Highlight non-obvious parts: implicit behavior, edge cases, performance characteristics
- Use analogies only when they genuinely clarify
- Reference specific file:line for each concept

### 3. Calibrate Depth
- If the user asks "how does X work" — explain the mechanism
- If the user asks "what does X do" — explain the behavior
- If the user asks "why does X" — explain the design decision
- Skip basics the user clearly already knows

## Output Format

```
## Explanation: [topic]

**Summary**: One-line what and why.

**How it works**:
[Numbered steps or prose, with file:line references]

**Key details**:
[Non-obvious behaviors, gotchas, or design choices]
```

## Provider Notes

### Ollama (local models)
- For complex explanations, break into focused sub-questions across turns
- Ask for clarification on scope rather than guessing
