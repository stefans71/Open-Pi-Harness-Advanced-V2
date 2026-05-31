import { renameSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import type { UsageTracker, SkillUsageEntry } from "./usage-tracker.js";
import type { SkillScanner, SkillDefinition } from "./skill-scanner.js";

export interface CuratorReport {
	kept: string[];
	staled: string[];
	archived: string[];
	merged: MergeCandidate[];
}

export interface MergeCandidate {
	skillA: string;
	skillB: string;
	overlapPct: number;
	llmReason: string;
}

export class SkillCurator {
	constructor(
		private tracker: UsageTracker,
		private scanner: SkillScanner,
		private generationUrl: string = "http://localhost:11434",
		private model: string = "qwen3.6-27b-mtp",
	) {}

	async run(): Promise<CuratorReport> {
		const skills = this.scanner.scan();
		const usage = this.tracker.getAll();
		const report: CuratorReport = { kept: [], staled: [], archived: [], merged: [] };

		for (const [id, skill] of skills) {
			if (this.isProtected(skill)) {
				report.kept.push(id);
				continue;
			}

			const entry = usage[id];
			if (!entry) {
				report.kept.push(id);
				continue;
			}
			const daysSinceUse = this.daysSinceLastUse(entry);

			if (daysSinceUse > 90) {
				this.archive(skill);
				report.archived.push(id);
			} else if (daysSinceUse > 30) {
				report.staled.push(id);
			} else {
				report.kept.push(id);
			}
		}

		const activeSkills = new Map<string, SkillDefinition>();
		for (const [id, skill] of skills) {
			if (!report.archived.includes(id)) {
				activeSkills.set(id, skill);
			}
		}
		report.merged = await this.findMergeCandidates(activeSkills);

		return report;
	}

	private isProtected(skill: SkillDefinition): boolean {
		return skill.source === "bundled" || skill.pinned === true;
	}

	daysSinceLastUse(entry: SkillUsageEntry | undefined): number {
		if (!entry) return Infinity;

		if (entry.lastUsed) {
			const ms = new Date(entry.lastUsed).getTime();
			if (!isNaN(ms)) return (Date.now() - ms) / (1000 * 60 * 60 * 24);
		}

		if (entry.firstSeen) {
			const ms = new Date(entry.firstSeen).getTime();
			if (!isNaN(ms)) return (Date.now() - ms) / (1000 * 60 * 60 * 24);
		}

		return Infinity;
	}

	archive(skill: SkillDefinition): void {
		const skillDir = dirname(skill.path);
		const archiveBase = join(dirname(skillDir), ".archive");
		const archiveTarget = join(archiveBase, skill.id);

		mkdirSync(archiveBase, { recursive: true });

		if (existsSync(archiveTarget)) {
			renameSync(archiveTarget, `${archiveTarget}-${Date.now()}`);
		}

		renameSync(skillDir, archiveTarget);
	}

	async findMergeCandidates(
		skills: Map<string, SkillDefinition>,
	): Promise<MergeCandidate[]> {
		const candidates: MergeCandidate[] = [];
		const entries = Array.from(skills.entries());

		const pairs: Array<{ a: string; b: string; pct: number }> = [];
		for (let i = 0; i < entries.length; i++) {
			for (let j = i + 1; j < entries.length; j++) {
				const [idA, skillA] = entries[i];
				const [idB, skillB] = entries[j];
				const pct = this.triggerOverlap(skillA.triggers, skillB.triggers);
				if (pct >= 0.3) {
					pairs.push({ a: idA, b: idB, pct });
				}
			}
		}

		for (const pair of pairs) {
			try {
				const reason = await this.assessMerge(
					skills.get(pair.a)!,
					skills.get(pair.b)!,
				);
				if (reason) {
					candidates.push({
						skillA: pair.a,
						skillB: pair.b,
						overlapPct: pair.pct,
						llmReason: reason,
					});
				}
			} catch {
				// LLM failure is non-fatal for merge detection
			}
		}

		return candidates;
	}

	triggerOverlap(triggersA: string[], triggersB: string[]): number {
		const setA = new Set(triggersA.map(t => t.toLowerCase()));
		const setB = new Set(triggersB.map(t => t.toLowerCase()));

		let shared = 0;
		for (const t of setA) {
			if (setB.has(t)) shared++;
		}

		if (shared === 0) return 0;
		const smaller = Math.min(setA.size, setB.size);
		return shared / smaller;
	}

	private async assessMerge(
		skillA: SkillDefinition,
		skillB: SkillDefinition,
	): Promise<string | null> {
		const prompt = `You are evaluating whether two skills should be merged.

Skill A: "${skillA.name}" (id: ${skillA.id})
Triggers: [${skillA.triggers.join(", ")}]
Description: ${skillA.description}

Skill B: "${skillB.name}" (id: ${skillB.id})
Triggers: [${skillB.triggers.join(", ")}]
Description: ${skillB.description}

Should these skills be merged into one? Consider:
- Do they solve the same kind of problem?
- Would a user ever need both active at the same time?
- Would merging lose important specialization?

Respond with either:
MERGE: <one sentence reason>
or
NO_MERGE`;

		const response = await this.callLlm(prompt);
		const trimmed = response.trim();

		if (trimmed.startsWith("MERGE:")) {
			return trimmed.slice(6).trim();
		}
		return null;
	}

	private async callLlm(prompt: string): Promise<string> {
		const response = await fetch(`${this.generationUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.model,
				messages: [{ role: "user", content: prompt }],
				temperature: 0.3,
				max_tokens: 200,
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
}
