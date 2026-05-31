import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { EmbeddingClient } from "./embedding.js";
import type { MemoryStore } from "./memory-store.js";
import type { ExtractionConfig, SharedConfig } from "./config.js";

interface ExtractedFact {
	content: string;
	importance: number;
	tags: string[];
}

const EXTRACTION_PROMPT = `Extract discrete, reusable facts from this conversation fragment.
Each fact should be:
- Self-contained (understandable without surrounding context)
- Actionable or informational (decisions made, constraints discovered, architecture choices)
- NOT chit-chat, greetings, or meta-conversation about the AI itself
- Scored 0.0-1.0 for importance:
  - 1.0: Critical decision, security constraint, breaking change
  - 0.7-0.9: Architecture choice, API contract, deployment requirement
  - 0.4-0.6: Preference, convention, useful context
  - 0.1-0.3: Minor detail, trivial observation

Output a JSON array only, no other text:
[{"content": "...", "importance": 0.8, "tags": ["category"]}]

If no facts worth extracting, output: []`;

export class FactExtractor {
	constructor(
		private embedder: EmbeddingClient,
		private store: MemoryStore,
		private config: ExtractionConfig,
		private shared: SharedConfig,
	) {}

	async extractAndStore(messages: AgentMessage[]): Promise<number> {
		const conversationText = this.serializeMessages(messages);
		if (conversationText.length < 100) return 0;

		const facts = await this.callLlmForFacts(conversationText);
		const filtered = facts.filter((f) => f.importance >= this.config.minImportance);
		const limited = filtered.slice(0, this.config.maxFactsPerCompaction);

		if (limited.length === 0) return 0;

		const texts = limited.map((f) => f.content);
		const embeddings = await this.embedder.embedBatch(texts);

		for (let i = 0; i < limited.length; i++) {
			this.store.storeFact({
				content: limited[i].content,
				embedding: embeddings[i],
				source: "compaction",
				importance: limited[i].importance,
			});
		}

		return limited.length;
	}

	private async callLlmForFacts(conversationText: string): Promise<ExtractedFact[]> {
		const truncated =
			conversationText.length > 12000 ? conversationText.slice(0, 12000) + "\n[truncated]" : conversationText;

		const response = await fetch(`${this.shared.generationUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.config.model,
				messages: [
					{ role: "user", content: `${EXTRACTION_PROMPT}\n\n${truncated}` },
				],
				stream: false,
				max_tokens: 2000,
				temperature: 0.3,
			}),
		});

		if (!response.ok) {
			throw new Error(`Generation failed: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as { choices: { message: { content: string } }[] };
		return this.parseFactsResponse(data.choices[0].message.content);
	}

	private parseFactsResponse(response: string): ExtractedFact[] {
		const jsonMatch = response.match(/\[[\s\S]*\]/);
		if (!jsonMatch) return [];

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(
				(f: any) =>
					typeof f.content === "string" &&
					typeof f.importance === "number" &&
					f.content.length > 10,
			);
		} catch {
			return [];
		}
	}

	private serializeMessages(messages: AgentMessage[]): string {
		return messages
			.map((m) => {
				if ("role" in m && "content" in m) {
					const role = (m as any).role || "unknown";
					const content =
						typeof (m as any).content === "string"
							? (m as any).content
							: JSON.stringify((m as any).content);
					const truncatedContent = content.length > 2000 ? content.slice(0, 2000) + "..." : content;
					return `[${role}]: ${truncatedContent}`;
				}
				return "";
			})
			.filter(Boolean)
			.join("\n\n");
	}
}
