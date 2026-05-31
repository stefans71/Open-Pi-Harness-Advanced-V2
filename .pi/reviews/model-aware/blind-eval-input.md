# Blind Evaluation — Model-Aware Workflow Variable Injection

## Task Description

A YAML workflow engine executes multi-step workflows for a local LLM coding agent. Each workflow consists of typed nodes (prompt, bash, approval, loop) executed via a `WorkflowExecutor` class. The executor has a `resolveVariables()` method that substitutes `$VARIABLE` placeholders in node prompts before sending them to the LLM.

The task: detect the running model's capabilities at workflow start and expose five new template variables (`$MODEL_ID`, `$MODEL_NAME`, `$MODEL_SIZE`, `$MODEL_CONTEXT`, `$MODEL_VISION`) that any workflow can use. A web-design workflow uses these variables in its review and rework nodes to adapt critique behavior based on model size — smaller models should focus on structural correctness rather than subjective design critique, because testing showed self-critique at small model sizes degrades output quality.

**Specification:**

1. Create a `getModelProfile()` utility that accepts a model metadata object and returns a structured profile with a size classification:
   - `<9B` parameters → `"small"`
   - `9B–35B` → `"medium"`
   - `36B+` → `"large"`
   - No size marker found → `"unknown"`
   - Size is inferred by extracting the numeric `XB` pattern from the model's id or name string
   - Vision support detected from an `input` array containing `"image"`
   - Reasoning support detected from a boolean `reasoning` field

2. Integrate into the executor:
   - Detect model at workflow start using the extension context's `model` property
   - Log model metadata (id, sizeClass, contextWindow, supportsVision) in the `workflow_start` event
   - Add the five `$MODEL_*` variables to `resolveVariables()` so all 13 workflows get them automatically

3. Update the web-design workflow's review and rework nodes with MODEL AWARENESS sections that provide size-specific guidance, including an `unknown` fallback branch

4. Test the model profile utility and variable substitution patterns

---

## File 1: `extensions/pi-workflows/src/model-info.ts` (NEW)

```typescript
export interface ModelProfile {
	id: string;
	name: string;
	contextWindow: number;
	supportsVision: boolean;
	supportsReasoning: boolean;
	sizeClass: "small" | "medium" | "large" | "unknown";
}

function inferSizeClass(text: string): ModelProfile["sizeClass"] {
	const match = text.match(/\b(\d+(?:\.\d+)?)\s*b\b/i);
	if (!match) return "unknown";
	const billions = parseFloat(match[1]);
	if (billions < 9) return "small";
	if (billions <= 35) return "medium";
	return "large";
}

export function getModelProfile(model?: {
	id?: string;
	name?: string;
	contextWindow?: number;
	input?: string[];
	reasoning?: boolean;
}): ModelProfile {
	if (!model) {
		return {
			id: "unknown",
			name: "Unknown Model",
			contextWindow: 0,
			supportsVision: false,
			supportsReasoning: false,
			sizeClass: "unknown",
		};
	}

	const idAndName = `${model.id ?? ""} ${model.name ?? ""}`;
	const sizeClass = inferSizeClass(idAndName);

	return {
		id: model.id ?? "unknown",
		name: model.name ?? model.id ?? "Unknown Model",
		contextWindow: model.contextWindow ?? 0,
		supportsVision: Array.isArray(model.input) && model.input.includes("image"),
		supportsReasoning: model.reasoning ?? false,
		sizeClass,
	};
}
```

---

## File 2: `extensions/pi-workflows/src/executor.ts` (MODIFIED — 4 insertion sites)

### 2a. Import (line 121)

```typescript
import { getModelProfile, type ModelProfile } from "./model-info.js";
```

### 2b. Class property (line 171)

```typescript
private modelProfile: ModelProfile | null = null;
```

### 2c. Model detection in `run()` method (lines 291–292, after `__piWorkflowRunning = true`)

```typescript
const ctxWithModel = initialCtx as { model?: { id?: string; name?: string; contextWindow?: number; input?: string[]; reasoning?: boolean } };
this.modelProfile = getModelProfile(ctxWithModel.model);
```

### 2d. Model fields added to `workflowStartPayload` (lines 302–305)

```typescript
const workflowStartPayload = {
    event: "workflow_start",
    workflow: workflow.name,
    description: workflow.description,
    nodeCount: workflow.nodes.length,
    userMessage,
    artifactsDir: this.artifactsDir,
    timestamp: Date.now(),
    model: this.modelProfile.id,
    modelSize: this.modelProfile.sizeClass,
    modelContext: this.modelProfile.contextWindow,
    modelVision: this.modelProfile.supportsVision,
};
```

### 2e. Variable substitution in `resolveVariables()` (lines 1468–1475, after `$ITERATION` and before `$nodeId.output`)

```typescript
if (this.modelProfile) {
    result = result
        .replace(/\$MODEL_ID\b/g, this.modelProfile.id)
        .replace(/\$MODEL_NAME\b/g, this.modelProfile.name)
        .replace(/\$MODEL_SIZE\b/g, this.modelProfile.sizeClass)
        .replace(/\$MODEL_CONTEXT\b/g, String(this.modelProfile.contextWindow))
        .replace(/\$MODEL_VISION\b/g, String(this.modelProfile.supportsVision));
}
```

---

## File 3: `.pi/workflows/web-design.yaml` (MODIFIED — 2 insertion sites)

### 3a. Review node — MODEL AWARENESS section (inserted after the scoring rubric, before the write instruction)

```yaml
      MODEL AWARENESS:
      You are running as $MODEL_NAME (size: $MODEL_SIZE, context: $MODEL_CONTEXT tokens, vision: $MODEL_VISION).

      Adapt your review depth to your capabilities:
      - small (sub-9B): focus on structural correctness (HTML semantics, prop types, token usage,
        build passes). Skip nuanced visual design critique — flag items you are uncertain about and
        recommend the user verify visually or with a larger model.
      - medium (9B-35B): full design conformance review including domain-specificity, intent
        alignment, color harmony, and spacing rhythm.
      - large (36B+): full review plus architectural critique (component composition, state
        management patterns, performance implications).
      - unknown: treat as medium — give full review but note that model capabilities could not
        be determined, so visual/subjective assessments may be less reliable.

      If $ARTIFACTS_DIR/vl-critique.md exists (from a vision model): incorporate those
      visual findings into your scoring.
```

### 3b. Rework node — MODEL AWARENESS section (inserted after the fix instructions, before the completion line)

```yaml
        MODEL AWARENESS:
        You are $MODEL_NAME (size: $MODEL_SIZE).
        - small (sub-9B): fix only concrete FAIL items (TypeScript errors, missing tokens, wrong
          HTML elements). Do not attempt subjective design improvements — self-critique at this
          size tends to degrade output quality.
        - medium or large (9B+): fix all FAIL items and improve WARN items where you are
          confident in the improvement.
        - unknown: fix FAIL items. Attempt WARN improvements but flag uncertainty.
```

---

## File 4: `extensions/pi-workflows/src/__tests__/model-info.test.ts` (NEW)

```typescript
import { describe, it, expect } from "vitest";
import { getModelProfile } from "../model-info.js";

describe("getModelProfile", () => {
	it("returns unknown for undefined model", () => {
		const p = getModelProfile(undefined);
		expect(p.sizeClass).toBe("unknown");
		expect(p.supportsVision).toBe(false);
		expect(p.id).toBe("unknown");
	});

	it("detects small models (<9B)", () => {
		expect(getModelProfile({ id: "qwen3-8b" }).sizeClass).toBe("small");
		expect(getModelProfile({ id: "llama-3.1-4b" }).sizeClass).toBe("small");
		expect(getModelProfile({ id: "phi-3-3.8b" }).sizeClass).toBe("small");
		expect(getModelProfile({ id: "qwen-1.5b" }).sizeClass).toBe("small");
		expect(getModelProfile({ id: "custom-8.5b" }).sizeClass).toBe("small");
	});

	it("detects medium models (9B-35B)", () => {
		expect(getModelProfile({ id: "qwen3.6-27b-mtp" }).sizeClass).toBe("medium");
		expect(getModelProfile({ id: "deepseek-v4-32b" }).sizeClass).toBe("medium");
		expect(getModelProfile({ id: "qwen-14b" }).sizeClass).toBe("medium");
		expect(getModelProfile({ id: "llama-10b" }).sizeClass).toBe("medium");
		expect(getModelProfile({ id: "codellama-13b" }).sizeClass).toBe("medium");
		expect(getModelProfile({ id: "llama-9b" }).sizeClass).toBe("medium");
	});

	it("detects large models (36B+)", () => {
		expect(getModelProfile({ id: "llama-70b" }).sizeClass).toBe("large");
		expect(getModelProfile({ id: "qwen-72b" }).sizeClass).toBe("large");
		expect(getModelProfile({ id: "deepseek-v3-671b" }).sizeClass).toBe("large");
	});

	it("returns unknown when no size marker in id or name", () => {
		expect(getModelProfile({ id: "gpt-4o" }).sizeClass).toBe("unknown");
		expect(getModelProfile({ id: "claude-sonnet" }).sizeClass).toBe("unknown");
	});

	it("detects vision support from input array", () => {
		expect(getModelProfile({ id: "qwen-vl-8b", input: ["text", "image"] }).supportsVision).toBe(true);
		expect(getModelProfile({ id: "qwen-8b", input: ["text"] }).supportsVision).toBe(false);
		expect(getModelProfile({ id: "qwen-8b" }).supportsVision).toBe(false);
	});

	it("uses name for size when id has no size marker", () => {
		expect(getModelProfile({ id: "my-model", name: "Custom 27B Fine-tune" }).sizeClass).toBe("medium");
	});

	it("detects reasoning support", () => {
		expect(getModelProfile({ id: "qwen-8b", reasoning: true }).supportsReasoning).toBe(true);
		expect(getModelProfile({ id: "qwen-8b", reasoning: false }).supportsReasoning).toBe(false);
	});

	it("uses first size match (MoE compound names hit first number)", () => {
		expect(getModelProfile({ id: "deepseek-moe-8b-671b" }).sizeClass).toBe("small");
	});
});
```

---

## File 5: `extensions/pi-workflows/src/__tests__/model-variables.test.ts` (NEW)

```typescript
import { describe, it, expect } from "vitest";

describe("model variable substitution", () => {
	it("resolves $MODEL_ID in prompt text", () => {
		const text = "You are $MODEL_ID running at $MODEL_SIZE";
		const result = text
			.replace(/\$MODEL_ID\b/g, "qwen3.6-27b-mtp")
			.replace(/\$MODEL_SIZE\b/g, "medium");
		expect(result).toBe("You are qwen3.6-27b-mtp running at medium");
	});

	it("resolves all five $MODEL_ variables", () => {
		const text = "$MODEL_ID $MODEL_NAME $MODEL_SIZE $MODEL_CONTEXT $MODEL_VISION";
		const result = text
			.replace(/\$MODEL_ID\b/g, "qwen3-8b")
			.replace(/\$MODEL_NAME\b/g, "Qwen3 8B")
			.replace(/\$MODEL_SIZE\b/g, "small")
			.replace(/\$MODEL_CONTEXT\b/g, "32768")
			.replace(/\$MODEL_VISION\b/g, "false");
		expect(result).toBe("qwen3-8b Qwen3 8B small 32768 false");
	});

	it("leaves $MODEL_ variables untouched when no profile set", () => {
		const text = "Model: $MODEL_NAME";
		expect(text).toContain("$MODEL_NAME");
	});

	it("does not replace partial matches like $MODEL_IDENTITY", () => {
		const text = "$MODEL_IDENTITY should stay";
		const result = text.replace(/\$MODEL_ID\b/g, "replaced");
		expect(result).toBe("$MODEL_IDENTITY should stay");
	});
});
```

---

## Evaluation Rubric

Score each dimension 1–5 (1 = major issues, 5 = excellent). Provide specific evidence for each score.

### 1. Correctness
Does the code do what the specification requires? Are there logic errors, off-by-one mistakes, or runtime failure paths?

### 2. Spec Fidelity
Does the implementation match every point in the specification? Are there missing features, extra features, or deviations from the stated requirements?

### 3. Code Quality
Is the code clean, idiomatic, and maintainable? Are types used correctly? Is there unnecessary complexity, duplication, or dead code?

### 4. Integration
Does the code integrate cleanly with the existing codebase? Does it follow established patterns (variable substitution, event logging, YAML prompt structure)? Are there breaking changes or side effects?

### 5. Test Coverage
Do the tests cover the critical paths, edge cases, and boundary conditions? Are there untested scenarios that could fail in production?

---

**Output format:** For each dimension, provide the score and 2–3 sentences of evidence. End with an overall assessment: PASS (no dimension below 3, average >= 4) or FAIL (any dimension below 3, or average < 4).
