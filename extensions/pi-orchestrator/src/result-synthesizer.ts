import type { StepResult } from "./subprocess-manager.js";
import { llmGenerate } from "./llm-helper.js";

const SYNTHESIS_PROMPT = `You are synthesizing results from multiple specialized agents into a single coherent response.

For each step result below, extract the key output and present it clearly.
Structure your response with clear sections for each agent's contribution.
If agents produced conflicting results, highlight the conflict.
Keep the synthesis concise — the user wants the combined outcome, not a transcript.`;

export class ResultSynthesizer {
	async synthesize(results: StepResult[]): Promise<string> {
		if (results.length === 1) {
			return this.formatSingleResult(results[0]);
		}

		const stepSummaries = results
			.map(
				(r, i) =>
					`## Step ${i + 1}: ${r.step.role} — "${r.step.task}"\nExit code: ${r.exitCode}\nDuration: ${(r.durationMs / 1000).toFixed(1)}s\n\nOutput:\n${r.output.slice(0, 4000)}`,
			)
			.join("\n\n---\n\n");

		const response = await llmGenerate(
			SYNTHESIS_PROMPT + "\n\n" + stepSummaries,
			{ maxTokens: 3000, temperature: 0.3 },
		);

		const footer = results
			.map(
				(r) =>
					`- ${r.step.role}: ${r.exitCode === 0 ? "OK" : "FAILED"} (${(r.durationMs / 1000).toFixed(1)}s, ~${r.tokensUsed} tokens)`,
			)
			.join("\n");

		return `${response}\n\n---\n*Agent summary:*\n${footer}`;
	}

	private formatSingleResult(result: StepResult): string {
		const status = result.exitCode === 0 ? "completed" : "failed";
		return `${result.output}\n\n---\n*${result.step.role} ${status} in ${(result.durationMs / 1000).toFixed(1)}s*`;
	}
}
