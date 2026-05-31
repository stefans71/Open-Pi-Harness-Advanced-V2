import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { RoleLoader, type AgentRole } from "./role-loader.js";
import { TaskAnalyzer } from "./task-analyzer.js";
import { SubprocessManager } from "./subprocess-manager.js";
import { ResultSynthesizer } from "./result-synthesizer.js";

export default function (pi: ExtensionAPI) {
	const roleLoader = new RoleLoader();
	const analyzer = new TaskAnalyzer();
	const subprocess = new SubprocessManager();
	const synthesizer = new ResultSynthesizer();

	let roles: Map<string, AgentRole> = new Map();

	pi.on("session_start", async () => {
		roles = roleLoader.loadRoles();
	});

	pi.registerCommand("orchestrate", {
		description: "Run a task with multi-agent orchestration",
		handler: async (args, ctx) => {
			if (!args) {
				ctx.ui.notify("Usage: /orchestrate <task description>");
				return;
			}

			const plan = await analyzer.analyze(args, roles);
			if (!plan || plan.steps.length === 0) {
				ctx.ui.notify("Task is simple enough for single-agent. Proceeding normally.");
				pi.sendUserMessage(args);
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Orchestration plan",
				plan.steps.map((s, i) => `  ${i + 1}. [${s.role}] ${s.task}`).join("\n") + "\n\nProceed?",
			);
			if (!confirm) return;

			const results = await subprocess.execute(plan, roles);
			const synthesis = await synthesizer.synthesize(results);

			pi.sendMessage({
				customType: "orchestrator-result",
				content: synthesis,
				display: true,
			});
		},
	});

	pi.registerCommand("agents", {
		description: "List available agent roles",
		handler: async (_args, _ctx) => {
			const lines = Array.from(roles.values()).map(
				(r) => `- **${r.name}** (${r.id}): tools=[${r.tools.join(", ")}], bash=${r.bashFilter}`,
			);
			pi.sendMessage({
				customType: "agent-list",
				content: `## Available Agent Roles\n\n${lines.join("\n")}`,
				display: true,
			});
		},
	});

	pi.registerCommand("roles", {
		description: "Reload agent role definitions",
		handler: async (_args, ctx) => {
			roles = roleLoader.loadRoles();
			ctx.ui.notify(`Loaded ${roles.size} roles.`);
		},
	});
}
