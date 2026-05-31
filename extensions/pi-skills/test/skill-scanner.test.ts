import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillScanner } from "../src/skill-scanner.js";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), "pi-test-skill-scanner");

function writeSkill(dir: string, content: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), content);
}

const SAMPLE_SKILL = `---
id: test-skill
name: Test Skill
version: 1.0.0
triggers: [test, testing]
tags: [dev]
tools_required: [read]
providers: [ollama]
estimated_turns: 2-3
---

# Test Skill

This is the description paragraph.

## Instructions
Do things step by step.`;

const HEADER_FIRST_BODY = `---
id: header-first
name: Header First
version: 1.0.0
triggers: [header]
tags: []
tools_required: []
providers: []
estimated_turns: 1
---

# Header First Skill

## Section

This paragraph comes after a header.`;

const EMPTY_BODY = `---
id: empty-body
name: Empty Body
version: 1.0.0
triggers: [empty]
tags: []
tools_required: []
providers: []
estimated_turns: 1
---
`;

describe("SkillScanner", () => {
	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	describe("scan — bundled skills", () => {
		it("marks bundled skills with source 'bundled'", () => {
			const scanner = new SkillScanner();
			const skills = scanner.scan();
			for (const skill of skills.values()) {
				if (skill.path.includes("default-skills")) {
					expect(skill.source).toBe("bundled");
				}
			}
		});

		it("sets loaded to 'L1' for all skills", () => {
			const scanner = new SkillScanner();
			const skills = scanner.scan();
			for (const skill of skills.values()) {
				expect(skill.loaded).toBe("L1");
			}
		});
	});

	describe("description extraction", () => {
		it("extracts first non-header paragraph", () => {
			writeSkill(join(TEST_DIR, ".pi", "skills", "test"), SAMPLE_SKILL);
			const scanner = new (SkillScanner as any)();
			const skill = scanner.parseSkillFile(join(TEST_DIR, ".pi", "skills", "test", "SKILL.md"), "workspace");
			expect(skill).not.toBeNull();
			expect(skill!.description).toBe("This is the description paragraph.");
		});

		it("skips headers to find first paragraph", () => {
			writeSkill(join(TEST_DIR, ".pi", "skills", "hf"), HEADER_FIRST_BODY);
			const scanner = new (SkillScanner as any)();
			const skill = scanner.parseSkillFile(join(TEST_DIR, ".pi", "skills", "hf", "SKILL.md"), "workspace");
			expect(skill).not.toBeNull();
			expect(skill!.description).toBe("This paragraph comes after a header.");
		});

		it("returns empty string for empty body", () => {
			writeSkill(join(TEST_DIR, ".pi", "skills", "eb"), EMPTY_BODY);
			const scanner = new (SkillScanner as any)();
			const skill = scanner.parseSkillFile(join(TEST_DIR, ".pi", "skills", "eb", "SKILL.md"), "workspace");
			expect(skill).not.toBeNull();
			expect(skill!.description).toBe("");
		});
	});

	describe("source classification", () => {
		it("classifies workspace skills correctly", () => {
			writeSkill(join(TEST_DIR, ".pi", "skills", "test"), SAMPLE_SKILL);
			const scanner = new (SkillScanner as any)();
			const skill = scanner.parseSkillFile(join(TEST_DIR, ".pi", "skills", "test", "SKILL.md"), "workspace");
			expect(skill!.source).toBe("workspace");
		});

		it("overrides to agent-created when path contains /agent-created/", () => {
			const dir = join(TEST_DIR, ".pi", "skills", "agent-created", "my-skill");
			writeSkill(dir, SAMPLE_SKILL);
			const scanner = new (SkillScanner as any)();

			const skills = new Map();
			scanner.scanDirectory(join(TEST_DIR, ".pi", "skills"), skills, "workspace");

			const skill = skills.get("test-skill");
			expect(skill).toBeDefined();
			expect(skill!.source).toBe("agent-created");
		});
	});

	describe("parseSkillFile", () => {
		it("returns null for file without frontmatter", () => {
			const dir = join(TEST_DIR, "no-fm");
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "SKILL.md"), "Just some text without frontmatter");
			const scanner = new (SkillScanner as any)();
			expect(scanner.parseSkillFile(join(dir, "SKILL.md"), "workspace")).toBeNull();
		});

		it("returns null for frontmatter without id", () => {
			const dir = join(TEST_DIR, "no-id");
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "SKILL.md"), "---\nname: NoId\n---\nBody");
			const scanner = new (SkillScanner as any)();
			expect(scanner.parseSkillFile(join(dir, "SKILL.md"), "workspace")).toBeNull();
		});

		it("parses all fields correctly", () => {
			writeSkill(join(TEST_DIR, "full"), SAMPLE_SKILL);
			const scanner = new (SkillScanner as any)();
			const skill = scanner.parseSkillFile(join(TEST_DIR, "full", "SKILL.md"), "bundled");
			expect(skill!.id).toBe("test-skill");
			expect(skill!.name).toBe("Test Skill");
			expect(skill!.version).toBe("1.0.0");
			expect(skill!.triggers).toEqual(["test", "testing"]);
			expect(skill!.tags).toEqual(["dev"]);
			expect(skill!.source).toBe("bundled");
			expect(skill!.loaded).toBe("L1");
			expect(skill!.description).toBe("This is the description paragraph.");
			expect(skill!.instructions).toContain("Do things step by step");
		});
	});

	describe("scanDirectory", () => {
		it("does not crash on missing directory", () => {
			const scanner = new (SkillScanner as any)();
			const skills = new Map();
			expect(() => scanner.scanDirectory(join(TEST_DIR, "nonexistent"), skills, "workspace")).not.toThrow();
		});

		it("recurses into subdirectories", () => {
			writeSkill(join(TEST_DIR, "parent", "child"), SAMPLE_SKILL);
			const scanner = new (SkillScanner as any)();
			const skills = new Map();
			scanner.scanDirectory(join(TEST_DIR, "parent"), skills, "workspace");
			expect(skills.has("test-skill")).toBe(true);
		});
	});
});
