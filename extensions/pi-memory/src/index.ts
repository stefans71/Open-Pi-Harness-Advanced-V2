import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { MemoryStore } from "./memory-store.js";
import { EmbeddingClient } from "./embedding.js";
import { FactExtractor } from "./fact-extractor.js";
import { ContextInjector } from "./context-injector.js";
import { VramMonitor } from "./vram-monitor.js";
import { loadConfig, adjustForContext } from "./config.js";

export default function (pi: ExtensionAPI) {
	const config = loadConfig();
	const store = new MemoryStore(config.storage, config.shared);
	const embedder = new EmbeddingClient(config.embedding, config.shared);
	const extractor = new FactExtractor(embedder, store, config.extraction, config.shared);
	const injector = new ContextInjector(embedder, store, config.retrieval);
	const vram = new VramMonitor(config.vram, config.shared);
	let turnCount = 0;

	pi.on("session_start", async () => {
		store.initialize();
		turnCount = 0;

		pi.registerTool({
			name: "pi_remember",
			label: "Remember",
			description: "Store a fact in long-term memory for retrieval in future sessions.",
			parameters: Type.Object({
				fact: Type.String({ description: "The fact to remember" }),
			}),
			async execute(_toolCallId, params) {
				const embedding = await embedder.embed(params.fact);
				store.storeFact({
					content: params.fact,
					embedding,
					source: "manual",
					importance: 1.0,
				});
				return {
					content: [{ type: "text" as const, text: `Remembered: "${params.fact.slice(0, 80)}..."` }],
					details: {},
				};
			},
		});
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const msgs = event.preparation.messagesToSummarize;
		if (msgs.length === 0) return;
		await extractor.extractAndStore(msgs);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		turnCount++;
		const extraParts: string[] = [];

		let retrievalConfig = config.retrieval;
		if (config.adaptiveRetrieval.enabled) {
			const usage = ctx.getContextUsage();
			if (usage?.percent != null) {
				retrievalConfig = adjustForContext(config, usage.percent / 100);
			}
		}

		const relevantFacts = await injector.retrieve(event.prompt, retrievalConfig);
		if (relevantFacts.length > 0) {
			const memoryBlock = injector.formatMemoryBlock(relevantFacts, retrievalConfig.maxTokensBudget);
			if (memoryBlock) {
				extraParts.push(memoryBlock);
			}
		}

		if (config.nudge.enabled && turnCount % config.nudge.intervalTurns === 0) {
			extraParts.push(
				`[MEMORY NUDGE] You have had ${turnCount} turns in this session. ` +
				`Review the recent conversation. If any important facts, decisions, ` +
				`preferences, or constraints were discussed that should persist across ` +
				`sessions, use the pi_remember tool with the fact as the argument. ` +
				`Only persist non-obvious information that would be valuable in a future session.`,
			);
		}

		if (config.vram.enabled) {
			const status = await vram.check();
			if (status.message) {
				extraParts.push(`[VRAM STATUS: ${status.message}]`);
			}
		}

		if (extraParts.length > 0) {
			return { systemPrompt: event.systemPrompt + "\n\n" + extraParts.join("\n\n") };
		}
	});

	pi.registerCommand("remember", {
		description: "Store a fact in long-term memory",
		handler: async (args, ctx) => {
			if (!args) {
				ctx.ui.notify("Usage: /remember <fact to remember>");
				return;
			}
			const embedding = await embedder.embed(args);
			store.storeFact({
				content: args,
				embedding,
				source: "manual",
				importance: 1.0,
			});
			ctx.ui.notify(`Stored: "${args.slice(0, 60)}..."`);
		},
	});

	pi.registerCommand("forget", {
		description: "Remove a fact from long-term memory",
		handler: async (args, ctx) => {
			if (!args) {
				ctx.ui.notify("Usage: /forget <search query>");
				return;
			}
			const embedding = await embedder.embed(args);
			const matches = store.searchFacts(embedding, 5);
			if (matches.length === 0) {
				ctx.ui.notify("No matching facts found.");
				return;
			}
			const options = matches.map((f) => f.content.slice(0, 80));
			const choice = await ctx.ui.select("Select fact to forget:", options);
			if (choice) {
				const idx = options.indexOf(choice);
				if (idx >= 0) {
					store.deleteFact(matches[idx].id);
					ctx.ui.notify("Fact removed.");
				}
			}
		},
	});

	pi.registerCommand("memories", {
		description: "Search or list stored memories",
		handler: async (args, ctx) => {
			if (args) {
				const embedding = await embedder.embed(args);
				const results = store.searchFacts(embedding, 10);
				const lines = results.map(
					(f, i) => `${i + 1}. [${f.importance.toFixed(1)}] ${f.content.slice(0, 100)}`,
				);
				pi.sendMessage({
					customType: "memory-results",
					content: `## Memory Search: "${args}"\n\n${lines.join("\n")}`,
					display: true,
				});
			} else {
				const stats = store.getStats();
				pi.sendMessage({
					customType: "memory-stats",
					content: `## Memory Stats\n\n- Total facts: ${stats.totalFacts}\n- Manual: ${stats.manualFacts}\n- Extracted: ${stats.extractedFacts}\n- DB size: ${stats.dbSizeKB}KB`,
					display: true,
				});
			}
		},
	});

	pi.registerCommand("vram", {
		description: "Check current VRAM usage on Ollama",
		handler: async (_args, _ctx) => {
			const status = await vram.check();
			pi.sendMessage({
				customType: "vram-status",
				content: status.message,
				display: true,
			});
		},
	});

	pi.on("session_shutdown", async () => {
		store.close();
		await embedder.shutdown();
	});
}
