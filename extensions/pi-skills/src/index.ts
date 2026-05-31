import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SkillScanner, type SkillDefinition } from "./skill-scanner.js";
import { TriggerMatcher } from "./trigger-matcher.js";
import { ComplexityDetector } from "./complexity-detector.js";
import { UsageTracker } from "./usage-tracker.js";
import { SkillCreator } from "./skill-creator.js";
import { SkillCurator } from "./curator.js";

const THINKING_TRIGGERS = [
	"debug", "diagnose", "investigate", "trace through",
	"root cause", "why is", "why does", "explain why",
];

function shouldEnableThinking(text: string): boolean {
	const lower = text.toLowerCase();
	if (/\bthink hard\b/i.test(text)) return true;
	return THINKING_TRIGGERS.some((t) => lower.includes(t));
}

function stripThinkHard(text: string): string {
	return text.replace(/\s*\bthink hard\b\s*/gi, " ").trim();
}

let listenerRegistered = false;
let activeScanner: SkillScanner | null = null;
let activeSkillCreator: SkillCreator | null = null;
let onSkillCreated: ((newSkills: Map<string, SkillDefinition>) => void) | null = null;

export default function (pi: ExtensionAPI) {
	const scanner = new SkillScanner();
	activeScanner = scanner;
	const matcher = new TriggerMatcher();
	const complexity = new ComplexityDetector();
	const tracker = new UsageTracker(process.cwd());
	const skillCreator = new SkillCreator();
	activeSkillCreator = skillCreator;
	let skills: Map<string, SkillDefinition> = new Map();
	onSkillCreated = (newSkills) => { skills = newSkills; };

	if (!listenerRegistered) {
		listenerRegistered = true;
		pi.events.on("workflow:completed", (data) => {
			if (!activeSkillCreator || !activeScanner || !onSkillCreated) return;
			const event = data as { workflowName: string; eventsPath: string; userMessage: string };
			activeSkillCreator.createFromTrace(event.eventsPath, event.workflowName, event.userMessage)
				.then((path) => { if (path && activeScanner && onSkillCreated) onSkillCreated(activeScanner.scan()); })
				.catch((err) => console.error("Skill creation failed (non-fatal):", err));
		});
	}

	pi.on("session_start", async () => {
		skills = scanner.scan();
		for (const skill of skills.values()) {
			tracker.recordView(skill.id);
		}
		tracker.save();
		pi.setThinkingLevel("off");
	});

	pi.on("input", async (event) => {
		if ((globalThis as Record<string, unknown>).__piWorkflowRunning) return;

		let text = event.text;
		const wantThinking = shouldEnableThinking(text);

		if (wantThinking) {
			pi.setThinkingLevel("high");
			text = stripThinkHard(text);
		} else {
			pi.setThinkingLevel("off");
		}

		const parts: string[] = [text];

		const matches = matcher.match(text, skills);
		if (matches.length > 0) {
			const best = matches[0];
			tracker.recordMatch(best.id, best.confidence);
			parts.push(
				`\n\n[SKILL: "${best.name}" activated — loading instructions]\n\n` +
					best.instructions,
			);
			tracker.recordUse(best.id);
			tracker.save();
		}

		const signal = complexity.detect(text);
		if (signal) {
			parts.push(
				`\n\n[ORCHESTRATION HINT: This looks like a multi-step task ` +
					`(${signal.reasons.join(", ")}). ` +
					`Suggest to the user: "This looks like a multi-step task — ` +
					`want me to run \`/orchestrate\` to break it into specialized agent steps?" ` +
					`Only mention this once, briefly, at the end of your response.]`,
			);
		}

		if (parts.length > 1 || text !== event.text) {
			return { action: "transform", text: parts.join("") };
		}
	});

	pi.registerCommand("skills", {
		description: "List all available skills",
		handler: async () => {
			if (skills.size === 0) {
				pi.sendMessage({
					customType: "skills-list",
					content: "No skills found. Create one with `/skill create <name>`.",
					display: true,
				});
				return;
			}

			const lines = Array.from(skills.values()).map(
				(s) =>
					`| ${s.name} | ${s.triggers.slice(0, 3).join(", ")} | ${s.tags.join(", ")} | ${s.estimatedTurns || "?"} |`,
			);

			pi.sendMessage({
				customType: "skills-list",
				content: `## Available Skills\n\n| Name | Triggers | Tags | Turns |\n|---|---|---|---|\n${lines.join("\n")}`,
				display: true,
			});
		},
	});

	pi.registerCommand("skill", {
		description: "Load a skill or create a new one",
		handler: async (args, ctx) => {
			if (!args) {
				ctx.ui.notify("Usage: /skill <name> or /skill create <name>");
				return;
			}

			if (args.startsWith("create ")) {
				const name = args.slice(7).trim();
				scanner.scaffold(name);
				skills = scanner.scan();
				ctx.ui.notify(`Created skill scaffold at .pi/skills/${name}/SKILL.md`);
				return;
			}

			if (args === "curator" || args === "curator ") {
				ctx.ui.notify("Running skill curator...");
				const curator = new SkillCurator(tracker, scanner);
				try {
					const report = await curator.run();

					try {
						(pi as any).events.emit("curator:run", {
							kept: report.kept.length,
							staled: report.staled.length,
							archived: report.archived.length,
							merged: report.merged.length,
						});
					} catch {
						// Event emission is non-fatal
					}

					if (report.archived.length > 0) {
						skills = scanner.scan();
					}

					const lines: string[] = ["## Skill Curator Report\n"];

					lines.push(`**Kept:** ${report.kept.length} skill(s)`);
					if (report.kept.length > 0) {
						lines.push(report.kept.map(id => `  - ${id}`).join("\n"));
					}

					lines.push(`\n**Stale (>30 days unused):** ${report.staled.length} skill(s)`);
					if (report.staled.length > 0) {
						lines.push(report.staled.map(id => `  - ${id}`).join("\n"));
					}

					lines.push(`\n**Archived (>90 days unused):** ${report.archived.length} skill(s)`);
					if (report.archived.length > 0) {
						lines.push(report.archived.map(id => `  - ${id} (moved to .archive/)`).join("\n"));
					}

					if (report.merged.length > 0) {
						lines.push(`\n**Merge candidates:** ${report.merged.length} pair(s)`);
						for (const m of report.merged) {
							lines.push(`  - ${m.skillA} + ${m.skillB} (${Math.round(m.overlapPct * 100)}% overlap): ${m.llmReason}`);
						}
					}

					pi.sendMessage({
						customType: "curator-report",
						content: lines.join("\n"),
						display: true,
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					ctx.ui.notify(`Curator failed: ${msg}`);
				}
				return;
			}

			const skill = skills.get(args) || Array.from(skills.values()).find((s) => s.name.toLowerCase() === args.toLowerCase());

			if (!skill) {
				ctx.ui.notify(`Skill "${args}" not found. Run /skills to see available skills.`);
				return;
			}

			pi.sendMessage(
				{
					customType: "skill-loaded",
					content: `[SKILL: ${skill.name}]\n\n${skill.instructions}`,
					display: true,
				},
				{ triggerTurn: false },
			);
			ctx.ui.notify(`Loaded skill: ${skill.name}`);
		},
	});
}
