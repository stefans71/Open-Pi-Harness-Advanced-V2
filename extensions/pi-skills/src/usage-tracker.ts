import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { join, dirname } from "path";

export interface SkillUsageEntry {
	viewCount: number;
	matchCount: number;
	useCount: number;
	lastViewed: string;
	lastMatched: string;
	lastUsed: string;
	avgConfidence: number;
	firstSeen: string;
}

export class UsageTracker {
	private data: Record<string, SkillUsageEntry>;
	private filePath: string;
	private dirty = false;

	constructor(cwd: string) {
		this.filePath = join(cwd, ".pi", "skills", ".usage.json");
		try {
			this.data = JSON.parse(readFileSync(this.filePath, "utf-8"));
		} catch {
			this.data = {};
		}
	}

	recordView(skillId: string): void {
		const entry = this.ensureEntry(skillId);
		entry.viewCount++;
		entry.lastViewed = new Date().toISOString();
		this.dirty = true;
	}

	recordMatch(skillId: string, confidence: number): void {
		const entry = this.ensureEntry(skillId);
		entry.matchCount++;
		entry.avgConfidence =
			((entry.avgConfidence * (entry.matchCount - 1)) + confidence) / entry.matchCount;
		entry.lastMatched = new Date().toISOString();
		this.dirty = true;
	}

	recordUse(skillId: string): void {
		const entry = this.ensureEntry(skillId);
		entry.useCount++;
		entry.lastUsed = new Date().toISOString();
		this.dirty = true;
	}

	getEntry(skillId: string): SkillUsageEntry | undefined {
		return this.data[skillId];
	}

	getAll(): Record<string, SkillUsageEntry> {
		return this.data;
	}

	save(): void {
		if (!this.dirty) return;
		mkdirSync(dirname(this.filePath), { recursive: true });

		let onDisk: Record<string, SkillUsageEntry> = {};
		try {
			onDisk = JSON.parse(readFileSync(this.filePath, "utf-8"));
		} catch {
			// no file or corrupt — start from empty
		}

		const merged: Record<string, SkillUsageEntry> = { ...onDisk };
		for (const [id, entry] of Object.entries(this.data)) {
			const existing = merged[id];
			if (!existing) {
				merged[id] = entry;
			} else {
				merged[id] = {
					viewCount: Math.max(existing.viewCount, entry.viewCount),
					matchCount: Math.max(existing.matchCount, entry.matchCount),
					useCount: Math.max(existing.useCount, entry.useCount),
					lastViewed: existing.lastViewed > entry.lastViewed ? existing.lastViewed : entry.lastViewed,
					lastMatched: existing.lastMatched > entry.lastMatched ? existing.lastMatched : entry.lastMatched,
					lastUsed: existing.lastUsed > entry.lastUsed ? existing.lastUsed : entry.lastUsed,
					avgConfidence: entry.matchCount >= existing.matchCount ? entry.avgConfidence : existing.avgConfidence,
					firstSeen: (existing.firstSeen && (!entry.firstSeen || existing.firstSeen < entry.firstSeen))
						? existing.firstSeen : (entry.firstSeen || ""),
				};
			}
		}

		const tmpPath = this.filePath + ".tmp";
		writeFileSync(tmpPath, JSON.stringify(merged, null, 2));
		renameSync(tmpPath, this.filePath);
		this.dirty = false;
	}

	private ensureEntry(skillId: string): SkillUsageEntry {
		if (!this.data[skillId]) {
			this.data[skillId] = {
				viewCount: 0,
				matchCount: 0,
				useCount: 0,
				lastViewed: "",
				lastMatched: "",
				lastUsed: "",
				avgConfidence: 0,
				firstSeen: new Date().toISOString(),
			};
		} else if (!this.data[skillId].firstSeen) {
			this.data[skillId].firstSeen = new Date().toISOString();
			this.dirty = true;
		}
		return this.data[skillId];
	}
}
