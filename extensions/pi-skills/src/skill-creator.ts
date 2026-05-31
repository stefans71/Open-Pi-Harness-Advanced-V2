import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, basename } from "path";

const SKILL_EXTRACTION_PROMPT = `Analyze this workflow execution trace and extract a reusable skill.

Workflow: $workflow
Task: $task
Trace:
$trace

If this workflow discovered a reusable approach, edge case, or verification
pattern, write a SKILL.md with:
- id, name, version 1.0.0
- triggers (3-5 keyword phrases that would invoke this skill)
- Concise instructions capturing WHAT to do and WHY
- Edge cases encountered
- Verification steps

If the workflow was too generic or trivial, respond with "NO_SKILL".

Output ONLY the SKILL.md content (with --- frontmatter) or "NO_SKILL".`;

interface TraceEvent {
	event: string;
	[key: string]: unknown;
}

export class SkillCreator {
	constructor(
		private generationUrl: string = "http://localhost:11434",
		private model: string = "qwen3.6-27b-mtp",
	) {}

	async createFromTrace(
		eventsJsonlPath: string,
		workflowName: string,
		userMessage: string,
	): Promise<string | null> {
		const events = this.readEvents(eventsJsonlPath);

		const nodeCompleteCount = events.filter((e) => e.event === "node_complete").length;
		if (nodeCompleteCount < 3) return null;

		const traceText = this.summarizeTrace(events);

		const prompt = SKILL_EXTRACTION_PROMPT
			.replace("$workflow", workflowName)
			.replace("$task", userMessage)
			.replace("$trace", traceText);

		const response = await this.callLlm(prompt);
		const trimmed = response.trim();

		if (trimmed === "NO_SKILL" || trimmed.startsWith("NO_SKILL")) return null;

		return this.writeSkillFile(workflowName, trimmed);
	}

	private readEvents(path: string): TraceEvent[] {
		try {
			const content = readFileSync(path, "utf-8");
			return content
				.split("\n")
				.filter((line) => line.trim())
				.map((line) => {
					try {
						return JSON.parse(line) as TraceEvent;
					} catch {
						return null;
					}
				})
				.filter((e): e is TraceEvent => e !== null);
		} catch {
			return [];
		}
	}

	private summarizeTrace(events: TraceEvent[]): string {
		const lines: string[] = [];

		for (const e of events) {
			switch (e.event) {
				case "workflow_start":
					lines.push(`Workflow: ${e.workflow} (${e.nodeCount} nodes)`);
					break;
				case "node_start":
					lines.push(`\n--- Node: ${e.nodeId} (${e.nodeType}) ---`);
					break;
				case "node_complete":
					lines.push(`  Completed: outputLength=${e.outputLength}`);
					break;
				case "tool_call_selected":
					lines.push(`  Tool: ${e.tool}(${this.formatArgKeys(e.argKeys)})`);
					break;
				case "respond_tool_captured":
					lines.push(`  Respond captured: ${(e.outputLength as number) || "?"} chars`);
					break;
				case "workflow_end":
					lines.push(`\nResult: ${e.status} (${e.elapsed}ms)`);
					break;
			}
		}

		return lines.join("\n");
	}

	private formatArgKeys(argKeys: unknown): string {
		if (!Array.isArray(argKeys)) return "";
		return (argKeys as string[]).join(", ");
	}

	private async callLlm(prompt: string): Promise<string> {
		const response = await fetch(`${this.generationUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.model,
				messages: [{ role: "user", content: prompt }],
				temperature: 0.3,
				max_tokens: 2000,
			}),
		});

		if (!response.ok) {
			throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as {
			choices: Array<{ message: { content: string } }>;
		};

		const content = data.choices?.[0]?.message?.content;
		if (!content) throw new Error("Empty LLM response");

		return content;
	}

	private writeSkillFile(workflowName: string, content: string): string | null {
		const idMatch = content.match(/^---\n[\s\S]*?^id:\s*(.+)$/m);
		const rawId = idMatch
			? idMatch[1].trim()
			: `${workflowName.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
		const id = basename(rawId).replace(/^\.+/, "") || `skill-${Date.now()}`;

		const dir = join(process.cwd(), ".pi", "skills", "agent-created", id);
		mkdirSync(dir, { recursive: true });

		const filePath = join(dir, "SKILL.md");
		writeFileSync(filePath, content);

		return filePath;
	}
}
