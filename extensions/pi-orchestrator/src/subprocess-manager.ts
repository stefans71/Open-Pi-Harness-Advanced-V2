import { spawn } from "child_process";
import type { ExecutionPlan, ExecutionStep } from "./task-analyzer.js";
import type { AgentRole } from "./role-loader.js";

export interface StepResult {
	step: ExecutionStep;
	output: string;
	exitCode: number;
	tokensUsed: number;
	durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes per sub-agent

export class SubprocessManager {
	async execute(
		plan: ExecutionPlan,
		roles: Map<string, AgentRole>,
	): Promise<StepResult[]> {
		const results: StepResult[] = [];
		const completed = new Set<number>();

		while (completed.size < plan.steps.length) {
			const ready = plan.steps
				.map((step, i) => ({ step, index: i }))
				.filter(
					({ step, index }) =>
						!completed.has(index) &&
						step.dependsOn.every((dep) => completed.has(dep)),
				);

			if (ready.length === 0) {
				throw new Error("Deadlock: no steps can proceed");
			}

			for (const { step, index } of ready) {
				const role = roles.get(step.role);
				if (!role) {
					results.push({
						step,
						output: `Error: unknown role "${step.role}"`,
						exitCode: 1,
						tokensUsed: 0,
						durationMs: 0,
					});
					completed.add(index);
					continue;
				}

				const previousContext = step.dependsOn
					.map((dep) => results[dep]?.output)
					.filter(Boolean)
					.join("\n\n---\n\n");

				const fullPrompt = previousContext
					? `Context from previous steps:\n${previousContext}\n\nYour task:\n${step.task}`
					: step.task;

				const result = await this.runAgent(role, fullPrompt);
				results[index] = { step, ...result };
				completed.add(index);
			}
		}

		return results;
	}

	private async runAgent(
		role: AgentRole,
		prompt: string,
	): Promise<{ output: string; exitCode: number; tokensUsed: number; durationMs: number }> {
		const start = Date.now();

		try {
			const args = [
				"--mode", "json",
				"-p",
				"--no-extensions",
				"--thinking", "off",
				"--system-prompt", role.systemPrompt,
				prompt,
			];

			const output = await this.spawnPi(args, DEFAULT_TIMEOUT_MS);
			const durationMs = Date.now() - start;

			return {
				output: output.text,
				exitCode: 0,
				tokensUsed: output.tokensUsed,
				durationMs,
			};
		} catch (err) {
			return {
				output: `Agent error: ${(err as Error).message}`,
				exitCode: 1,
				tokensUsed: 0,
				durationMs: Date.now() - start,
			};
		}
	}

	private spawnPi(
		args: string[],
		timeoutMs: number,
	): Promise<{ text: string; tokensUsed: number }> {
		return new Promise((resolve, reject) => {
			const proc = spawn("pi", args, {
				cwd: process.cwd(),
				env: process.env,
				stdio: ["pipe", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";

			proc.stdout.on("data", (data) => {
				stdout += data.toString();
			});
			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			const timer = setTimeout(() => {
				proc.kill("SIGTERM");
				reject(new Error(`Agent timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			proc.on("close", (code) => {
				clearTimeout(timer);
				if (code === 0) {
					resolve(this.extractOutput(stdout));
				} else {
					reject(new Error(`Agent exited with code ${code}: ${stderr.slice(0, 500)}`));
				}
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
		});
	}

	private extractOutput(ndjson: string): { text: string; tokensUsed: number } {
		const lines = ndjson.trim().split("\n");
		let tokensUsed = 0;

		for (let i = lines.length - 1; i >= 0; i--) {
			try {
				const event = JSON.parse(lines[i]);

				if (event.type === "agent_end" && Array.isArray(event.messages)) {
					const assistantMsg = event.messages.find(
						(m: any) => m.role === "assistant",
					);
					if (assistantMsg) {
						const text = assistantMsg.content
							?.filter((c: any) => c.type === "text")
							.map((c: any) => c.text)
							.join("\n\n") || "";
						tokensUsed =
							(assistantMsg.usage?.input || 0) +
							(assistantMsg.usage?.output || 0);
						return { text, tokensUsed };
					}
				}
			} catch {}
		}

		for (const line of lines) {
			try {
				const event = JSON.parse(line);
				if (event.type === "message_end" && event.message?.role === "assistant") {
					const text = event.message.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("\n\n") || "";
					tokensUsed =
						(event.message.usage?.input || 0) +
						(event.message.usage?.output || 0);
					return { text, tokensUsed };
				}
			} catch {}
		}

		return { text: ndjson.slice(-2000), tokensUsed: 0 };
	}
}
