import { readFileSync, existsSync } from "fs";
import { join } from "path";

// -- Shared settings (single source of truth) --

export interface SharedConfig {
	/** llama-server for generation (GPU, port 11434). Used by FactExtractor + VramMonitor. */
	generationUrl: string;
	/** llama-server for embeddings (CPU, port 8081). Used by EmbeddingClient. */
	embeddingUrl: string;
	embeddingDimension: number;
}

// -- Sub-configs (reference shared values instead of duplicating) --

export interface EmbeddingConfig {
	model: string;
	poolSize?: number;
}

export interface RetrievalConfig {
	topK: number;
	similarityThreshold: number;
	maxTokensBudget: number;
}

export interface ExtractionConfig {
	model: string;
	minImportance: number;
	maxFactsPerCompaction: number;
}

export interface StorageConfig {
	dbPath: string;
	maxFacts: number;
	decayEnabled: boolean;
	decayHalfLifeDays: number;
}

export interface VramConfig {
	warningThresholdGB: number;
	enabled: boolean;
}

export interface NudgeConfig {
	enabled: boolean;
	intervalTurns: number;
}

export interface AdaptiveRetrievalConfig {
	enabled: boolean;
	contextThresholds: {
		moderate: number;
		aggressive: number;
	};
}

// -- Top-level config --

export interface MemoryConfig {
	shared: SharedConfig;
	embedding: EmbeddingConfig;
	retrieval: RetrievalConfig;
	extraction: ExtractionConfig;
	storage: StorageConfig;
	vram: VramConfig;
	nudge: NudgeConfig;
	adaptiveRetrieval: AdaptiveRetrievalConfig;
}

const DEFAULTS: MemoryConfig = {
	shared: {
		generationUrl: "http://localhost:11434",
		embeddingUrl: "http://localhost:8081",
		embeddingDimension: 768,
	},
	embedding: {
		model: "nomic-embed-text",
		poolSize: 4,
	},
	retrieval: {
		topK: 8,
		similarityThreshold: 0.6,
		maxTokensBudget: 2000,
	},
	extraction: {
		model: "qwen3.6-27b-mtp",
		minImportance: 0.3,
		maxFactsPerCompaction: 20,
	},
	storage: {
		dbPath: ".pi/memory.db",
		maxFacts: 10000,
		decayEnabled: true,
		decayHalfLifeDays: 90,
	},
	vram: {
		warningThresholdGB: 28,
		enabled: true,
	},
	nudge: {
		enabled: true,
		intervalTurns: 5,
	},
	adaptiveRetrieval: {
		enabled: true,
		contextThresholds: {
			moderate: 0.6,
			aggressive: 0.8,
		},
	},
};

// -- Config loading --

export function loadConfig(): MemoryConfig {
	const configPaths = [
		join(process.cwd(), ".pi", "extensions", "pi-memory", "config.json"),
		join(process.env.HOME || "~", ".pi", "agent", "extensions", "pi-memory", "config.json"),
	];

	for (const path of configPaths) {
		if (existsSync(path)) {
			const raw = JSON.parse(readFileSync(path, "utf-8"));
			return deepMerge(DEFAULTS, raw);
		}
	}

	return DEFAULTS;
}

export function adjustForContext(config: MemoryConfig, contextUsedPct: number): RetrievalConfig {
	const retrieval = { ...config.retrieval };
	const { moderate, aggressive } = config.adaptiveRetrieval.contextThresholds;

	if (contextUsedPct > aggressive) {
		retrieval.topK = Math.max(2, Math.floor(retrieval.topK * 0.5));
		retrieval.maxTokensBudget = Math.max(500, Math.floor(retrieval.maxTokensBudget * 0.5));
	} else if (contextUsedPct > moderate) {
		retrieval.topK = Math.max(4, Math.floor(retrieval.topK * 0.75));
		retrieval.maxTokensBudget = Math.max(1000, Math.floor(retrieval.maxTokensBudget * 0.75));
	}

	return retrieval;
}

function deepMerge<T extends Record<string, any>>(base: T, override: Partial<T>): T {
	const result = { ...base };
	for (const key of Object.keys(override) as (keyof T)[]) {
		const val = override[key];
		if (val && typeof val === "object" && !Array.isArray(val) && typeof result[key] === "object") {
			result[key] = deepMerge(result[key] as any, val as any);
		} else if (val !== undefined) {
			result[key] = val as T[keyof T];
		}
	}
	return result;
}
