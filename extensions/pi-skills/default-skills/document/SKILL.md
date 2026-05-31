---
id: document
name: Document
version: 1.0.0
triggers: [document, add docs, write documentation, docstring, jsdoc, explain code]
tags: [documentation, docs, comments]
tools_required: [read, grep, find]
providers: [ollama, claude, openai, gemini]
estimated_turns: 3-5
---

# Document

## Purpose
Generate clear, concise documentation for code: inline comments, JSDoc/docstrings, README sections, or API docs.

## Instructions

### 1. Understand the Target
- Read the files or functions to document
- Identify the public API surface (exports, public methods, types)
- Check existing documentation style in the project

### 2. Write Documentation
- Match the project's existing doc style (JSDoc, TSDoc, Python docstrings, etc.)
- Document **why**, not **what** — the code shows what
- For functions: purpose, parameters, return value, throws/errors, example if non-obvious
- For modules/files: one-line summary, key exports, usage pattern
- For types/interfaces: purpose and when to use, not field-by-field restating

### 3. Review
- Verify accuracy against the actual implementation
- Remove redundant docs that just restate the type signature
- Ensure examples compile/run if provided

## Output Format

```
## Documentation Added
- **Scope**: What was documented (file, module, function list)
- **Style**: Doc format used (JSDoc, docstrings, markdown, etc.)
- **Notes**: Any ambiguities found or assumptions made
```

## Provider Notes

### Ollama (local models)
- Process one file at a time for large codebases
- Keep doc strings concise — local models work better with shorter outputs
