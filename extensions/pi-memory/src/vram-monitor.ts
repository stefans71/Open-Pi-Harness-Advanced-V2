import type { VramConfig, SharedConfig } from "./config.js";

interface VramStatus {
	warning: boolean;
	message: string;
	models: { name: string; sizeGB: number; vramGB: number }[];
	totalVramGB: number;
}

export class VramMonitor {
	constructor(
		private config: VramConfig,
		private shared: SharedConfig,
	) {}

	async check(): Promise<VramStatus> {
		try {
			// llama-server exposes /health (not Ollama's /api/ps).
			// We report server liveness only — per-model VRAM detail is not available.
			const response = await fetch(`${this.shared.generationUrl}/health`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				return {
					warning: false,
					message: `llama-server unreachable: ${response.status}`,
					models: [],
					totalVramGB: 0,
				};
			}

			const data = (await response.json()) as { status: string };
			const message = [
				`## llama-server Status`,
				`Generation server (${this.shared.generationUrl}): ${data.status}`,
				`Note: Per-model VRAM detail not available on llama-server backend.`,
				`Use \`nvidia-smi\` on the AutoDL instance for live VRAM usage.`,
			].join("\n");

			return { warning: false, message, models: [], totalVramGB: 0 };
		} catch (err) {
			return {
				warning: false,
				message: `llama-server connection failed: ${(err as Error).message}`,
				models: [],
				totalVramGB: 0,
			};
		}
	}
}
