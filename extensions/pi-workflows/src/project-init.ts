import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, appendFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

export interface WorkflowCategory {
	label: string;
	workflows: string[];
	defaultSelected: boolean;
}

export const WORKFLOW_CATEGORIES: WorkflowCategory[] = [
	{ label: "General (code-task, fix-bug, add-tests, refactor, investigate)", workflows: ["code-task", "fix-bug", "add-tests", "refactor", "investigate"], defaultSelected: true },
	{ label: "Web Design (web-design)", workflows: ["web-design"], defaultSelected: false },
	{ label: "Code Review (adversarial-review, smart-review)", workflows: ["adversarial-review", "smart-review"], defaultSelected: false },
	{ label: "GitHub (fix-github-issue)", workflows: ["fix-github-issue"], defaultSelected: false },
	{ label: "Full Pipeline (prd-to-code)", workflows: ["prd-to-code"], defaultSelected: false },
	{ label: "Meta / Dev (self-improve, trace-gen, smoke-executor)", workflows: ["self-improve", "trace-gen", "smoke-executor"], defaultSelected: false },
];

const PI_GITIGNORE_ENTRIES = [
	".pi/memory.db",
	".pi/memory.db-journal",
	".pi/skills/",
	".pi/workflow-artifacts/",
	".pi/extensions/",
];

export function findWorkflowSource(startDir: string): string | null {
	let dir = resolve(startDir);
	while (true) {
		const candidate = join(dir, ".pi", "workflows");
		if (existsSync(candidate)) {
			const files = readdirSync(candidate).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
			if (files.length > 0) return candidate;
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function findWorkflowSourceFromExtension(): string | null {
	const selfDir = dirname(fileURLToPath(import.meta.url));
	return findWorkflowSource(selfDir);
}

export function copyWorkflows(sourceDir: string, targetDir: string, workflowNames: string[]): string[] {
	mkdirSync(targetDir, { recursive: true });
	const copied: string[] = [];
	for (const name of workflowNames) {
		for (const ext of [".yaml", ".yml"]) {
			const src = join(sourceDir, name + ext);
			if (existsSync(src)) {
				copyFileSync(src, join(targetDir, name + ext));
				copied.push(name + ext);
				break;
			}
		}
	}
	return copied;
}

export function createGitignore(projectDir: string): void {
	const gitignorePath = join(projectDir, ".gitignore");
	if (existsSync(gitignorePath)) {
		appendToGitignore(projectDir);
		return;
	}
	writeFileSync(gitignorePath, PI_GITIGNORE_ENTRIES.join("\n") + "\n");
}

export function appendToGitignore(projectDir: string): void {
	const gitignorePath = join(projectDir, ".gitignore");
	const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
	const toAdd = PI_GITIGNORE_ENTRIES.filter(entry => !existing.includes(entry));
	if (toAdd.length === 0) return;
	const separator = existing.endsWith("\n") || existing === "" ? "" : "\n";
	appendFileSync(gitignorePath, separator + "\n# PI Agent\n" + toAdd.join("\n") + "\n");
}

export function initNewProject(
	targetDir: string,
	workflowNames: string[],
	sourceDir: string,
	options: { gitInit?: boolean } = {},
): { copied: string[]; dir: string } {
	mkdirSync(targetDir, { recursive: true });
	const workflowDir = join(targetDir, ".pi", "workflows");
	const copied = copyWorkflows(sourceDir, workflowDir, workflowNames);
	createGitignore(targetDir);
	if (options.gitInit !== false) {
		try {
			execSync("git init", { cwd: targetDir, stdio: "ignore" });
		} catch {
			// git not available, skip
		}
	}
	return { copied, dir: targetDir };
}

export function addToProject(
	targetDir: string,
	workflowNames: string[],
	sourceDir: string,
): { copied: string[] } {
	const workflowDir = join(targetDir, ".pi", "workflows");
	const copied = copyWorkflows(sourceDir, workflowDir, workflowNames);
	appendToGitignore(targetDir);
	return { copied };
}
