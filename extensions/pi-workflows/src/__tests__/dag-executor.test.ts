import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowExecutor, _resetSharedState } from "../executor.js";
import { validateWorkflow } from "../schema.js";

beforeEach(() => {
	_resetSharedState();
});

function createMockPi() {
	const handlers: Record<string, Array<(...args: any[]) => any>> = {};
	const registeredTools: Record<string, any> = {};
	return {
		on: vi.fn((event: string, handler: (...args: any[]) => any) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		setActiveTools: vi.fn(),
		getActiveTools: vi.fn(() => ["read", "write", "bash"]),
		getAllTools: vi.fn(() => ["read", "write", "bash"]),
		sendUserMessage: vi.fn(),
		sendMessage: vi.fn(),
		appendEntry: vi.fn(),
		registerCommand: vi.fn(),
		registerTool: vi.fn((def: any) => {
			registeredTools[def.name] = def;
		}),
		events: { emit: vi.fn() },
		_handlers: handlers,
		_registeredTools: registeredTools,
		_fire(event: string, ...args: any[]) {
			const list = handlers[event] ?? [];
			for (const h of list) {
				const result = h(...args);
				if (result !== undefined) return result;
			}
		},
	};
}

function setupExecutor() {
	const mockPi = createMockPi();
	const executor: any = new WorkflowExecutor(mockPi as any);
	executor.artifactsDir = "/tmp/test-artifacts";
	executor.cwd = "/tmp";
	executor.state = {
		workflowName: "test",
		currentNodeIndex: 0,
		totalNodes: 1,
		outputs: new Map(),
		startedAt: Date.now(),
		status: "running",
	};
	executor.logEvent = vi.fn();
	return { executor, mockPi };
}

function mockCtx() {
	return {
		cwd: "/tmp",
		ui: { notify: vi.fn(), confirm: vi.fn(), input: vi.fn() },
		isIdle: vi.fn().mockReturnValue(true),
		waitForIdle: vi.fn().mockResolvedValue(undefined),
	};
}

// ============================================================================
// DAG Routing
// ============================================================================
describe("DAG routing in run()", () => {
	it("linear workflow (no depends_on/when/loop/cancel) takes runFrom path", async () => {
		const { executor } = setupExecutor();
		const runFromSpy = vi.fn().mockResolvedValue(undefined);
		const runDagSpy = vi.fn().mockResolvedValue(undefined);
		executor.runFrom = runFromSpy;
		executor.runDag = runDagSpy;

		const workflow = {
			name: "linear",
			nodes: [
				{ id: "a", type: "prompt", prompt: "do a" },
				{ id: "b", type: "bash", command: "echo b" },
			],
		};
		const ctx = {
			...mockCtx(),
			cwd: "/tmp",
		};

		await executor.run(workflow, "task", ctx as any);

		expect(runFromSpy).toHaveBeenCalledTimes(1);
		expect(runDagSpy).not.toHaveBeenCalled();
	});

	it("workflow with depends_on takes runDag path", async () => {
		const { executor } = setupExecutor();
		const runFromSpy = vi.fn().mockResolvedValue(undefined);
		const runDagSpy = vi.fn().mockResolvedValue(undefined);
		executor.runFrom = runFromSpy;
		executor.runDag = runDagSpy;

		const workflow = {
			name: "dag",
			nodes: [
				{ id: "a", type: "prompt", prompt: "do a" },
				{ id: "b", type: "prompt", prompt: "do b", depends_on: ["a"] },
			],
		};
		const ctx = { ...mockCtx(), cwd: "/tmp" };

		await executor.run(workflow, "task", ctx as any);

		expect(runDagSpy).toHaveBeenCalledTimes(1);
		expect(runFromSpy).not.toHaveBeenCalled();
	});

	it("workflow with cancel node takes runDag path", async () => {
		const { executor } = setupExecutor();
		const runFromSpy = vi.fn().mockResolvedValue(undefined);
		const runDagSpy = vi.fn().mockResolvedValue(undefined);
		executor.runFrom = runFromSpy;
		executor.runDag = runDagSpy;

		const workflow = {
			name: "cancel-wf",
			nodes: [
				{ id: "a", type: "prompt", prompt: "do a" },
				{ id: "fail", type: "cancel", message: "abort" },
			],
		};
		const ctx = { ...mockCtx(), cwd: "/tmp" };

		await executor.run(workflow, "task", ctx as any);

		expect(runDagSpy).toHaveBeenCalledTimes(1);
		expect(runFromSpy).not.toHaveBeenCalled();
	});

	it("workflow with when condition takes runDag path", async () => {
		const { executor } = setupExecutor();
		const runFromSpy = vi.fn().mockResolvedValue(undefined);
		const runDagSpy = vi.fn().mockResolvedValue(undefined);
		executor.runFrom = runFromSpy;
		executor.runDag = runDagSpy;

		const workflow = {
			name: "conditional",
			nodes: [
				{ id: "a", type: "prompt", prompt: "do a" },
				{ id: "b", type: "prompt", prompt: "do b", when: "$a.output == 'yes'" },
			],
		};
		const ctx = { ...mockCtx(), cwd: "/tmp" };

		await executor.run(workflow, "task", ctx as any);

		expect(runDagSpy).toHaveBeenCalledTimes(1);
		expect(runFromSpy).not.toHaveBeenCalled();
	});
});

// ============================================================================
// executeNode — cancel and loop
// ============================================================================
describe("executeNode for new types", () => {
	it("cancel node throws WorkflowCancelled with message", async () => {
		const { executor } = setupExecutor();
		const ctx = mockCtx();

		const node = { id: "stop", type: "cancel", message: "deployment blocked" };
		await expect(executor.executeNode(node, ctx)).rejects.toThrow("deployment blocked");

		try {
			await executor.executeNode(node, ctx);
		} catch (err: any) {
			expect(err.name).toBe("WorkflowCancelled");
		}
	});

	it("loop node runs iterations and exits on until signal", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		const ctx = mockCtx();

		let callCount = 0;
		executor.executeWithRetry = vi.fn().mockImplementation(() => {
			callCount++;
			return callCount === 2 ? "DONE" : "still working";
		});

		const node = { id: "iter", type: "loop", prompt: "fix $ITERATION", max_iterations: 5, until: "DONE" };
		const result = await executor.executeNode(node, ctx);
		expect(result).toBe("DONE");
		expect(executor.executeWithRetry).toHaveBeenCalledTimes(2);
	});
});

// ============================================================================
// runDag — condition evaluation
// ============================================================================
describe("runDag condition evaluation", () => {
	it("when: false skips node, no output recorded", async () => {
		const { executor } = setupExecutor();
		executor.executeWithRetry = vi.fn().mockResolvedValue("output");
		executor.writeWorkflowState = vi.fn();

		const steps = [
			{
				nodes: [{ id: "a", type: "prompt", prompt: "do a" }],
				executionMode: "serialized" as const,
			},
			{
				nodes: [{ id: "b", type: "prompt", prompt: "do b", when: "$a.output == 'yes'" }],
				executionMode: "serialized" as const,
			},
		];
		const allNodes = steps.flatMap(s => s.nodes);
		const ctx = mockCtx();

		// First node produces "no"
		executor.executeWithRetry = vi.fn().mockImplementation(async (node: any) => {
			if (node.id === "a") return "no";
			return "should-not-run";
		});

		await executor.runDag(steps, allNodes, "task", ctx);

		expect(executor.executeWithRetry).toHaveBeenCalledTimes(1);
		expect(executor.state.outputs.has("b")).toBe(false);
		expect(executor.skippedNodes.has("b")).toBe(true);
		expect(executor.completedNodes.has("b")).toBe(false);
	});

	it("when: true runs node normally", async () => {
		const { executor } = setupExecutor();
		executor.writeWorkflowState = vi.fn();

		const steps = [
			{
				nodes: [{ id: "a", type: "prompt", prompt: "do a" }],
				executionMode: "serialized" as const,
			},
			{
				nodes: [{ id: "b", type: "prompt", prompt: "do b", when: "$a.output == 'yes'" }],
				executionMode: "serialized" as const,
			},
		];
		const allNodes = steps.flatMap(s => s.nodes);
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn().mockImplementation(async (node: any) => {
			if (node.id === "a") return "yes";
			return "b-ran";
		});

		await executor.runDag(steps, allNodes, "task", ctx);

		expect(executor.executeWithRetry).toHaveBeenCalledTimes(2);
		expect(executor.state.outputs.get("b")).toBe("b-ran");
	});

	it("skipped node's undefined output causes downstream when to return false", async () => {
		const { executor } = setupExecutor();
		executor.writeWorkflowState = vi.fn();

		const steps = [
			{
				nodes: [{ id: "a", type: "prompt", prompt: "do a" }],
				executionMode: "serialized" as const,
			},
			{
				nodes: [{ id: "b", type: "prompt", prompt: "do b", when: "$a.output == 'yes'" }],
				executionMode: "serialized" as const,
			},
			{
				nodes: [{ id: "c", type: "prompt", prompt: "do c", when: "$b.output == 'done'" }],
				executionMode: "serialized" as const,
			},
		];
		const allNodes = steps.flatMap(s => s.nodes);
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn().mockImplementation(async (node: any) => {
			if (node.id === "a") return "no";
			return "ran";
		});

		await executor.runDag(steps, allNodes, "task", ctx);

		// a ran, b skipped (when false), c skipped (b has no output → undefined)
		expect(executor.executeWithRetry).toHaveBeenCalledTimes(1);
		expect(executor.skippedNodes.has("b")).toBe(true);
		expect(executor.skippedNodes.has("c")).toBe(true);
		expect(executor.completedNodes.has("b")).toBe(false);
		expect(executor.completedNodes.has("c")).toBe(false);
		expect(executor.state.outputs.has("b")).toBe(false);
		expect(executor.state.outputs.has("c")).toBe(false);
	});
});

// ============================================================================
// runDag — events
// ============================================================================
describe("runDag event emission", () => {
	it("emits dag_layer_start and condition_evaluated events", async () => {
		const { executor } = setupExecutor();
		executor.writeWorkflowState = vi.fn();
		const events: any[] = [];
		executor.logEvent = vi.fn((e: any) => events.push(e));

		const steps = [
			{
				nodes: [{ id: "a", type: "prompt", prompt: "do a" }],
				executionMode: "serialized" as const,
			},
			{
				nodes: [{ id: "b", type: "prompt", prompt: "do b", when: "$a.output == 'go'" }],
				executionMode: "serialized" as const,
			},
		];
		const allNodes = steps.flatMap(s => s.nodes);
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn().mockImplementation(async (node: any) => {
			if (node.id === "a") return "go";
			return "b-done";
		});

		await executor.runDag(steps, allNodes, "task", ctx);

		const layerStartEvents = events.filter(e => e.event === "dag_layer_start");
		expect(layerStartEvents).toHaveLength(2);
		expect(layerStartEvents[0].layerIndex).toBe(0);
		expect(layerStartEvents[0].nodeIds).toEqual(["a"]);
		expect(layerStartEvents[1].layerIndex).toBe(1);

		const condEvents = events.filter(e => e.event === "condition_evaluated");
		expect(condEvents).toHaveLength(1);
		expect(condEvents[0].nodeId).toBe("b");
		expect(condEvents[0].result).toBe(true);
	});
});

// ============================================================================
// runBashParallelStep — state write batching
// ============================================================================
describe("runBashParallelStep", () => {
	it("writes state ONCE after all parallel nodes complete", async () => {
		const { executor } = setupExecutor();
		const writeStateSpy = vi.fn();
		executor.writeWorkflowState = writeStateSpy;

		const step = {
			nodes: [
				{ id: "lint", type: "bash", command: "npm run lint" },
				{ id: "test", type: "bash", command: "npm test" },
				{ id: "build", type: "bash", command: "npm run build" },
			],
			executionMode: "bash_parallel" as const,
		};

		executor.executeWithRetry = vi.fn().mockImplementation(async (node: any) => {
			return `${node.id}-output`;
		});

		const ctx = mockCtx();
		await executor.runBashParallelStep(step, "task", ctx);

		expect(writeStateSpy).toHaveBeenCalledTimes(1);
		expect(executor.state.outputs.get("lint")).toBe("lint-output");
		expect(executor.state.outputs.get("test")).toBe("test-output");
		expect(executor.state.outputs.get("build")).toBe("build-output");
		expect(executor.completedNodes.size).toBe(3);
	});

	it("evaluates when conditions in parallel step", async () => {
		const { executor } = setupExecutor();
		executor.writeWorkflowState = vi.fn();
		executor.state.outputs.set("a", "skip");

		const step = {
			nodes: [
				{ id: "lint", type: "bash", command: "lint", when: "$a.output == 'run'" },
				{ id: "test", type: "bash", command: "test" },
			],
			executionMode: "bash_parallel" as const,
		};

		executor.executeWithRetry = vi.fn().mockResolvedValue("done");

		await executor.runBashParallelStep(step, "task", mockCtx());

		// lint skipped (when false), test ran
		expect(executor.executeWithRetry).toHaveBeenCalledTimes(1);
		expect(executor.skippedNodes.has("lint")).toBe(true);
		expect(executor.completedNodes.has("lint")).toBe(false);
		expect(executor.completedNodes.has("test")).toBe(true);
	});
});

// ============================================================================
// collectUpstreamArtifacts
// ============================================================================
describe("collectUpstreamArtifacts", () => {
	it("traverses transitive upstream using resolvedArtifacts", () => {
		const { executor } = setupExecutor();
		executor.completedNodes = new Set(["code", "lint", "gate"]);
		executor.resolvedArtifacts = new Map([["code", ["/tmp/src/main.ts"]]]);

		const allNodes = [
			{ id: "code", type: "prompt", prompt: "write code" },
			{ id: "lint", type: "bash", command: "npm run lint", depends_on: ["code"] },
			{ id: "gate", type: "approval", message: "approve?", on_reject: "cancel", depends_on: ["lint"] },
		];

		const artifacts = executor.collectUpstreamArtifacts(allNodes[2], allNodes);
		expect(artifacts).toEqual(["/tmp/src/main.ts"]);
	});

	it("skips when-skipped prompts (in skippedNodes, not completedNodes)", () => {
		const { executor } = setupExecutor();
		executor.completedNodes = new Set(["code-main"]);
		executor.skippedNodes = new Set(["code-alt"]);
		executor.resolvedArtifacts = new Map([["code-main", ["/tmp/main.ts"]]]);

		const allNodes = [
			{ id: "code-main", type: "prompt", prompt: "main path" },
			{ id: "code-alt", type: "prompt", prompt: "alt path" },
			{ id: "gate", type: "approval", message: "approve?", on_reject: "cancel", depends_on: ["code-main", "code-alt"] },
		];

		const artifacts = executor.collectUpstreamArtifacts(allNodes[2], allNodes);
		expect(artifacts).toEqual(["/tmp/main.ts"]);
	});

	it("uses resolved (absolute) paths, not raw expected_artifacts", () => {
		const { executor } = setupExecutor();
		executor.completedNodes = new Set(["code"]);
		executor.resolvedArtifacts = new Map([["code", ["/absolute/path/src/main.ts"]]]);

		const allNodes = [
			{ id: "code", type: "prompt", prompt: "write", expected_artifacts: ["$ARTIFACTS_DIR/main.ts"] },
			{ id: "gate", type: "approval", message: "ok?", on_reject: "cancel", depends_on: ["code"] },
		];

		const artifacts = executor.collectUpstreamArtifacts(allNodes[1], allNodes);
		expect(artifacts).toEqual(["/absolute/path/src/main.ts"]);
		expect(artifacts[0]).not.toContain("$ARTIFACTS_DIR");
	});

	it("returns empty for approval with no upstream artifacts", () => {
		const { executor } = setupExecutor();
		executor.completedNodes = new Set(["lint"]);

		const allNodes = [
			{ id: "lint", type: "bash", command: "lint", depends_on: undefined },
			{ id: "gate", type: "approval", message: "ok?", on_reject: "cancel", depends_on: ["lint"] },
		];

		const artifacts = executor.collectUpstreamArtifacts(allNodes[1], allNodes);
		expect(artifacts).toEqual([]);
	});
});

// ============================================================================
// Approval pre-gate fallback (no depends_on)
// ============================================================================
describe("approval pre-gate fallback in runDag", () => {
	it("approval without depends_on falls back to last completed prompt's artifacts", async () => {
		const { executor } = setupExecutor();
		executor.writeWorkflowState = vi.fn();
		executor.resolvedArtifacts = new Map([["code", ["/tmp/test-file.ts"]]]);

		const steps: any[] = [
			{
				nodes: [{ id: "code", type: "prompt", prompt: "write code" }],
				executionMode: "serialized",
			},
			{
				nodes: [{
					id: "gate", type: "approval", message: "approve?",
					on_reject: "cancel", when: "$code.output == 'done'"
				}],
				executionMode: "serialized",
			},
		];
		const allNodes = steps.flatMap(s => s.nodes);

		executor.executeWithRetry = vi.fn().mockImplementation(async (node: any) => {
			if (node.id === "code") return "done";
			return "[approved]";
		});

		// The approval node has no depends_on but enters DAG mode via when:.
		// The gate should use the fallback (last completed prompt) for artifact check.
		// Since /tmp/test-file.ts doesn't exist, it should throw WorkflowFailed.
		await expect(executor.runDag(steps, allNodes, "task", mockCtx()))
			.rejects.toThrow(/missing artifacts/);
	});
});

// ============================================================================
// resolveVariables — dot-notation
// ============================================================================
describe("resolveVariables dot-notation", () => {
	it("resolves $nodeId.output to raw string (backwards compatible)", () => {
		const { executor } = setupExecutor();
		executor.state.outputs.set("classify", "bug");

		const node = { id: "fix", type: "prompt", prompt: "Fix: $classify.output" };
		const result = executor.resolveVariables(node, "task");
		expect(result.prompt).toBe("Fix: bug");
	});

	it("resolves $nodeId.output.field into JSON", () => {
		const { executor } = setupExecutor();
		executor.state.outputs.set("classify", '{"type": "bug", "severity": "high"}');

		const node = { id: "fix", type: "prompt", prompt: "Type: $classify.output.type, Sev: $classify.output.severity" };
		const result = executor.resolveVariables(node, "task");
		expect(result.prompt).toBe("Type: bug, Sev: high");
	});

	it("resolves nested dot-notation", () => {
		const { executor } = setupExecutor();
		executor.state.outputs.set("analyze", '{"data": {"count": 42}}');

		const node = { id: "report", type: "prompt", prompt: "Count: $analyze.output.data.count" };
		const result = executor.resolveVariables(node, "task");
		expect(result.prompt).toBe("Count: 42");
	});

	it("returns empty string for non-JSON output with dot-notation", () => {
		const { executor } = setupExecutor();
		executor.state.outputs.set("bash-node", "just plain text");

		const node = { id: "next", type: "prompt", prompt: "Val: $bash-node.output.field" };
		const result = executor.resolveVariables(node, "task");
		expect(result.prompt).toBe("Val: ");
	});

	it("returns empty string for missing JSON field", () => {
		const { executor } = setupExecutor();
		executor.state.outputs.set("a", '{"type": "bug"}');

		const node = { id: "b", type: "prompt", prompt: "X: $a.output.nosuchfield" };
		const result = executor.resolveVariables(node, "task");
		expect(result.prompt).toBe("X: ");
	});

	it("works with hyphenated node IDs", () => {
		const { executor } = setupExecutor();
		executor.state.outputs.set("gate-prd", '{"status": "approved"}');

		const node = { id: "next", type: "prompt", prompt: "Status: $gate-prd.output.status" };
		const result = executor.resolveVariables(node, "task");
		expect(result.prompt).toBe("Status: approved");
	});

	it("resolves dot-notation in bash command", () => {
		const { executor } = setupExecutor();
		executor.state.outputs.set("config", '{"port": 8080}');

		const node = { id: "run", type: "bash", command: "curl localhost:$config.output.port/health" };
		const result = executor.resolveVariables(node, "task");
		expect(result.command).toBe("curl localhost:8080/health");
	});

	it("resolves dot-notation in cancel message", () => {
		const { executor } = setupExecutor();
		executor.state.outputs.set("check", '{"reason": "tests failing"}');

		const node = { id: "stop", type: "cancel", message: "Abort: $check.output.reason" };
		const result = executor.resolveVariables(node, "task");
		expect(result.message).toBe("Abort: tests failing");
	});

	it("handles node IDs with regex metacharacters", () => {
		const { executor } = setupExecutor();
		executor.state.outputs.set("node+1", "value from node+1");

		const node = { id: "use", type: "prompt", prompt: "Result: $node+1.output" };
		const result = executor.resolveVariables(node, "task");
		expect(result.prompt).toBe("Result: value from node+1");
	});
});

// ============================================================================
// Phase 4b: Loop Execution
// ============================================================================
describe("executeLoopNode", () => {
	it("exits on until signal", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		const ctx = mockCtx();

		let callCount = 0;
		executor.executeWithRetry = vi.fn().mockImplementation(() => {
			callCount++;
			return callCount === 3 ? "ALL_TESTS_PASS" : "still fixing";
		});

		const node = { id: "fix-loop", type: "loop", prompt: "fix iteration $ITERATION", max_iterations: 10, until: "ALL_TESTS_PASS" };
		const result = await executor.executeNode(node, ctx);
		expect(result).toBe("ALL_TESTS_PASS");
		expect(executor.executeWithRetry).toHaveBeenCalledTimes(3);
	});

	it("throws WorkflowFailed on max_iterations exhaustion", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn().mockResolvedValue("nope");

		const node = { id: "fix-loop", type: "loop", prompt: "fix", max_iterations: 3, until: "DONE" };
		await expect(executor.executeNode(node, ctx)).rejects.toThrow(/exhausted 3 iterations/);
	});

	it("throws on exhaustion when no until is set", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn().mockResolvedValue("output");

		const node = { id: "loop-no-until", type: "loop", prompt: "iterate", max_iterations: 2 };
		await expect(executor.executeNode(node, ctx)).rejects.toThrow(/exhausted 2 iterations/);
		expect(executor.executeWithRetry).toHaveBeenCalledTimes(2);
	});

	it("resolves $ITERATION per iteration", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		const ctx = mockCtx();

		const prompts: string[] = [];
		executor.executeWithRetry = vi.fn().mockImplementation((node: any) => {
			prompts.push(node.prompt);
			return prompts.length === 3 ? "DONE" : "working";
		});

		const node = { id: "iter", type: "loop", prompt: "Step $ITERATION of loop", max_iterations: 5, until: "DONE" };
		await executor.executeNode(node, ctx);
		expect(prompts).toEqual(["Step 0 of loop", "Step 1 of loop", "Step 2 of loop"]);
	});

	it("emits loop_iteration events", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn()
			.mockResolvedValueOnce("working")
			.mockResolvedValueOnce("DONE");

		const node = { id: "loop", type: "loop", prompt: "fix", max_iterations: 5, until: "DONE" };
		await executor.executeNode(node, ctx);

		const iterEvents = executor.logEvent.mock.calls
			.filter((c: any) => c[0].event === "loop_iteration")
			.map((c: any) => c[0]);
		expect(iterEvents).toHaveLength(2);
		expect(iterEvents[0]).toEqual(expect.objectContaining({
			event: "loop_iteration", nodeId: "loop", iteration: 0, signalDetected: false,
		}));
		expect(iterEvents[1]).toEqual(expect.objectContaining({
			event: "loop_iteration", nodeId: "loop", iteration: 1, signalDetected: true,
		}));
	});

	it("emits loop_exhausted on exhaustion", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn().mockResolvedValue("nope");

		const node = { id: "loop", type: "loop", prompt: "fix", max_iterations: 2, until: "DONE" };
		await expect(executor.executeNode(node, ctx)).rejects.toThrow();

		const exhaustedEvents = executor.logEvent.mock.calls
			.filter((c: any) => c[0].event === "loop_exhausted");
		expect(exhaustedEvents).toHaveLength(1);
		expect(exhaustedEvents[0][0]).toEqual(expect.objectContaining({
			nodeId: "loop", maxIterations: 2,
		}));
	});

	it("stores resolved artifacts in resolvedArtifacts on success", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		executor.cwd = "/tmp";
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn().mockResolvedValue("DONE");

		const node = {
			id: "loop", type: "loop", prompt: "fix", max_iterations: 5, until: "DONE",
			expected_artifacts: ["/tmp/out.txt"],
		};
		await executor.executeNode(node, ctx);
		expect(executor.resolvedArtifacts.get("loop")).toEqual(["/tmp/out.txt"]);
	});

	it("uses synthetic prompt node for per-iteration retry", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn().mockResolvedValue("DONE");

		const node = { id: "loop", type: "loop", prompt: "fix code", max_iterations: 3, until: "DONE" };
		await executor.executeNode(node, ctx);

		const syntheticNode = executor.executeWithRetry.mock.calls[0][0];
		expect(syntheticNode.type).toBe("prompt");
		expect(syntheticNode.prompt).toBe("fix code");
		expect(syntheticNode.id).toBe("loop");
	});

	it("clears currentOutputFormat before each iteration", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		executor.currentOutputFormat = { type: "object" };
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn().mockResolvedValue("DONE");

		const node = { id: "loop", type: "loop", prompt: "fix", max_iterations: 3, until: "DONE" };
		await executor.executeNode(node, ctx);
		expect(executor.currentOutputFormat).toBeNull();
	});
});

// ============================================================================
// Phase 4b: Loop bypass of outer executeWithRetry (diff review finding 1)
// ============================================================================
describe("loop bypasses outer executeWithRetry", () => {
	it("runFrom calls executeLoopNode directly, not via executeWithRetry", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		executor.writeWorkflowState = vi.fn();
		const ctx = mockCtx();

		const executeLoopSpy = vi.fn().mockResolvedValue("DONE");
		executor.executeLoopNode = executeLoopSpy;
		const executeWithRetrySpy = vi.fn();
		executor.executeWithRetry = executeWithRetrySpy;

		const nodes = [{ id: "loop1", type: "loop", prompt: "fix", max_iterations: 3, until: "DONE" }];
		await executor.runFrom(nodes, 0, "task", ctx);

		expect(executeLoopSpy).toHaveBeenCalledTimes(1);
		expect(executeWithRetrySpy).not.toHaveBeenCalled();
	});

	it("runFrom still uses executeWithRetry for prompt nodes", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		executor.writeWorkflowState = vi.fn();
		const ctx = mockCtx();

		executor.executeWithRetry = vi.fn().mockResolvedValue("output");

		const nodes = [{ id: "p1", type: "prompt", prompt: "do something" }];
		await executor.runFrom(nodes, 0, "task", ctx);

		expect(executor.executeWithRetry).toHaveBeenCalledTimes(1);
	});
});

// ============================================================================
// Phase 4b: Fresh context loops in linear (runFrom) path (diff review finding 2)
// ============================================================================
describe("fresh_context loops in linear path", () => {
	it("calls runFreshContextLoopInLinear for loop with fresh_context", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		executor.writeWorkflowState = vi.fn();
		const ctx = mockCtx();

		const freshLoopSpy = vi.fn().mockResolvedValue(undefined);
		executor.runFreshContextLoopInLinear = freshLoopSpy;

		const nodes = [
			{ id: "loop1", type: "loop", prompt: "fix", max_iterations: 3, until: "DONE", fresh_context: true },
		];
		await executor.runFrom(nodes, 0, "task", ctx);

		expect(freshLoopSpy).toHaveBeenCalledTimes(1);
		expect(freshLoopSpy.mock.calls[0][0].id).toBe("loop1");
	});

	it("runFreshContextLoopInLinear opens new session per iteration", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		executor.writeWorkflowState = vi.fn();

		let sessionCount = 0;
		const newSessionMock = vi.fn().mockImplementation(async ({ withSession }: any) => {
			sessionCount++;
			const newCtx = {
				cwd: "/tmp",
				ui: { notify: vi.fn() },
				isIdle: vi.fn().mockReturnValue(true),
				waitForIdle: vi.fn().mockResolvedValue(undefined),
				newSession: newSessionMock,
			};
			await withSession(newCtx);
			return { cancelled: false };
		});

		const ctx = {
			cwd: "/tmp",
			ui: { notify: vi.fn() },
			isIdle: vi.fn().mockReturnValue(true),
			waitForIdle: vi.fn().mockResolvedValue(undefined),
			newSession: newSessionMock,
		};

		let callCount = 0;
		executor.executeWithRetry = vi.fn().mockImplementation(() => {
			callCount++;
			return callCount === 2 ? "DONE" : "working";
		});

		const node = { id: "loop1", type: "loop", prompt: "fix", max_iterations: 5, until: "DONE", fresh_context: true } as any;
		const nodes = [node];
		await executor.runFreshContextLoopInLinear(node, nodes, 0, "task", ctx);

		expect(sessionCount).toBe(2);
	});

	it("runFreshContextLoopInLinear continues remaining nodes after signal", async () => {
		const { executor } = setupExecutor();
		executor.currentUserMessage = "task";
		executor.writeWorkflowState = vi.fn();

		const newSessionMock = vi.fn().mockImplementation(async ({ withSession }: any) => {
			const newCtx = {
				cwd: "/tmp",
				ui: { notify: vi.fn() },
				isIdle: vi.fn().mockReturnValue(true),
				waitForIdle: vi.fn().mockResolvedValue(undefined),
				newSession: newSessionMock,
			};
			await withSession(newCtx);
			return { cancelled: false };
		});

		const ctx = {
			cwd: "/tmp",
			ui: { notify: vi.fn() },
			newSession: newSessionMock,
		};

		executor.executeWithRetry = vi.fn().mockResolvedValue("DONE");
		const runFromSpy = vi.fn().mockResolvedValue(undefined);
		executor.runFrom = runFromSpy;

		const loopNode = { id: "loop1", type: "loop", prompt: "fix", max_iterations: 3, until: "DONE", fresh_context: true } as any;
		const nextNode = { id: "p2", type: "prompt", prompt: "next step" };
		const nodes = [loopNode, nextNode];
		await executor.runFreshContextLoopInLinear(loopNode, nodes, 0, "task", ctx);

		expect(runFromSpy).toHaveBeenCalledTimes(1);
		expect(runFromSpy.mock.calls[0][1]).toBe(1);
	});
});

// ============================================================================
// Phase 4b: Approval fallback walker with loop nodes
// ============================================================================
describe("approval fallback walker with loop nodes", () => {
	it("finds loop node artifacts in positional fallback", async () => {
		const { executor } = setupExecutor();
		executor.writeWorkflowState = vi.fn();
		executor.completedNodes.add("loop-fix");
		executor.resolvedArtifacts.set("loop-fix", ["/tmp/fixed.ts"]);

		const allNodes = [
			{ id: "loop-fix", type: "loop", prompt: "fix", max_iterations: 3 },
			{ id: "gate", type: "approval", message: "approve?" },
		] as any[];

		const artifacts = executor.collectUpstreamArtifacts(
			allNodes[1], allNodes,
		);
		expect(artifacts).toEqual([]);

		// Test positional fallback — the approval has no depends_on,
		// so runDag() walks backward. Simulate that path.
		let fallback: string[] = [];
		for (let j = 0; j >= 0; j--) {
			const prev = allNodes[j];
			if ((prev.type === "prompt" || prev.type === "loop") && executor.completedNodes.has(prev.id)) {
				fallback = executor.resolvedArtifacts.get(prev.id) ?? [];
				break;
			}
		}
		expect(fallback).toEqual(["/tmp/fixed.ts"]);
	});

	it("collectUpstreamArtifacts traverses loop nodes via depends_on", async () => {
		const { executor } = setupExecutor();
		executor.completedNodes.add("loop-fix");
		executor.resolvedArtifacts.set("loop-fix", ["/tmp/result.ts"]);

		const allNodes = [
			{ id: "loop-fix", type: "loop", prompt: "fix", max_iterations: 3 },
			{ id: "gate", type: "approval", message: "approve?", depends_on: ["loop-fix"] },
		] as any[];

		const artifacts = executor.collectUpstreamArtifacts(allNodes[1], allNodes);
		expect(artifacts).toEqual(["/tmp/result.ts"]);
	});
});

// ============================================================================
// Phase 4b: Structured Output (output_format)
// ============================================================================
describe("structured output (output_format)", () => {
	it("appends JSON enforcement text when output_format is set", async () => {
		const { executor } = setupExecutor();
		executor.currentOutputFormat = { type: "object", properties: { result: { type: "string" } } };
		const ctx = mockCtx();

		executor.sendAndWait = vi.fn();
		executor.installRespondTool = vi.fn(() => vi.fn());
		executor.respondToolCaptured = '{"result": "ok"}';

		const result = await executor.executePromptNode("n1", "classify this", ctx);
		const sentPrompt = executor.sendAndWait.mock.calls[0][1];
		expect(sentPrompt).toContain("You MUST respond with ONLY valid JSON");
		expect(sentPrompt).toContain('"result"');
		expect(result).toBe('{"result": "ok"}');
	});

	it("passes through valid JSON output", async () => {
		const { executor } = setupExecutor();
		executor.currentOutputFormat = { type: "object" };
		const ctx = mockCtx();

		executor.sendAndWait = vi.fn();
		executor.installRespondTool = vi.fn(() => vi.fn());
		executor.respondToolCaptured = '{"key": "value"}';

		const result = await executor.executePromptNode("n1", "classify", ctx);
		expect(result).toBe('{"key": "value"}');
	});

	it("throws on unparseable JSON output", async () => {
		const { executor } = setupExecutor();
		executor.currentOutputFormat = { type: "object" };
		const ctx = mockCtx();

		executor.sendAndWait = vi.fn();
		executor.installRespondTool = vi.fn(() => vi.fn());
		executor.respondToolCaptured = "not json at all";

		await expect(executor.executePromptNode("n1", "classify", ctx))
			.rejects.toThrow(/output_format requires JSON but got unparseable text/);
	});

	it("strips code fences from JSON output", async () => {
		const { executor } = setupExecutor();
		executor.currentOutputFormat = { type: "object" };
		const ctx = mockCtx();

		executor.sendAndWait = vi.fn();
		executor.installRespondTool = vi.fn(() => vi.fn());
		executor.respondToolCaptured = '```json\n{"status": "ok"}\n```';

		const result = await executor.executePromptNode("n1", "classify", ctx);
		expect(result).toBe('{"status": "ok"}');
	});

	it("does not modify prompt when no output_format", async () => {
		const { executor } = setupExecutor();
		executor.currentOutputFormat = null;
		const ctx = mockCtx();

		executor.sendAndWait = vi.fn();
		executor.installRespondTool = vi.fn(() => vi.fn());
		executor.respondToolCaptured = "normal text";

		await executor.executePromptNode("n1", "do something", ctx);
		const sentPrompt = executor.sendAndWait.mock.calls[0][1];
		expect(sentPrompt).toBe("do something");
	});

	it("throws when output_format set but no __respond capture", async () => {
		const { executor } = setupExecutor();
		executor.currentOutputFormat = { type: "object" };
		const ctx = mockCtx();

		executor.sendAndWait = vi.fn();
		executor.installRespondTool = vi.fn(() => vi.fn());
		executor.respondToolCaptured = null;

		await expect(executor.executePromptNode("n1", "classify", ctx))
			.rejects.toThrow(/output_format requires structured JSON response via __respond/);
	});
});

// ============================================================================
// Phase 4b: Schema validation — output_format
// ============================================================================
describe("validateWorkflow output_format", () => {
	it("parses output_format on prompt nodes", () => {
		const wf = validateWorkflow({
			name: "test",
			nodes: [{
				id: "classify",
				type: "prompt",
				prompt: "classify",
				output_format: { type: "object", properties: { category: { type: "string" } } },
			}],
		});
		expect(wf.nodes[0]).toHaveProperty("output_format");
		expect((wf.nodes[0] as any).output_format.type).toBe("object");
	});

	it("ignores output_format when not an object", () => {
		const wf = validateWorkflow({
			name: "test",
			nodes: [{
				id: "n1",
				type: "prompt",
				prompt: "do thing",
				output_format: "not an object",
			}],
		});
		expect((wf.nodes[0] as any).output_format).toBeUndefined();
	});
});

// ============================================================================
// Phase 4b: $ITERATION variable
// ============================================================================
describe("$ITERATION variable resolution", () => {
	it("resolves $ITERATION in loop prompt", () => {
		const { executor } = setupExecutor();
		const node = { id: "loop", type: "loop", prompt: "Iteration $ITERATION: fix the code", max_iterations: 5 };
		const result = executor.resolveVariables(node, "task", 2);
		expect(result.prompt).toBe("Iteration 2: fix the code");
	});

	it("does not resolve $ITERATION when no iteration param", () => {
		const { executor } = setupExecutor();
		const node = { id: "n1", type: "prompt", prompt: "Value: $ITERATION" };
		const result = executor.resolveVariables(node, "task");
		expect(result.prompt).toBe("Value: $ITERATION");
	});

	it("resolves $ITERATION as 0 for first iteration", () => {
		const { executor } = setupExecutor();
		const node = { id: "loop", type: "loop", prompt: "Step $ITERATION", max_iterations: 3 };
		const result = executor.resolveVariables(node, "task", 0);
		expect(result.prompt).toBe("Step 0");
	});
});
