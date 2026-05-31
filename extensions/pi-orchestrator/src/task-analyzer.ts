import type { AgentRole } from "./role-loader.js";
import { llmGenerate } from "./llm-helper.js";

export interface ExecutionStep {
	role: string;
	task: string;
	dependsOn: number[];
}

export interface ExecutionPlan {
	steps: ExecutionStep[];
	reasoning: string;
}

const ANALYZER_PROMPT = `You are a task analyzer for a multi-agent coding system.
Given a task and available agent roles, decide if the task needs orchestration or can be handled by a single agent.

Available roles:
{ROLES}

Rules:
- Simple tasks (single-file edit, quick question, one-step fix) → return empty steps
- Multi-step tasks (implement + review, research + implement, refactor across files) → break into steps
- Each step specifies which role handles it
- Steps can depend on previous steps (by index)
- Independent steps can run in parallel

Output JSON only:
{"steps": [{"role": "coder", "task": "...", "depends_on": []}], "reasoning": "..."}

For simple tasks:
{"steps": [], "reasoning": "Single-agent task, no orchestration needed"}`;

export class TaskAnalyzer {
	async analyze(
		prompt: string,
		roles: Map<string, AgentRole>,
	): Promise<ExecutionPlan | null> {
		const roleDescriptions = Array.from(roles.values())
			.map((r) => `- ${r.id}: ${r.name} (tools: ${r.tools.join(", ")})`)
			.join("\n");

		const systemPrompt = ANALYZER_PROMPT.replace("{ROLES}", roleDescriptions);

		const response = await llmGenerate(
			systemPrompt + "\n\nUser task:\n" + prompt,
			{ maxTokens: 1000, temperature: 0.3 },
		);

		return this.parsePlan(response);
	}

	private parsePlan(response: string): ExecutionPlan | null {
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return null;

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			if (!Array.isArray(parsed.steps)) return null;
			return {
				steps: parsed.steps.map((s: any) => ({
					role: String(s.role),
					task: String(s.task),
					dependsOn: Array.isArray(s.depends_on) ? s.depends_on : [],
				})),
				reasoning: parsed.reasoning || "",
			};
		} catch {
			return null;
		}
	}
}
