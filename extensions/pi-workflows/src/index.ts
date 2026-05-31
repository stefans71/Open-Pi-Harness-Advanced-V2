import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { parse } from "yaml";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { validateWorkflow } from "./schema.js";
import { WorkflowExecutor } from "./executor.js";

const WORKFLOW_DIRS = [".pi/workflows", "workflows"];

function readVersion(): string {
	try {
		const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
		return pkg.version ?? "unknown";
	} catch {
		return "unknown";
	}
}

const WORKFLOW_TRIGGERS = [
	/(?:run|use|execute|start)\s+(?:the\s+)?(\S+)\s+workflow\s+(?:for|to|on)\s+(.+)/i,
	/workflow\s+(\S+)\s+(?:for|to|on)\s+(.+)/i,
	/(?:run|use|execute|start)\s+(?:the\s+)?(\S+)\s+workflow/i,
];

export default function (pi: ExtensionAPI) {
	const executor = new WorkflowExecutor(pi);

	function findWorkflowDirs(cwd: string): string[] {
		return WORKFLOW_DIRS.map((d) => join(cwd, d)).filter((d) => existsSync(d));
	}

	function listWorkflows(cwd: string): { name: string; path: string; description?: string }[] {
		const results: { name: string; path: string; description?: string }[] = [];
		for (const dir of findWorkflowDirs(cwd)) {
			for (const file of readdirSync(dir)) {
				if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
				const path = join(dir, file);
				try {
					const raw = parse(readFileSync(path, "utf-8"));
					const wf = validateWorkflow(raw);
					results.push({ name: wf.name, path, description: wf.description });
				} catch {
					results.push({ name: basename(file, ".yaml"), path, description: "(invalid YAML)" });
				}
			}
		}
		return results;
	}

	function loadWorkflow(nameOrPath: string, cwd: string) {
		if (existsSync(nameOrPath)) {
			const raw = parse(readFileSync(nameOrPath, "utf-8"));
			return validateWorkflow(raw);
		}

		for (const dir of findWorkflowDirs(cwd)) {
			for (const ext of [".yaml", ".yml", ""]) {
				const path = join(dir, nameOrPath + ext);
				if (existsSync(path)) {
					const raw = parse(readFileSync(path, "utf-8"));
					return validateWorkflow(raw);
				}
			}
		}

		throw new Error(`Workflow '${nameOrPath}' not found. Use /workflow list to see available workflows.`);
	}

	pi.on("input", async (event, ctx) => {
		const text = event.text.trim();
		for (const pattern of WORKFLOW_TRIGGERS) {
			const match = text.match(pattern);
			if (!match) continue;
			const workflowName = match[1];
			const availableNames = listWorkflows(ctx.cwd).map((w) => w.name);
			if (!availableNames.includes(workflowName)) continue;
			const userMessage = match[2] ?? "";
			return {
				action: "transform" as const,
				text: `/workflow run ${workflowName} ${userMessage}`.trim(),
			};
		}
	});

	pi.registerCommand("workflow", {
		description: "Run sequential YAML workflows: /workflow run <name> [--resume <run-id|latest>] <task>, /workflow list, /workflow status, /workflow version",
		getArgumentCompletions: (prefix) => {
			const subcommands = ["run", "list", "status", "version"];
			return subcommands
				.filter((s) => s.startsWith(prefix))
				.map((s) => ({ label: s, value: s }));
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0];

			switch (subcommand) {
				case "list": {
					const workflows = listWorkflows(ctx.cwd);
					if (workflows.length === 0) {
						ctx.ui.notify("No workflows found. Create .yaml files in .pi/workflows/ or workflows/");
						return;
					}
					const lines = workflows.map((w) => `- **${w.name}** — ${w.description ?? "no description"}\n  ${w.path}`);
					pi.sendMessage({
						customType: "workflow-list",
						content: `## Available Workflows\n\n${lines.join("\n")}`,
						display: true,
					});
					return;
				}

				case "status": {
					const state = executor.getState();
					if (!state) {
						ctx.ui.notify("No workflow is currently running.");
						return;
					}
					const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
					pi.sendMessage({
						customType: "workflow-status",
						content: `## Workflow Status: ${state.workflowName}\n\n- Node: ${state.currentNodeIndex + 1}/${state.totalNodes}\n- Status: ${state.status}\n- Elapsed: ${elapsed}s\n- Outputs: ${state.outputs.size} collected`,
						display: true,
					});
					return;
				}

				case "run": {
					if (parts.length < 2) {
						ctx.ui.notify("Usage: /workflow run <name> [--resume <run-id>] [task description]");
						return;
					}
					const workflowName = parts[1];

					// Parse --resume <run-id> from the remaining args.
					const allArgs = parts.slice(2);
					const resumeIdx = allArgs.indexOf("--resume");
					let resumeRunId: string | null = null;
					if (resumeIdx !== -1) {
						resumeRunId = allArgs[resumeIdx + 1] ?? null;
						allArgs.splice(resumeIdx, 2);
					}
					const userMessage = allArgs.join(" ");

					if (executor.getState()) {
						ctx.ui.notify("A workflow is already running. Wait for it to finish.", "warning");
						return;
					}

					try {
						const workflow = loadWorkflow(workflowName, ctx.cwd);

						if (resumeRunId) {
							const artifactsBase = join(ctx.cwd, ".pi", "workflow-artifacts");
							let resolvedRunId = resumeRunId;

							if (resumeRunId === "latest") {
								if (!existsSync(artifactsBase)) {
									ctx.ui.notify(`No previous runs found for workflow '${workflowName}'`, "error");
									return;
								}
								const dirs = readdirSync(artifactsBase)
									.filter(d => d.startsWith(workflowName + "-"))
									.sort();
								const last = dirs[dirs.length - 1];
								if (!last) {
									ctx.ui.notify(`No previous runs found for workflow '${workflowName}'`, "error");
									return;
								}
								resolvedRunId = last;
							}

							const artifactsDir = join(artifactsBase, resolvedRunId);
							const stateFile = join(artifactsDir, "workflow-state.json");

							if (!existsSync(stateFile)) {
								ctx.ui.notify(`No workflow-state.json in ${artifactsDir}`, "error");
								return;
							}

							const state = JSON.parse(readFileSync(stateFile, "utf-8"));
							if (!Array.isArray(state.completedNodes)) {
								ctx.ui.notify("workflow-state.json is malformed (missing completedNodes)", "error");
								return;
							}

							ctx.ui.notify(`Resuming '${workflowName}' run ${resolvedRunId}\nCompleted: ${state.completedNodes.join(", ") || "none"}`);
							await executor.run(workflow, userMessage, ctx, {
								artifactsDir,
								completedNodes: state.completedNodes,
								startedAt: state.startedAt,
								userMessage: state.userMessage,
							});
						} else {
							await executor.run(workflow, userMessage, ctx);
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						ctx.ui.notify(`Workflow error: ${msg}`, "error");
					}
					return;
				}

				case "version":
					ctx.ui.notify(`pi-workflows v${readVersion()}`);
					return;

				default:
					ctx.ui.notify("Usage: /workflow [run|list|status|version]");
			}
		},
	});
}
