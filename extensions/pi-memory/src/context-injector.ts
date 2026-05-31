import type { EmbeddingClient } from "./embedding.js";
import type { MemoryStore, FactWithScore } from "./memory-store.js";
import type { RetrievalConfig } from "./config.js";

export class ContextInjector {
	constructor(
		private embedder: EmbeddingClient,
		private store: MemoryStore,
		private config: RetrievalConfig,
	) {}

	async retrieve(prompt: string, configOverride?: RetrievalConfig): Promise<FactWithScore[]> {
		const cfg = configOverride ?? this.config;
		const embedding = await this.embedder.embed(prompt);
		const results = this.store.searchFacts(embedding, cfg.topK);
		return results.filter((f) => f.score >= cfg.similarityThreshold);
	}

	formatMemoryBlock(facts: FactWithScore[], maxTokensBudget?: number): string {
		if (facts.length === 0) return "";

		const budget = maxTokensBudget ?? this.config.maxTokensBudget;
		const sorted = [...facts].sort((a, b) => b.importance - a.importance);

		let tokenEstimate = 0;
		const included: string[] = [];

		for (const fact of sorted) {
			const line = `- (importance: ${fact.importance.toFixed(1)}, relevance: ${fact.score.toFixed(2)}) ${fact.content}`;
			const lineTokens = Math.ceil(line.length / 4);
			if (tokenEstimate + lineTokens > budget) break;
			included.push(line);
			tokenEstimate += lineTokens;
		}

		if (included.length === 0) return "";

		return [
			"[LONG-TERM MEMORY — retrieved from previous sessions]",
			...included,
			"[END MEMORY]",
		].join("\n");
	}
}
