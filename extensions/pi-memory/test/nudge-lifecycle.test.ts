import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/config.js", () => {
	const defaults = {
		shared: { generationUrl: "", embeddingUrl: "", embeddingDimension: 768 },
		embedding: { model: "test" },
		retrieval: { topK: 8, similarityThreshold: 0.6, maxTokensBudget: 2000 },
		extraction: { model: "test", minImportance: 0.3, maxFactsPerCompaction: 20 },
		storage: { dbPath: ":memory:", maxFacts: 100, decayEnabled: false, decayHalfLifeDays: 90 },
		vram: { warningThresholdGB: 28, enabled: false },
		nudge: { enabled: true, intervalTurns: 3 },
		adaptiveRetrieval: { enabled: false, contextThresholds: { moderate: 0.6, aggressive: 0.8 } },
	};
	return {
		loadConfig: vi.fn(() => ({ ...defaults })),
		adjustForContext: vi.fn((config: any) => config.retrieval),
	};
});

vi.mock("../src/memory-store.js", () => ({
	MemoryStore: class {
		initialize = vi.fn();
		storeFact = vi.fn().mockReturnValue("test-id");
		searchFacts = vi.fn().mockReturnValue([]);
		close = vi.fn();
	},
}));

vi.mock("../src/embedding.js", () => ({
	EmbeddingClient: class {
		embed = vi.fn().mockResolvedValue(new Float32Array(768));
		shutdown = vi.fn();
	},
}));

vi.mock("../src/fact-extractor.js", () => ({
	FactExtractor: class {
		extractAndStore = vi.fn().mockResolvedValue(0);
	},
}));

vi.mock("../src/context-injector.js", () => ({
	ContextInjector: class {
		retrieve = vi.fn().mockResolvedValue([]);
		formatMemoryBlock = vi.fn().mockReturnValue("");
	},
}));

vi.mock("../src/vram-monitor.js", () => ({
	VramMonitor: class {
		check = vi.fn().mockResolvedValue({ warning: false, message: "", models: [], totalVramGB: 0 });
	},
}));

describe("nudge lifecycle", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	async function setupExtension(configOverride?: Record<string, any>) {
		if (configOverride) {
			const { loadConfig } = await import("../src/config.js");
			(loadConfig as any).mockReturnValue({
				shared: { generationUrl: "", embeddingUrl: "", embeddingDimension: 768 },
				embedding: { model: "test" },
				retrieval: { topK: 8, similarityThreshold: 0.6, maxTokensBudget: 2000 },
				extraction: { model: "test", minImportance: 0.3, maxFactsPerCompaction: 20 },
				storage: { dbPath: ":memory:", maxFacts: 100, decayEnabled: false, decayHalfLifeDays: 90 },
				vram: { warningThresholdGB: 28, enabled: false },
				nudge: { enabled: true, intervalTurns: 3 },
				adaptiveRetrieval: { enabled: false, contextThresholds: { moderate: 0.6, aggressive: 0.8 } },
				...configOverride,
			});
		}

		const { default: factory } = await import("../src/index.js");

		const handlers: Record<string, Array<(...args: any[]) => any>> = {};
		const registeredTools: Array<{ name: string; execute: (...args: any[]) => any }> = [];

		const mockPi = {
			on: vi.fn((event: string, handler: (...args: any[]) => any) => {
				if (!handlers[event]) handlers[event] = [];
				handlers[event].push(handler);
			}),
			registerCommand: vi.fn(),
			registerTool: vi.fn((tool: any) => {
				registeredTools.push(tool);
			}),
			sendMessage: vi.fn(),
		} as any;

		factory(mockPi);

		return { mockPi, handlers, registeredTools };
	}

	async function fireSessionStart(handlers: Record<string, Array<(...args: any[]) => any>>) {
		for (const h of handlers["session_start"] ?? []) {
			await h();
		}
	}

	async function fireBeforeAgentStart(handlers: Record<string, Array<(...args: any[]) => any>>, prompt = "test") {
		const event = { prompt, systemPrompt: "base", systemPromptOptions: {} };
		const ctx = { getContextUsage: () => undefined };
		const results: any[] = [];
		for (const h of handlers["before_agent_start"] ?? []) {
			const r = await h(event, ctx);
			if (r) results.push(r);
		}
		return results;
	}

	it("does not nudge before reaching the interval", async () => {
		const { handlers } = await setupExtension();
		await fireSessionStart(handlers);

		const r1 = await fireBeforeAgentStart(handlers);
		const r2 = await fireBeforeAgentStart(handlers);

		for (const results of [r1, r2]) {
			const hasNudge = results.some((r) => r.systemPrompt?.includes("[MEMORY NUDGE]"));
			expect(hasNudge).toBe(false);
		}
	});

	it("nudges at the interval boundary", async () => {
		const { handlers } = await setupExtension();
		await fireSessionStart(handlers);

		await fireBeforeAgentStart(handlers);
		await fireBeforeAgentStart(handlers);
		const r3 = await fireBeforeAgentStart(handlers);

		const hasNudge = r3.some((r: any) => r.systemPrompt?.includes("[MEMORY NUDGE]"));
		expect(hasNudge).toBe(true);
	});

	it("includes turn count in nudge text", async () => {
		const { handlers } = await setupExtension();
		await fireSessionStart(handlers);

		await fireBeforeAgentStart(handlers);
		await fireBeforeAgentStart(handlers);
		const r3 = await fireBeforeAgentStart(handlers);

		const nudgeResult = r3.find((r: any) => r.systemPrompt?.includes("[MEMORY NUDGE]"));
		expect(nudgeResult.systemPrompt).toContain("3 turns");
	});

	it("nudges again at the next interval", async () => {
		const { handlers } = await setupExtension();
		await fireSessionStart(handlers);

		for (let i = 0; i < 5; i++) {
			await fireBeforeAgentStart(handlers);
		}
		const r6 = await fireBeforeAgentStart(handlers);

		const hasNudge = r6.some((r: any) => r.systemPrompt?.includes("[MEMORY NUDGE]"));
		expect(hasNudge).toBe(true);
	});

	it("resets turn counter on session_start", async () => {
		const { handlers } = await setupExtension();
		await fireSessionStart(handlers);

		await fireBeforeAgentStart(handlers);
		await fireBeforeAgentStart(handlers);

		await fireSessionStart(handlers);

		const r1 = await fireBeforeAgentStart(handlers);
		const hasNudge = r1.some((r: any) => r.systemPrompt?.includes("[MEMORY NUDGE]"));
		expect(hasNudge).toBe(false);
	});

	it("does not nudge when nudge is disabled", async () => {
		const { handlers } = await setupExtension({ nudge: { enabled: false, intervalTurns: 3 } });
		await fireSessionStart(handlers);

		await fireBeforeAgentStart(handlers);
		await fireBeforeAgentStart(handlers);
		const r3 = await fireBeforeAgentStart(handlers);

		const hasNudge = r3.some((r: any) => r.systemPrompt?.includes("[MEMORY NUDGE]"));
		expect(hasNudge).toBe(false);
	});

	it("registers pi_remember tool on session_start", async () => {
		const { handlers, registeredTools } = await setupExtension();
		expect(registeredTools).toHaveLength(0);

		await fireSessionStart(handlers);

		expect(registeredTools).toHaveLength(1);
		expect(registeredTools[0].name).toBe("pi_remember");
	});

	it("pi_remember tool stores a fact via embedder and store", async () => {
		const { handlers, registeredTools } = await setupExtension();
		await fireSessionStart(handlers);

		const tool = registeredTools[0];
		const result = await tool.execute("call-1", { fact: "user prefers dark mode" });

		expect(result.content[0].text).toContain("Remembered");
		expect(result.content[0].text).toContain("user prefers dark mode");
	});
});
