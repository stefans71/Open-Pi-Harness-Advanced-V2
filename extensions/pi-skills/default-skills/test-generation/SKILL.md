---
id: test-generation
name: Test Generation
version: 1.0.0
triggers: [write tests, add tests, test this, generate tests, unit test, integration test]
tags: [testing, unit-tests, test-generation]
tools_required: [read, bash, grep, find]
providers: [ollama, claude, openai, gemini]
estimated_turns: 5-8
---

# Test Generation

## Purpose
Generate focused, useful tests for existing code: unit tests, integration tests, or edge-case coverage.

## Instructions

### 1. Analyze the Target
- Read the code to test
- Identify the testing framework already in use (vitest, jest, pytest, go test, etc.)
- Check existing test patterns in the project for style conventions
- Map the public API surface and key code paths

### 2. Design Test Cases
- **Happy path**: Normal usage with expected inputs
- **Edge cases**: Empty inputs, boundary values, null/undefined
- **Error paths**: Invalid inputs, failure modes, thrown errors
- **Integration points**: Interactions with dependencies (mock or real, matching project convention)

### 3. Write Tests
- Follow the project's existing test style and naming conventions
- One assertion per test when possible — name describes the behavior
- Use descriptive test names: "returns empty array when no results found"
- Arrange-Act-Assert structure
- Mock only at system boundaries, not internal functions

### 4. Verify
- Run the tests — all should pass
- Check coverage if tooling is available
- Verify tests actually fail when the behavior is broken (mutation check)

## Output Format

```
## Tests Generated
- **Target**: What code was tested
- **Framework**: Test framework used
- **Tests Written**: Count and summary of test cases
- **Coverage**: Key paths covered and any intentional gaps
- **Run Command**: How to execute these tests
```

## Provider Notes

### Ollama (local models)
- Generate tests in batches of 3-5 to stay within context
- Run each batch before writing the next
- Prefer simple assertion styles over complex matchers
