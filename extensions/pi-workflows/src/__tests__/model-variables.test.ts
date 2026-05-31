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
