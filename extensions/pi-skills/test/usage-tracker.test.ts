import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { UsageTracker } from "../src/usage-tracker.js";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), "pi-test-usage-tracker");
const USAGE_FILE = join(TEST_DIR, ".pi", "skills", ".usage.json");

describe("UsageTracker", () => {
	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	describe("constructor", () => {
		it("initializes with empty data when no file exists", () => {
			const tracker = new UsageTracker(TEST_DIR);
			expect(tracker.getAll()).toEqual({});
		});

		it("loads existing data from file", () => {
			mkdirSync(join(TEST_DIR, ".pi", "skills"), { recursive: true });
			const data = { "debug": { viewCount: 1, matchCount: 2, useCount: 1, lastMatched: "2026-01-01T00:00:00.000Z", lastUsed: "2026-01-01T00:00:00.000Z", avgConfidence: 0.8 } };
			const { writeFileSync } = require("fs");
			writeFileSync(USAGE_FILE, JSON.stringify(data));

			const tracker = new UsageTracker(TEST_DIR);
			expect(tracker.getEntry("debug")).toEqual(data.debug);
		});

		it("handles corrupt file gracefully", () => {
			mkdirSync(join(TEST_DIR, ".pi", "skills"), { recursive: true });
			const { writeFileSync } = require("fs");
			writeFileSync(USAGE_FILE, "not json{{{");

			const tracker = new UsageTracker(TEST_DIR);
			expect(tracker.getAll()).toEqual({});
		});
	});

	describe("recordView", () => {
		it("increments viewCount", () => {
			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordView("debug");
			tracker.recordView("debug");
			expect(tracker.getEntry("debug")!.viewCount).toBe(2);
		});

		it("sets lastViewed timestamp", () => {
			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordView("debug");
			const entry = tracker.getEntry("debug")!;
			expect(entry.lastViewed).toBeTruthy();
			expect(new Date(entry.lastViewed).toISOString()).toBe(entry.lastViewed);
		});
	});

	describe("recordMatch", () => {
		it("increments matchCount and updates lastMatched", () => {
			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordMatch("debug", 0.7);
			const entry = tracker.getEntry("debug")!;
			expect(entry.matchCount).toBe(1);
			expect(entry.avgConfidence).toBe(0.7);
			expect(entry.lastMatched).toBeTruthy();
		});

		it("computes running average correctly", () => {
			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordMatch("debug", 0.6);
			tracker.recordMatch("debug", 0.8);
			tracker.recordMatch("debug", 1.0);
			const entry = tracker.getEntry("debug")!;
			expect(entry.matchCount).toBe(3);
			expect(entry.avgConfidence).toBeCloseTo(0.8, 5);
		});
	});

	describe("recordUse", () => {
		it("increments useCount and updates lastUsed", () => {
			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordUse("debug");
			const entry = tracker.getEntry("debug")!;
			expect(entry.useCount).toBe(1);
			expect(entry.lastUsed).toBeTruthy();
		});
	});

	describe("save", () => {
		it("writes data to disk atomically", () => {
			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordMatch("debug", 0.75);
			tracker.save();

			expect(existsSync(USAGE_FILE)).toBe(true);
			const saved = JSON.parse(readFileSync(USAGE_FILE, "utf-8"));
			expect(saved.debug.matchCount).toBe(1);
			expect(saved.debug.avgConfidence).toBe(0.75);
		});

		it("skips write when not dirty", () => {
			const tracker = new UsageTracker(TEST_DIR);
			tracker.save();
			expect(existsSync(USAGE_FILE)).toBe(false);
		});

		it("creates parent directories", () => {
			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordView("test");
			tracker.save();
			expect(existsSync(USAGE_FILE)).toBe(true);
		});

		it("does not leave .tmp file after successful write", () => {
			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordView("test");
			tracker.save();
			expect(existsSync(USAGE_FILE + ".tmp")).toBe(false);
		});
	});

	describe("round-trip", () => {
		it("persists and reloads correctly", () => {
			const tracker1 = new UsageTracker(TEST_DIR);
			tracker1.recordMatch("debug", 0.7);
			tracker1.recordMatch("debug", 0.9);
			tracker1.recordUse("debug");
			tracker1.recordView("refactor");
			tracker1.save();

			const tracker2 = new UsageTracker(TEST_DIR);
			const debug = tracker2.getEntry("debug")!;
			expect(debug.matchCount).toBe(2);
			expect(debug.useCount).toBe(1);
			expect(debug.avgConfidence).toBeCloseTo(0.8, 5);

			const refactor = tracker2.getEntry("refactor")!;
			expect(refactor.viewCount).toBe(1);
		});
	});

	describe("getEntry", () => {
		it("returns undefined for unknown skill", () => {
			const tracker = new UsageTracker(TEST_DIR);
			expect(tracker.getEntry("nonexistent")).toBeUndefined();
		});
	});

	describe("concurrent-save safety", () => {
		it("read-merge-write preserves both writers' data", () => {
			const tracker1 = new UsageTracker(TEST_DIR);
			const tracker2 = new UsageTracker(TEST_DIR);

			tracker1.recordMatch("skill-a", 0.9);
			tracker2.recordMatch("skill-b", 0.7);

			tracker1.save();
			tracker2.save();

			const final = new UsageTracker(TEST_DIR);
			const a = final.getEntry("skill-a");
			const b = final.getEntry("skill-b");
			expect(a).toBeDefined();
			expect(a!.matchCount).toBe(1);
			expect(a!.avgConfidence).toBe(0.9);
			expect(b).toBeDefined();
			expect(b!.matchCount).toBe(1);
			expect(b!.avgConfidence).toBe(0.7);
			expect(existsSync(USAGE_FILE + ".tmp")).toBe(false);
		});

		it("merge takes higher counts and most recent timestamps", () => {
			const tracker1 = new UsageTracker(TEST_DIR);
			const tracker2 = new UsageTracker(TEST_DIR);

			tracker1.recordMatch("shared", 0.6);
			tracker1.recordMatch("shared", 0.8);

			tracker2.recordMatch("shared", 0.5);
			tracker2.recordMatch("shared", 0.7);
			tracker2.recordMatch("shared", 0.9);

			tracker1.save();
			tracker2.save();

			const final = new UsageTracker(TEST_DIR);
			const entry = final.getEntry("shared")!;
			expect(entry.matchCount).toBe(3);
			expect(entry.avgConfidence).toBeCloseTo(0.7, 5);
		});
	});

	describe("firstSeen backfill", () => {
		it("backfills firstSeen on legacy entries missing it", () => {
			mkdirSync(join(TEST_DIR, ".pi", "skills"), { recursive: true });
			const { writeFileSync } = require("fs");
			const legacy = {
				"old-skill": {
					viewCount: 5, matchCount: 2, useCount: 1,
					lastViewed: "2026-01-01T00:00:00.000Z",
					lastMatched: "2026-01-01T00:00:00.000Z",
					lastUsed: "2026-01-01T00:00:00.000Z",
					avgConfidence: 0.8,
				},
			};
			writeFileSync(USAGE_FILE, JSON.stringify(legacy));

			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordView("old-skill");
			const entry = tracker.getEntry("old-skill")!;
			expect(entry.firstSeen).toBeTruthy();
			expect(new Date(entry.firstSeen).toISOString()).toBe(entry.firstSeen);
		});

		it("does not overwrite existing firstSeen", () => {
			mkdirSync(join(TEST_DIR, ".pi", "skills"), { recursive: true });
			const { writeFileSync } = require("fs");
			const existing = {
				"skill-with-firstseen": {
					viewCount: 5, matchCount: 2, useCount: 1,
					lastViewed: "2026-01-01T00:00:00.000Z",
					lastMatched: "2026-01-01T00:00:00.000Z",
					lastUsed: "2026-01-01T00:00:00.000Z",
					avgConfidence: 0.8,
					firstSeen: "2025-06-15T00:00:00.000Z",
				},
			};
			writeFileSync(USAGE_FILE, JSON.stringify(existing));

			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordView("skill-with-firstseen");
			const entry = tracker.getEntry("skill-with-firstseen")!;
			expect(entry.firstSeen).toBe("2025-06-15T00:00:00.000Z");
		});
	});

	describe("timestamps", () => {
		it("produces valid ISO timestamps", () => {
			const tracker = new UsageTracker(TEST_DIR);
			tracker.recordMatch("test", 0.5);
			tracker.recordUse("test");
			const entry = tracker.getEntry("test")!;
			expect(() => new Date(entry.lastMatched)).not.toThrow();
			expect(new Date(entry.lastMatched).toISOString()).toBe(entry.lastMatched);
			expect(() => new Date(entry.lastUsed)).not.toThrow();
			expect(new Date(entry.lastUsed).toISOString()).toBe(entry.lastUsed);
		});
	});
});
