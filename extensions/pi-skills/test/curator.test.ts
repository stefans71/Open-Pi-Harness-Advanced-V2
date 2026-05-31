import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SkillCurator } from "../src/curator.js";
import { UsageTracker, type SkillUsageEntry } from "../src/usage-tracker.js";
import { SkillScanner, type SkillDefinition, type SkillSource } from "../src/skill-scanner.js";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), "pi-test-curator");
const SKILLS_DIR = join(TEST_DIR, ".pi", "skills");
const USAGE_FILE = join(SKILLS_DIR, ".usage.json");

function makeSkill(
	id: string,
	overrides: Partial<SkillDefinition> = {},
): SkillDefinition {
	const dir = join(SKILLS_DIR, id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nid: ${id}\nname: ${id}\n---\nInstructions.`);
	return {
		id,
		name: overrides.name ?? id,
		version: "1.0.0",
		triggers: overrides.triggers ?? [id],
		tags: [],
		toolsRequired: [],
		providers: [],
		estimatedTurns: "",
		description: overrides.description ?? `${id} skill`,
		instructions: "Instructions.",
		path: join(dir, "SKILL.md"),
		source: overrides.source ?? "workspace",
		pinned: overrides.pinned ?? false,
		loaded: "L1",
	};
}

function createMockScanner(skills: Map<string, SkillDefinition>): SkillScanner {
	return { scan: () => skills } as unknown as SkillScanner;
}

function writeUsage(data: Record<string, Partial<SkillUsageEntry>>): void {
	mkdirSync(join(TEST_DIR, ".pi", "skills"), { recursive: true });
	const full: Record<string, SkillUsageEntry> = {};
	for (const [id, partial] of Object.entries(data)) {
		full[id] = {
			viewCount: partial.viewCount ?? 0,
			matchCount: partial.matchCount ?? 0,
			useCount: partial.useCount ?? 0,
			lastViewed: partial.lastViewed ?? "",
			lastMatched: partial.lastMatched ?? "",
			lastUsed: partial.lastUsed ?? "",
			avgConfidence: partial.avgConfidence ?? 0,
			firstSeen: partial.firstSeen ?? "",
		};
	}
	writeFileSync(USAGE_FILE, JSON.stringify(full, null, 2));
}

function daysAgo(days: number): string {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("SkillCurator", () => {
	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(SKILLS_DIR, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	describe("isProtected", () => {
		it("keeps bundled skills regardless of usage", async () => {
			const skills = new Map<string, SkillDefinition>();
			skills.set("debug", makeSkill("debug", { source: "bundled" }));

			const tracker = new UsageTracker(TEST_DIR);
			const curator = new SkillCurator(tracker, createMockScanner(skills));
			const report = await curator.run();

			expect(report.kept).toContain("debug");
			expect(report.archived).not.toContain("debug");
			expect(report.staled).not.toContain("debug");
		});

		it("keeps pinned skills regardless of usage", async () => {
			const skills = new Map<string, SkillDefinition>();
			skills.set("custom", makeSkill("custom", { pinned: true }));

			const tracker = new UsageTracker(TEST_DIR);
			const curator = new SkillCurator(tracker, createMockScanner(skills));
			const report = await curator.run();

			expect(report.kept).toContain("custom");
			expect(report.archived).not.toContain("custom");
		});
	});

	describe("daysSinceLastUse", () => {
		it("returns days since lastUsed when set", () => {
			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			const entry: SkillUsageEntry = {
				viewCount: 1, matchCount: 1, useCount: 1,
				lastViewed: daysAgo(1), lastMatched: daysAgo(1),
				lastUsed: daysAgo(10), avgConfidence: 0.8, firstSeen: daysAgo(100),
			};
			const days = curator.daysSinceLastUse(entry);
			expect(days).toBeGreaterThan(9);
			expect(days).toBeLessThan(11);
		});

		it("falls back to firstSeen when lastUsed is empty", () => {
			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			const entry: SkillUsageEntry = {
				viewCount: 5, matchCount: 0, useCount: 0,
				lastViewed: daysAgo(0), lastMatched: "",
				lastUsed: "", avgConfidence: 0, firstSeen: daysAgo(45),
			};
			const days = curator.daysSinceLastUse(entry);
			expect(days).toBeGreaterThan(44);
			expect(days).toBeLessThan(46);
		});

		it("returns Infinity when no entry exists", () => {
			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			expect(curator.daysSinceLastUse(undefined)).toBe(Infinity);
		});

		it("returns Infinity when both lastUsed and firstSeen are empty", () => {
			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			const entry: SkillUsageEntry = {
				viewCount: 1, matchCount: 0, useCount: 0,
				lastViewed: daysAgo(0), lastMatched: "",
				lastUsed: "", avgConfidence: 0, firstSeen: "",
			};
			expect(curator.daysSinceLastUse(entry)).toBe(Infinity);
		});
	});

	describe("staleness detection", () => {
		it("keeps skills used within 30 days", async () => {
			const skills = new Map<string, SkillDefinition>();
			skills.set("recent", makeSkill("recent"));
			writeUsage({ recent: { lastUsed: daysAgo(10), firstSeen: daysAgo(60) } });

			const tracker = new UsageTracker(TEST_DIR);
			const curator = new SkillCurator(tracker, createMockScanner(skills));
			const report = await curator.run();

			expect(report.kept).toContain("recent");
		});

		it("marks skills unused for >30 days as stale", async () => {
			const skills = new Map<string, SkillDefinition>();
			skills.set("aging", makeSkill("aging"));
			writeUsage({ aging: { lastUsed: daysAgo(45), firstSeen: daysAgo(60) } });

			const tracker = new UsageTracker(TEST_DIR);
			const curator = new SkillCurator(tracker, createMockScanner(skills));
			const report = await curator.run();

			expect(report.staled).toContain("aging");
		});

		it("archives skills unused for >90 days", async () => {
			const skills = new Map<string, SkillDefinition>();
			skills.set("old", makeSkill("old"));
			writeUsage({ old: { lastUsed: daysAgo(100), firstSeen: daysAgo(200) } });

			const tracker = new UsageTracker(TEST_DIR);
			const curator = new SkillCurator(tracker, createMockScanner(skills));
			const report = await curator.run();

			expect(report.archived).toContain("old");
			expect(existsSync(join(SKILLS_DIR, ".archive", "old", "SKILL.md"))).toBe(true);
			expect(existsSync(join(SKILLS_DIR, "old"))).toBe(false);
		});

		it("uses firstSeen for never-triggered skills (grace period)", async () => {
			const skills = new Map<string, SkillDefinition>();
			skills.set("new-skill", makeSkill("new-skill"));
			writeUsage({ "new-skill": { lastUsed: "", firstSeen: daysAgo(5) } });

			const tracker = new UsageTracker(TEST_DIR);
			const curator = new SkillCurator(tracker, createMockScanner(skills));
			const report = await curator.run();

			expect(report.kept).toContain("new-skill");
			expect(report.archived).not.toContain("new-skill");
		});

		it("keeps skills with no usage entry (not archived)", async () => {
			const skills = new Map<string, SkillDefinition>();
			skills.set("no-entry", makeSkill("no-entry"));

			const tracker = new UsageTracker(TEST_DIR);
			const curator = new SkillCurator(tracker, createMockScanner(skills));
			const report = await curator.run();

			expect(report.kept).toContain("no-entry");
			expect(report.archived).not.toContain("no-entry");
			expect(report.staled).not.toContain("no-entry");
		});

		it("does not archive legacy entry after session_start backfills firstSeen", async () => {
			const skills = new Map<string, SkillDefinition>();
			skills.set("legacy", makeSkill("legacy"));
			// Legacy .usage.json entry: has lastUsed="" and NO firstSeen field
			mkdirSync(join(TEST_DIR, ".pi", "skills"), { recursive: true });
			writeFileSync(USAGE_FILE, JSON.stringify({
				legacy: {
					viewCount: 3, matchCount: 0, useCount: 0,
					lastViewed: "2026-01-01T00:00:00.000Z",
					lastMatched: "", lastUsed: "", avgConfidence: 0,
				},
			}));

			const tracker = new UsageTracker(TEST_DIR);
			// Simulate session_start: recordView triggers ensureEntry backfill
			tracker.recordView("legacy");
			tracker.save();

			const curator = new SkillCurator(tracker, createMockScanner(skills));
			const report = await curator.run();

			expect(report.kept).toContain("legacy");
			expect(report.archived).not.toContain("legacy");
		});

		it("archives never-triggered skills past the 90-day grace period", async () => {
			const skills = new Map<string, SkillDefinition>();
			skills.set("forgotten", makeSkill("forgotten"));
			writeUsage({ forgotten: { lastUsed: "", firstSeen: daysAgo(100) } });

			const tracker = new UsageTracker(TEST_DIR);
			const curator = new SkillCurator(tracker, createMockScanner(skills));
			const report = await curator.run();

			expect(report.archived).toContain("forgotten");
		});
	});

	describe("archive", () => {
		it("moves skill directory to .archive/<id>/", () => {
			const skill = makeSkill("to-archive");
			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);

			curator.archive(skill);

			expect(existsSync(join(SKILLS_DIR, "to-archive"))).toBe(false);
			expect(existsSync(join(SKILLS_DIR, ".archive", "to-archive", "SKILL.md"))).toBe(true);
		});

		it("creates .archive/ directory if it does not exist", () => {
			const skill = makeSkill("fresh-archive");
			const archiveDir = join(SKILLS_DIR, ".archive");
			expect(existsSync(archiveDir)).toBe(false);

			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			curator.archive(skill);

			expect(existsSync(archiveDir)).toBe(true);
			expect(existsSync(join(archiveDir, "fresh-archive", "SKILL.md"))).toBe(true);
		});

		it("handles re-archiving with existing archive by timestamping old one", () => {
			const skill = makeSkill("re-archive");
			const archiveDir = join(SKILLS_DIR, ".archive", "re-archive");
			mkdirSync(archiveDir, { recursive: true });
			writeFileSync(join(archiveDir, "SKILL.md"), "old version");

			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			curator.archive(skill);

			expect(existsSync(join(SKILLS_DIR, ".archive", "re-archive", "SKILL.md"))).toBe(true);
			const content = readFileSync(join(SKILLS_DIR, ".archive", "re-archive", "SKILL.md"), "utf-8");
			expect(content).toContain("id: re-archive");
		});
	});

	describe("triggerOverlap", () => {
		it("returns 0 for no overlap", () => {
			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			expect(curator.triggerOverlap(["debug", "fix"], ["deploy", "release"])).toBe(0);
		});

		it("returns correct percentage for partial overlap", () => {
			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			expect(curator.triggerOverlap(
				["debug", "fix", "trace", "investigate"],
				["debug", "fix"],
			)).toBe(1.0);
		});

		it("is case-insensitive", () => {
			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			expect(curator.triggerOverlap(["Debug"], ["debug"])).toBe(1.0);
		});

		it("returns below threshold for incidental overlap", () => {
			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			expect(curator.triggerOverlap(
				["a", "b", "c", "d", "e"],
				["a", "x", "y", "z", "w"],
			)).toBeCloseTo(0.2);
		});
	});

	describe("findMergeCandidates", () => {
		it("calls LLM for pairs with >=30% trigger overlap and returns MERGE candidates", async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: "MERGE: Both handle debugging tasks" } }],
				}),
			});
			vi.stubGlobal("fetch", mockFetch);

			const skills = new Map<string, SkillDefinition>();
			skills.set("debug", makeSkill("debug", {
				triggers: ["debug", "fix bug", "investigate"],
			}));
			skills.set("troubleshoot", makeSkill("troubleshoot", {
				triggers: ["debug", "fix bug", "diagnose"],
			}));

			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			const candidates = await curator.findMergeCandidates(skills);

			expect(mockFetch).toHaveBeenCalledOnce();
			expect(candidates).toHaveLength(1);
			expect(candidates[0].skillA).toBe("debug");
			expect(candidates[0].skillB).toBe("troubleshoot");
			expect(candidates[0].llmReason).toBe("Both handle debugging tasks");
		});

		it("does not call LLM for pairs below threshold", async () => {
			const mockFetch = vi.fn();
			vi.stubGlobal("fetch", mockFetch);

			const skills = new Map<string, SkillDefinition>();
			skills.set("debug", makeSkill("debug", {
				triggers: ["debug", "fix bug", "investigate", "trace"],
			}));
			skills.set("deploy", makeSkill("deploy", {
				triggers: ["deploy", "release", "publish", "ship"],
			}));

			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			const candidates = await curator.findMergeCandidates(skills);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(candidates).toHaveLength(0);
		});

		it("handles LLM failure gracefully", async () => {
			vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

			const skills = new Map<string, SkillDefinition>();
			skills.set("a", makeSkill("a", { triggers: ["debug", "fix"] }));
			skills.set("b", makeSkill("b", { triggers: ["debug", "fix"] }));

			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			const candidates = await curator.findMergeCandidates(skills);

			expect(candidates).toHaveLength(0);
		});

		it("excludes pairs where LLM says NO_MERGE", async () => {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: "NO_MERGE" } }],
				}),
			}));

			const skills = new Map<string, SkillDefinition>();
			skills.set("a", makeSkill("a", { triggers: ["debug", "fix"] }));
			skills.set("b", makeSkill("b", { triggers: ["debug", "fix"] }));

			const curator = new SkillCurator(
				new UsageTracker(TEST_DIR),
				createMockScanner(new Map()),
			);
			const candidates = await curator.findMergeCandidates(skills);

			expect(candidates).toHaveLength(0);
		});
	});

	describe("scanner .archive skip", () => {
		it("SkillScanner scanDirectory skips .archive directories", () => {
			mkdirSync(join(SKILLS_DIR, ".archive", "old-skill"), { recursive: true });
			writeFileSync(
				join(SKILLS_DIR, ".archive", "old-skill", "SKILL.md"),
				"---\nid: old-skill\nname: Old Skill\n---\nArchived.",
			);

			mkdirSync(join(SKILLS_DIR, "active-skill"), { recursive: true });
			writeFileSync(
				join(SKILLS_DIR, "active-skill", "SKILL.md"),
				"---\nid: active-skill\nname: Active Skill\n---\nActive.",
			);

			const scanner = new SkillScanner();
			const skills = scanner.scan();

			expect(skills.has("old-skill")).toBe(false);
		});
	});

	describe("run (integration)", () => {
		it("produces correct report with mixed skill states", async () => {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: "NO_MERGE" } }],
				}),
			}));

			const skills = new Map<string, SkillDefinition>();
			skills.set("bundled-skill", makeSkill("bundled-skill", { source: "bundled" }));
			skills.set("pinned-skill", makeSkill("pinned-skill", { pinned: true }));
			skills.set("recent-skill", makeSkill("recent-skill"));
			skills.set("stale-skill", makeSkill("stale-skill"));
			skills.set("ancient-skill", makeSkill("ancient-skill"));

			writeUsage({
				"bundled-skill": { lastUsed: "", firstSeen: daysAgo(365) },
				"pinned-skill": { lastUsed: "", firstSeen: daysAgo(365) },
				"recent-skill": { lastUsed: daysAgo(5), firstSeen: daysAgo(60) },
				"stale-skill": { lastUsed: daysAgo(45), firstSeen: daysAgo(60) },
				"ancient-skill": { lastUsed: daysAgo(100), firstSeen: daysAgo(200) },
			});

			const tracker = new UsageTracker(TEST_DIR);
			const curator = new SkillCurator(tracker, createMockScanner(skills));
			const report = await curator.run();

			expect(report.kept).toContain("bundled-skill");
			expect(report.kept).toContain("pinned-skill");
			expect(report.kept).toContain("recent-skill");
			expect(report.staled).toContain("stale-skill");
			expect(report.archived).toContain("ancient-skill");

			expect(existsSync(join(SKILLS_DIR, ".archive", "ancient-skill", "SKILL.md"))).toBe(true);
			expect(existsSync(join(SKILLS_DIR, "ancient-skill"))).toBe(false);
		});
	});
});
