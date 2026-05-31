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
