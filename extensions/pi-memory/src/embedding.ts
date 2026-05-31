import { request } from "undici";
import type { EmbeddingConfig, SharedConfig } from "./config.js";

export interface PoolStats {
	connected: number;
	free: number;
	running: number;
	pending: number;
	max: number;
}

export class EmbeddingClient {
	private baseUrl: string;
	private config: EmbeddingConfig;

	constructor(config: EmbeddingConfig, shared: SharedConfig) {
		this.config = config;
		this.baseUrl = shared.embeddingUrl;
	}

	async embed(text: string): Promise<Float32Array> {
		const { statusCode, body } = await request(`${this.baseUrl}/v1/embeddings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: text }),
			bodyTimeout: 30000,
			headersTimeout: 10000,
		});

		if (statusCode !== 200) {
			const errBody = await body.text().catch(() => "(unreadable)");
			throw new Error(`Embedding failed: ${statusCode} — ${errBody.slice(0, 200)}`);
		}

		const data = (await body.json()) as { data: { embedding: number[] }[] };
		return new Float32Array(data.data[0].embedding);
	}

	async embedBatch(texts: string[]): Promise<Float32Array[]> {
		const { statusCode, body } = await request(`${this.baseUrl}/v1/embeddings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: texts }),
			bodyTimeout: 60000,
			headersTimeout: 10000,
		});

		if (statusCode !== 200) {
			const errBody = await body.text().catch(() => "(unreadable)");
			throw new Error(`Batch embedding failed: ${statusCode} — ${errBody.slice(0, 200)}`);
		}

		const data = (await body.json()) as { data: { embedding: number[] }[] };
		return data.data.map((d) => new Float32Array(d.embedding));
	}

	getStats(): PoolStats {
		return { connected: 0, free: 0, running: 0, pending: 0, max: 0 };
	}

	async shutdown(): Promise<void> {
		// No connection pool to close.
	}
}
