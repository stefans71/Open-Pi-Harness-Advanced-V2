import { describe, it, expect } from "vitest";
import { adjustForContext, type MemoryConfig } from "../src/config.js";

function makeConfig(overrides?: Partial<MemoryConfig["retrieval"]> & { thresholds?: Partial<MemoryConfig["adaptiveRetrieval"]["contextThresholds"]> }): MemoryConfig {
	return {
		shared: { generationUrl: "", embeddingUrl: "", embeddingDimension: 768 },
		embedding: { model: "test" },
		retrieval: {
			topK: overrides?.topK ?? 8,
			similarityThreshold: overrides?.similarityThreshold ?? 0.6,
			maxTokensBudget: overrides?.maxTokensBudget ?? 2000,
		},
		extraction: { model: "test", minImportance: 0.3, maxFactsPerCompaction: 20 },
		storage: { dbPath: ":memory:", maxFacts: 100, decayEnabled: false, decayHalfLifeDays: 90 },
		vram: { warningThresholdGB: 28, enabled: false },
		nudge: { enabled: false, intervalTurns: 5 },
		adaptiveRetrieval: {
			enabled: true,
			contextThresholds: {
				moderate: overrides?.thresholds?.moderate ?? 0.6,
				aggressive: overrides?.thresholds?.aggressive ?? 0.8,
			},
		},
	};
}

describe("adjustForContext", () => {
	it("returns defaults unchanged when context usage is below moderate threshold", () => {
		const config = makeConfig();
		const result = adjustForContext(config, 0.5);
		expect(result.topK).toBe(8);
		expect(result.maxTokensBudget).toBe(2000);
		expect(result.similarityThreshold).toBe(0.6);
	});

	it("returns defaults unchanged when context usage is 0", () => {
		const config = makeConfig();
		const result = adjustForContext(config, 0);
		expect(result.topK).toBe(8);
		expect(result.maxTokensBudget).toBe(2000);
	});

	it("applies moderate reduction when usage is between moderate and aggressive", () => {
		const config = makeConfig();
		const result = adjustForContext(config, 0.65);
		expect(result.topK).toBe(6);
		expect(result.maxTokensBudget).toBe(1500);
	});

	it("applies aggressive reduction when usage exceeds aggressive threshold", () => {
		const config = makeConfig();
		const result = adjustForContext(config, 0.85);
		expect(result.topK).toBe(4);
		expect(result.maxTokensBudget).toBe(1000);
	});

	it("applies aggressive reduction at context usage of 1.0", () => {
		const config = makeConfig();
		const result = adjustForContext(config, 1.0);
		expect(result.topK).toBe(4);
		expect(result.maxTokensBudget).toBe(1000);
	});

	it("enforces minimum floor of 2 for topK under aggressive", () => {
		const config = makeConfig({ topK: 3 });
		const result = adjustForContext(config, 0.9);
		expect(result.topK).toBe(2);
	});

	it("enforces minimum floor of 4 for topK under moderate", () => {
		const config = makeConfig({ topK: 4 });
		const result = adjustForContext(config, 0.65);
		expect(result.topK).toBe(4);
	});

	it("enforces minimum floor of 500 for budget under aggressive", () => {
		const config = makeConfig({ maxTokensBudget: 800 });
		const result = adjustForContext(config, 0.9);
		expect(result.maxTokensBudget).toBe(500);
	});

	it("enforces minimum floor of 1000 for budget under moderate", () => {
		const config = makeConfig({ maxTokensBudget: 1200 });
		const result = adjustForContext(config, 0.65);
		expect(result.maxTokensBudget).toBe(1000);
	});

	it("uses custom thresholds from config", () => {
		const config = makeConfig({ thresholds: { moderate: 0.5, aggressive: 0.7 } });

		const belowModerate = adjustForContext(config, 0.45);
		expect(belowModerate.topK).toBe(8);

		const moderate = adjustForContext(config, 0.55);
		expect(moderate.topK).toBe(6);

		const aggressive = adjustForContext(config, 0.75);
		expect(aggressive.topK).toBe(4);
	});

	it("does not mutate the original config", () => {
		const config = makeConfig();
		const originalTopK = config.retrieval.topK;
		adjustForContext(config, 0.9);
		expect(config.retrieval.topK).toBe(originalTopK);
	});

	it("preserves similarityThreshold unchanged", () => {
		const config = makeConfig({ similarityThreshold: 0.7 });
		const result = adjustForContext(config, 0.9);
		expect(result.similarityThreshold).toBe(0.7);
	});

	it("returns defaults at exactly the moderate threshold boundary", () => {
		const config = makeConfig();
		const result = adjustForContext(config, 0.6);
		expect(result.topK).toBe(8);
		expect(result.maxTokensBudget).toBe(2000);
	});

	it("applies moderate at just above the moderate threshold", () => {
		const config = makeConfig();
		const result = adjustForContext(config, 0.601);
		expect(result.topK).toBe(6);
	});

	it("applies aggressive at just above the aggressive threshold", () => {
		const config = makeConfig();
		const result = adjustForContext(config, 0.801);
		expect(result.topK).toBe(4);
	});
});
