import { describe, it, expect, vi } from "vitest";
import { ContextInjector } from "../src/context-injector.js";
import type { RetrievalConfig } from "../src/config.js";

function createMockEmbedder() {
	return {
		embed: vi.fn().mockResolvedValue(new Float32Array(768)),
		embedBatch: vi.fn(),
		getStats: vi.fn(),
		shutdown: vi.fn(),
	};
}

function createMockStore(facts: Array<{ id: string; content: string; score: number; importance: number }> = []) {
	return {
		initialize: vi.fn(),
		storeFact: vi.fn(),
		searchFacts: vi.fn().mockReturnValue(
			facts.map((f) => ({
				id: f.id,
				content: f.content,
				source: "manual" as const,
				importance: f.importance,
				createdAt: "",
				lastAccessed: "",
				accessCount: 0,
				score: f.score,
			})),
		),
		deleteFact: vi.fn(),
		getStats: vi.fn(),
		close: vi.fn(),
	};
}

const defaultConfig: RetrievalConfig = {
	topK: 8,
	similarityThreshold: 0.6,
	maxTokensBudget: 2000,
};

describe("ContextInjector", () => {
	describe("retrieve", () => {
		it("uses constructor config when no override provided", async () => {
			const store = createMockStore([{ id: "1", content: "test fact", score: 0.8, importance: 0.7 }]);
			const injector = new ContextInjector(createMockEmbedder() as any, store as any, defaultConfig);

			await injector.retrieve("test prompt");
			expect(store.searchFacts).toHaveBeenCalledWith(expect.any(Float32Array), 8);
		});

		it("uses override topK when provided", async () => {
			const store = createMockStore([{ id: "1", content: "test fact", score: 0.8, importance: 0.7 }]);
			const injector = new ContextInjector(createMockEmbedder() as any, store as any, defaultConfig);

			const override: RetrievalConfig = { topK: 4, similarityThreshold: 0.6, maxTokensBudget: 1000 };
			await injector.retrieve("test prompt", override);
			expect(store.searchFacts).toHaveBeenCalledWith(expect.any(Float32Array), 4);
		});

		it("uses override similarityThreshold for filtering", async () => {
			const facts = [
				{ id: "1", content: "high relevance", score: 0.9, importance: 0.8 },
				{ id: "2", content: "low relevance", score: 0.5, importance: 0.8 },
			];
			const store = createMockStore(facts);
			const injector = new ContextInjector(createMockEmbedder() as any, store as any, defaultConfig);

			const override: RetrievalConfig = { topK: 8, similarityThreshold: 0.8, maxTokensBudget: 2000 };
			const results = await injector.retrieve("test", override);
			expect(results).toHaveLength(1);
			expect(results[0].content).toBe("high relevance");
		});
	});

	describe("formatMemoryBlock", () => {
		it("uses constructor budget when no override provided", () => {
			const injector = new ContextInjector(createMockEmbedder() as any, createMockStore() as any, {
				...defaultConfig,
				maxTokensBudget: 50,
			});

			const facts = [
				{ id: "1", content: "A".repeat(200), source: "manual" as const, importance: 0.8, createdAt: "", lastAccessed: "", accessCount: 0, score: 0.9 },
				{ id: "2", content: "B".repeat(200), source: "manual" as const, importance: 0.7, createdAt: "", lastAccessed: "", accessCount: 0, score: 0.8 },
			];

			const block = injector.formatMemoryBlock(facts);
			const lines = block.split("\n").filter((l) => l.startsWith("- "));
			expect(lines.length).toBeLessThan(2);
		});

		it("uses override budget when provided", () => {
			const injector = new ContextInjector(createMockEmbedder() as any, createMockStore() as any, defaultConfig);

			const facts = [
				{ id: "1", content: "A".repeat(200), source: "manual" as const, importance: 0.8, createdAt: "", lastAccessed: "", accessCount: 0, score: 0.9 },
				{ id: "2", content: "B".repeat(200), source: "manual" as const, importance: 0.7, createdAt: "", lastAccessed: "", accessCount: 0, score: 0.8 },
			];

			const block = injector.formatMemoryBlock(facts, 50);
			const lines = block.split("\n").filter((l) => l.startsWith("- "));
			expect(lines.length).toBeLessThan(2);
		});

		it("includes all facts when budget is large", () => {
			const injector = new ContextInjector(createMockEmbedder() as any, createMockStore() as any, defaultConfig);

			const facts = [
				{ id: "1", content: "Short fact A", source: "manual" as const, importance: 0.8, createdAt: "", lastAccessed: "", accessCount: 0, score: 0.9 },
				{ id: "2", content: "Short fact B", source: "manual" as const, importance: 0.7, createdAt: "", lastAccessed: "", accessCount: 0, score: 0.8 },
			];

			const block = injector.formatMemoryBlock(facts, 10000);
			const lines = block.split("\n").filter((l) => l.startsWith("- "));
			expect(lines).toHaveLength(2);
		});

		it("returns empty string for empty facts array", () => {
			const injector = new ContextInjector(createMockEmbedder() as any, createMockStore() as any, defaultConfig);
			expect(injector.formatMemoryBlock([])).toBe("");
		});
	});
});
