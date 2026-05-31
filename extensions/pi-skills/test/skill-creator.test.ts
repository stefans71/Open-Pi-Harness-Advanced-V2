import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SkillCreator } from "../src/skill-creator.js";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), "pi-test-skill-creator");
const EVENTS_DIR = join(TEST_DIR, "artifacts");
const EVENTS_PATH = join(EVENTS_DIR, "events.jsonl");

const SAMPLE_EVENTS = [
	{ event: "workflow_start", workflow: "refactor", nodeCount: 4, timestamp: 1000 },
	{ event: "node_start", nodeId: "analyze", nodeType: "prompt", timestamp: 1001 },
	{ event: "tool_call_selected", tool: "read", argKeys: ["path"], nodeId: "analyze", timestamp: 1002 },
	{ event: "node_complete", nodeId: "analyze", outputLength: 500, timestamp: 1003 },
	{ event: "node_start", nodeId: "plan", nodeType: "prompt", timestamp: 1004 },
	{ event: "node_complete", nodeId: "plan", outputLength: 300, timestamp: 1005 },
	{ event: "node_start", nodeId: "execute", nodeType: "prompt", timestamp: 1006 },
	{ event: "tool_call_selected", tool: "edit", argKeys: ["path", "oldText"], nodeId: "execute", timestamp: 1007 },
	{ event: "node_complete", nodeId: "execute", outputLength: 800, timestamp: 1008 },
	{ event: "node_start", nodeId: "verify", nodeType: "prompt", timestamp: 1009 },
	{ event: "respond_tool_captured", outputLength: 200, nodeId: "verify", timestamp: 1010 },
	{ event: "node_complete", nodeId: "verify", outputLength: 200, timestamp: 1011 },
	{ event: "workflow_end", workflow: "refactor", status: "completed", elapsed: 5000, timestamp: 1012 },
];

const SKILL_MD_RESPONSE = `---
id: refactor-patterns
name: Refactor Patterns
version: 1.0.0
triggers: [refactor, restructure, clean up code]
tags: [code-quality]
tools_required: [read, edit]
providers: [ollama]
estimated_turns: 3-5
---

# Refactor Patterns

Instructions for systematic refactoring.`;

function writeEvents(events: object[]): void {
	mkdirSync(EVENTS_DIR, { recursive: true });
	writeFileSync(EVENTS_PATH, events.map((e) => JSON.stringify(e)).join("\n"));
}

describe("SkillCreator", () => {
	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		try {
			rmSync(join(process.cwd(), ".pi", "skills", "agent-created"), { recursive: true, force: true });
		} catch {}
	});

	describe("createFromTrace", () => {
		it("returns null when fewer than 3 node_complete events", async () => {
			const twoNodes = SAMPLE_EVENTS.filter(
				(e) => e.event !== "node_complete" || e.nodeId === "analyze" || e.nodeId === "plan",
			);
			writeEvents(twoNodes);

			const creator = new SkillCreator();
			const result = await creator.createFromTrace(EVENTS_PATH, "test", "do something");
			expect(result).toBeNull();
		});

		it("returns null when LLM responds with NO_SKILL", async () => {
			writeEvents(SAMPLE_EVENTS);
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ choices: [{ message: { content: "NO_SKILL" } }] }),
			}));

			const creator = new SkillCreator();
			const result = await creator.createFromTrace(EVENTS_PATH, "refactor", "refactor the code");
			expect(result).toBeNull();
		});

		it("writes SKILL.md on valid LLM response", async () => {
			writeEvents(SAMPLE_EVENTS);
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ choices: [{ message: { content: SKILL_MD_RESPONSE } }] }),
			}));

			const creator = new SkillCreator();
			const result = await creator.createFromTrace(EVENTS_PATH, "refactor", "refactor the code");
			expect(result).not.toBeNull();
			expect(result).toContain("agent-created");
			expect(result).toContain("refactor-patterns");
			expect(existsSync(result!)).toBe(true);
			expect(readFileSync(result!, "utf-8")).toBe(SKILL_MD_RESPONSE);
		});

		it("generates fallback id when frontmatter has no id", async () => {
			writeEvents(SAMPLE_EVENTS);
			const noIdContent = "---\nname: No Id\n---\nSome instructions";
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ choices: [{ message: { content: noIdContent } }] }),
			}));

			const creator = new SkillCreator();
			const result = await creator.createFromTrace(EVENTS_PATH, "my workflow", "task");
			expect(result).not.toBeNull();
			expect(result).toContain("my-workflow-");
		});

		it("sanitizes path traversal in LLM-returned id", async () => {
			writeEvents(SAMPLE_EVENTS);
			const maliciousContent = "---\nid: ../../etc/evil\nname: Evil\n---\nMalicious";
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ choices: [{ message: { content: maliciousContent } }] }),
			}));

			const creator = new SkillCreator();
			const result = await creator.createFromTrace(EVENTS_PATH, "test", "task");
			expect(result).not.toBeNull();
			expect(result).toContain("agent-created");
			expect(result).not.toContain("..");
		});

		it("sends correct request to LLM", async () => {
			writeEvents(SAMPLE_EVENTS);
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ choices: [{ message: { content: "NO_SKILL" } }] }),
			});
			vi.stubGlobal("fetch", mockFetch);

			const creator = new SkillCreator("http://test:1234", "test-model");
			await creator.createFromTrace(EVENTS_PATH, "refactor", "refactor code");

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toBe("http://test:1234/v1/chat/completions");
			const body = JSON.parse(options.body);
			expect(body.model).toBe("test-model");
			expect(body.temperature).toBe(0.3);
			expect(body.messages[0].content).toContain("refactor");
		});

		it("throws on LLM error", async () => {
			writeEvents(SAMPLE_EVENTS);
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			}));

			const creator = new SkillCreator();
			await expect(creator.createFromTrace(EVENTS_PATH, "test", "task")).rejects.toThrow("LLM request failed");
		});
	});

	describe("readEvents", () => {
		it("returns empty array for missing file", () => {
			const creator = new SkillCreator();
			const events = (creator as any).readEvents("/nonexistent/path");
			expect(events).toEqual([]);
		});

		it("skips malformed lines", () => {
			mkdirSync(EVENTS_DIR, { recursive: true });
			writeFileSync(EVENTS_PATH, '{"event":"ok"}\nnot json\n{"event":"also_ok"}');

			const creator = new SkillCreator();
			const events = (creator as any).readEvents(EVENTS_PATH);
			expect(events).toHaveLength(2);
			expect(events[0].event).toBe("ok");
			expect(events[1].event).toBe("also_ok");
		});

		it("handles empty file", () => {
			mkdirSync(EVENTS_DIR, { recursive: true });
			writeFileSync(EVENTS_PATH, "");

			const creator = new SkillCreator();
			const events = (creator as any).readEvents(EVENTS_PATH);
			expect(events).toEqual([]);
		});
	});

	describe("summarizeTrace", () => {
		it("produces readable summary", () => {
			const creator = new SkillCreator();
			const summary = (creator as any).summarizeTrace(SAMPLE_EVENTS);
			expect(summary).toContain("Workflow: refactor");
			expect(summary).toContain("Node: analyze");
			expect(summary).toContain("Tool: read");
			expect(summary).toContain("Tool: edit");
			expect(summary).toContain("Result: completed");
		});
	});
});
