import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

export interface AgentRole {
	id: string;
	name: string;
	tools: string[];
	bashFilter: "read-only" | "unrestricted" | "none";
	maxTurns: number;
	outputFormat: "structured" | "freeform";
	systemPrompt: string;
}

export class RoleLoader {
	private searchPaths: string[];

	constructor() {
		this.searchPaths = [
			join(process.cwd(), ".pi", "agents"),
			join(process.cwd(), "agents"),
			join(process.env.HOME || "~", ".pi", "agents"),
		];
	}

	loadRoles(): Map<string, AgentRole> {
		const roles = new Map<string, AgentRole>();

		for (const dir of this.searchPaths) {
			if (!existsSync(dir)) continue;

			const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
			for (const file of files) {
				const role = this.parseRoleFile(join(dir, file));
				if (role) {
					roles.set(role.id, role);
				}
			}
		}

		return roles;
	}

	private parseRoleFile(path: string): AgentRole | null {
		const content = readFileSync(path, "utf-8");
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!frontmatterMatch) return null;

		const frontmatter = this.parseYamlFrontmatter(frontmatterMatch[1]);
		const body = frontmatterMatch[2].trim();

		if (!frontmatter.id || !frontmatter.name) return null;

		return {
			id: frontmatter.id,
			name: frontmatter.name,
			tools: this.parseArray(frontmatter.tools) || ["read", "write", "edit", "bash", "grep", "find", "ls"],
			bashFilter: (frontmatter.bash_filter || "unrestricted") as "read-only" | "unrestricted" | "none",
			maxTurns: parseInt(frontmatter.max_turns) || 15,
			outputFormat: (frontmatter.output_format || "freeform") as "structured" | "freeform",
			systemPrompt: body,
		};
	}

	private parseYamlFrontmatter(yaml: string): Record<string, string> {
		const result: Record<string, string> = {};
		for (const line of yaml.split("\n")) {
			const match = line.match(/^(\w+):\s*(.+)$/);
			if (match) {
				result[match[1]] = match[2].trim();
			}
		}
		return result;
	}

	private parseArray(value: string | undefined): string[] | null {
		if (!value) return null;
		const match = value.match(/\[(.*)\]/);
		if (!match) return null;
		return match[1].split(",").map((s) => s.trim());
	}
}
