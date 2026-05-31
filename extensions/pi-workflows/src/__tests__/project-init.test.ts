import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
	findWorkflowSource,
	copyWorkflows,
	createGitignore,
	appendToGitignore,
	initNewProject,
	addToProject,
	WORKFLOW_CATEGORIES,
} from "../project-init.js";

const TEST_DIR = join(tmpdir(), "pi-project-init-test-" + Date.now());

function makeSourceDir(): string {
	const src = join(TEST_DIR, "source", ".pi", "workflows");
	mkdirSync(src, { recursive: true });
	writeFileSync(join(src, "code-task.yaml"), "name: code-task\nnodes: []");
	writeFileSync(join(src, "fix-bug.yaml"), "name: fix-bug\nnodes: []");
	writeFileSync(join(src, "web-design.yaml"), "name: web-design\nnodes: []");
	return src;
}

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("findWorkflowSource", () => {
	it("finds .pi/workflows by walking up from a nested directory", () => {
		const repoRoot = join(TEST_DIR, "repo");
		const workflowDir = join(repoRoot, ".pi", "workflows");
		mkdirSync(workflowDir, { recursive: true });
		writeFileSync(join(workflowDir, "test.yaml"), "name: test");

		const nested = join(repoRoot, "extensions", "pi-workflows", "src");
		mkdirSync(nested, { recursive: true });

		const found = findWorkflowSource(nested);
		expect(found).toBe(workflowDir);
	});

	it("returns null when no .pi/workflows exists", () => {
		const emptyDir = join(TEST_DIR, "empty");
		mkdirSync(emptyDir, { recursive: true });
		expect(findWorkflowSource(emptyDir)).toBeNull();
	});

	it("skips empty .pi/workflows directories", () => {
		const repoRoot = join(TEST_DIR, "empty-workflows");
		const workflowDir = join(repoRoot, ".pi", "workflows");
		mkdirSync(workflowDir, { recursive: true });

		expect(findWorkflowSource(repoRoot)).toBeNull();
	});
});

describe("copyWorkflows", () => {
	it("copies specified workflow files", () => {
		const src = makeSourceDir();
		const target = join(TEST_DIR, "target-workflows");

		const copied = copyWorkflows(src, target, ["code-task", "fix-bug"]);
		expect(copied).toEqual(["code-task.yaml", "fix-bug.yaml"]);
		expect(existsSync(join(target, "code-task.yaml"))).toBe(true);
		expect(existsSync(join(target, "fix-bug.yaml"))).toBe(true);
	});

	it("skips workflows that do not exist in source", () => {
		const src = makeSourceDir();
		const target = join(TEST_DIR, "target-missing");

		const copied = copyWorkflows(src, target, ["code-task", "nonexistent"]);
		expect(copied).toEqual(["code-task.yaml"]);
	});

	it("creates target directory if it does not exist", () => {
		const src = makeSourceDir();
		const target = join(TEST_DIR, "new-dir", "nested");

		copyWorkflows(src, target, ["code-task"]);
		expect(existsSync(join(target, "code-task.yaml"))).toBe(true);
	});
});

describe("createGitignore", () => {
	it("creates .gitignore with PI entries", () => {
		const dir = join(TEST_DIR, "gitignore-new");
		mkdirSync(dir, { recursive: true });

		createGitignore(dir);

		const content = readFileSync(join(dir, ".gitignore"), "utf-8");
		expect(content).toContain(".pi/memory.db");
		expect(content).toContain(".pi/skills/");
		expect(content).toContain(".pi/workflow-artifacts/");
	});

	it("appends to existing .gitignore without duplicating", () => {
		const dir = join(TEST_DIR, "gitignore-existing");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, ".gitignore"), "node_modules/\n.pi/memory.db\n");

		createGitignore(dir);

		const content = readFileSync(join(dir, ".gitignore"), "utf-8");
		const memoryDbCount = (content.match(/^\.pi\/memory\.db$/gm) || []).length;
		expect(memoryDbCount).toBe(1);
		expect(content).toContain(".pi/skills/");
	});
});

describe("appendToGitignore", () => {
	it("adds missing entries to existing .gitignore", () => {
		const dir = join(TEST_DIR, "append-test");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, ".gitignore"), "node_modules/\n");

		appendToGitignore(dir);

		const content = readFileSync(join(dir, ".gitignore"), "utf-8");
		expect(content).toContain("node_modules/");
		expect(content).toContain("# PI Agent");
		expect(content).toContain(".pi/memory.db");
	});

	it("does nothing when all entries already present", () => {
		const dir = join(TEST_DIR, "append-noop");
		mkdirSync(dir, { recursive: true });
		const original = ".pi/memory.db\n.pi/memory.db-journal\n.pi/skills/\n.pi/workflow-artifacts/\n.pi/extensions/\n";
		writeFileSync(join(dir, ".gitignore"), original);

		appendToGitignore(dir);

		const content = readFileSync(join(dir, ".gitignore"), "utf-8");
		expect(content).toBe(original);
	});
});

describe("initNewProject", () => {
	it("creates project directory with workflows and gitignore", () => {
		const src = makeSourceDir();
		const target = join(TEST_DIR, "new-project");

		const result = initNewProject(target, ["code-task", "fix-bug"], src, { gitInit: false });

		expect(result.copied).toEqual(["code-task.yaml", "fix-bug.yaml"]);
		expect(existsSync(join(target, ".pi", "workflows", "code-task.yaml"))).toBe(true);
		expect(existsSync(join(target, ".pi", "workflows", "fix-bug.yaml"))).toBe(true);
		expect(existsSync(join(target, ".gitignore"))).toBe(true);
	});
});

describe("addToProject", () => {
	it("adds workflows to existing project", () => {
		const src = makeSourceDir();
		const target = join(TEST_DIR, "existing-project");
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, ".gitignore"), "node_modules/\n");

		const result = addToProject(target, ["web-design"], src);

		expect(result.copied).toEqual(["web-design.yaml"]);
		expect(existsSync(join(target, ".pi", "workflows", "web-design.yaml"))).toBe(true);
		const gitignore = readFileSync(join(target, ".gitignore"), "utf-8");
		expect(gitignore).toContain("node_modules/");
		expect(gitignore).toContain(".pi/memory.db");
	});
});

describe("WORKFLOW_CATEGORIES", () => {
	it("has General category selected by default", () => {
		const general = WORKFLOW_CATEGORIES.find(c => c.label.startsWith("General"));
		expect(general).toBeDefined();
		expect(general!.defaultSelected).toBe(true);
	});

	it("has other categories unselected by default", () => {
		const nonDefault = WORKFLOW_CATEGORIES.filter(c => !c.label.startsWith("General"));
		expect(nonDefault.every(c => c.defaultSelected === false)).toBe(true);
	});
});
