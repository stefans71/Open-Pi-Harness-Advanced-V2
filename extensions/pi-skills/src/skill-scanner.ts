import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export type SkillSource = "bundled" | "workspace" | "home-agent" | "agent-created" | "agent-created-staging";

export interface SkillDefinition {
	id: string;
	name: string;
	version: string;
	triggers: string[];
	tags: string[];
	toolsRequired: string[];
	providers: string[];
	estimatedTurns: string;
	description: string;
	instructions: string;
	path: string;
	source: SkillSource;
	pinned: boolean;
	loaded: "L0" | "L1";
}

const SKILL_TEMPLATE = `---
id: {ID}
name: {NAME}
version: 1.0.0
triggers: [{ID}]
tags: [custom]
tools_required: [read, grep, find]
providers: [ollama, claude, openai]
estimated_turns: 3-5
---

# {NAME}

## Purpose
Describe what this skill does.

## Instructions
When activated, follow these steps:

1. Step one
2. Step two
3. Step three

## Output Format
Describe the expected output structure.
`;

export class SkillScanner {
	private searchPaths: Array<{ path: string; source: SkillSource }>;

	constructor() {
		const selfDir = dirname(fileURLToPath(import.meta.url));
		this.searchPaths = [
			{ path: join(selfDir, "..", "default-skills"), source: "bundled" },
			{ path: join(process.cwd(), ".pi", "skills"), source: "workspace" },
			{ path: join(process.env.HOME || "~", ".pi", "agent", "skills"), source: "home-agent" },
		];

		const extensionPaths: Array<{ dir: string; source: SkillSource }> = [
			{ dir: join(process.cwd(), ".pi", "extensions"), source: "workspace" },
			{ dir: join(process.env.HOME || "~", ".pi", "agent", "extensions"), source: "home-agent" },
		];
		for (const { dir: extDir, source: extSource } of extensionPaths) {
			if (existsSync(extDir)) {
				try {
					const dirs = readdirSync(extDir, { withFileTypes: true })
						.filter((d) => d.isDirectory())
						.map((d) => join(extDir, d.name));
					this.searchPaths.push(...dirs.map((d) => ({ path: d, source: extSource })));
				} catch {}
			}
		}
	}

	scan(): Map<string, SkillDefinition> {
		const skills = new Map<string, SkillDefinition>();

		for (const { path, source } of this.searchPaths) {
			if (!existsSync(path)) continue;
			this.scanDirectory(path, skills, source);
		}

		return skills;
	}

	scaffold(name: string): void {
		const dir = join(process.cwd(), ".pi", "skills", name);
		mkdirSync(dir, { recursive: true });

		const content = SKILL_TEMPLATE
			.replace(/{ID}/g, name.toLowerCase().replace(/\s+/g, "-"))
			.replace(/{NAME}/g, name);

		writeFileSync(join(dir, "SKILL.md"), content);
	}

	private scanDirectory(dir: string, skills: Map<string, SkillDefinition>, source: SkillSource): void {
		const skillFile = join(dir, "SKILL.md");
		if (existsSync(skillFile)) {
			const effectiveSource = dir.includes("/agent-created-staging/") || dir.endsWith("/agent-created-staging")
				? "agent-created-staging"
				: dir.includes("/agent-created/") || dir.endsWith("/agent-created")
					? "agent-created"
					: source;
			const skill = this.parseSkillFile(skillFile, effectiveSource);
			if (skill) skills.set(skill.id, skill);
			return;
		}

		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory() && entry.name !== ".archive") {
					this.scanDirectory(join(dir, entry.name), skills, source);
				}
			}
		} catch {}
	}

	private parseSkillFile(path: string, source: SkillSource): SkillDefinition | null {
		const content = readFileSync(path, "utf-8");
		const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) return null;

		const fm = this.parseFrontmatter(match[1]);
		if (!fm.id || !fm.name) return null;

		const body = match[2].trim();
		const description = this.extractDescription(body);

		return {
			id: fm.id,
			name: fm.name,
			version: fm.version || "1.0.0",
			triggers: this.parseArray(fm.triggers) || [fm.id],
			tags: this.parseArray(fm.tags) || [],
			toolsRequired: this.parseArray(fm.tools_required) || [],
			providers: this.parseArray(fm.providers) || [],
			estimatedTurns: fm.estimated_turns || "",
			description,
			instructions: body,
			path,
			source,
			pinned: fm.pinned === "true",
			loaded: "L1",
		};
	}

	private extractDescription(body: string): string {
		const paragraphs = body.split(/\n\n+/);
		for (const p of paragraphs) {
			const trimmed = p.trim();
			if (trimmed && !trimmed.startsWith("#")) return trimmed;
		}
		return "";
	}

	private parseFrontmatter(yaml: string): Record<string, string> {
		const result: Record<string, string> = {};
		for (const line of yaml.split("\n")) {
			const m = line.match(/^([\w_]+):\s*(.+)$/);
			if (m) result[m[1]] = m[2].trim();
		}
		return result;
	}

	private parseArray(value: string | undefined): string[] | null {
		if (!value) return null;
		const m = value.match(/\[(.*)\]/);
		if (!m) return null;
		return m[1]
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
}
