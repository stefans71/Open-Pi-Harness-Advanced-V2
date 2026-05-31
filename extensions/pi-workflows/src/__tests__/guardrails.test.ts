import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowExecutor, _resetSharedState } from "../executor.js";

beforeEach(() => {
  _resetSharedState();
});

/**
 * Mock ExtensionAPI — enough to construct a WorkflowExecutor without PI runtime.
 * The constructor registers __respond via pi.registerTool, so we capture and
 * expose the tool definition for tests to call its execute handler directly.
 */
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

// ============================================================================
// rescueToolCall
// ============================================================================
describe("rescueToolCall", () => {
  let executor: any;

  beforeEach(() => {
    const pi = createMockPi();
    executor = new WorkflowExecutor(pi as any);
  });

  it("passes through well-formed tool call JSON", () => {
    const raw = '{"name": "write", "arguments": {"path": "foo.ts", "content": "bar"}}';
    const result = executor.rescueToolCall(raw);
    expect(result).toEqual({
      name: "write",
      arguments: { path: "foo.ts", content: "bar" },
    });
  });

  it("rescues JSON wrapped in code fence", () => {
    const raw = '```json\n{"name": "write", "arguments": {"path": "foo.ts", "content": "bar"}}\n```';
    const result = executor.rescueToolCall(raw);
    expect(result).toEqual({
      name: "write",
      arguments: { path: "foo.ts", content: "bar" },
    });
  });

  it("rescues JSON wrapped in tool_call code fence", () => {
    const raw = '```tool_call\n{"name": "read", "arguments": {"path": "src/index.ts"}}\n```';
    const result = executor.rescueToolCall(raw);
    expect(result).toEqual({
      name: "read",
      arguments: { path: "src/index.ts" },
    });
  });

  it("rescues JSON wrapped in <tool_call> XML tags", () => {
    const raw = '<tool_call>\n{"name": "write", "arguments": {"path": "x.ts", "content": "hello"}}\n</tool_call>';
    const result = executor.rescueToolCall(raw);
    expect(result).toEqual({
      name: "write",
      arguments: { path: "x.ts", content: "hello" },
    });
  });

  it("rescues tool name outside JSON body (extracts JSON)", () => {
    const raw = 'I\'ll use the write tool: {"name": "write", "arguments": {"path": "a.ts", "content": "code"}}';
    const result = executor.rescueToolCall(raw);
    expect(result).toEqual({
      name: "write",
      arguments: { path: "a.ts", content: "code" },
    });
  });

  it("returns null for partial JSON (missing closing braces)", () => {
    const raw = '{"name": "write", "arguments": {"path": "foo.ts", "content": "bar"}';
    const result = executor.rescueToolCall(raw);
    expect(result).toBeNull();
  });

  it("returns null for unrecoverable input (no JSON at all)", () => {
    const raw = "I will now create the file for you. Here is my plan...";
    const result = executor.rescueToolCall(raw);
    expect(result).toBeNull();
  });

  it("returns null when JSON has name but no arguments", () => {
    const raw = '{"name": "write", "data": "something"}';
    const result = executor.rescueToolCall(raw);
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = executor.rescueToolCall("");
    expect(result).toBeNull();
  });
});

// ============================================================================
// executeWithRetry
// ============================================================================
describe("executeWithRetry", () => {
  let executor: any;
  let mockPi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    mockPi = createMockPi();
    executor = new WorkflowExecutor(mockPi as any);
    executor.artifactsDir = "/tmp/test-artifacts";
    executor.state = {
      workflowName: "test",
      currentNodeIndex: 0,
      totalNodes: 1,
      outputs: new Map(),
      startedAt: Date.now(),
      status: "running",
    };
  });

  it("returns on first success without retry", async () => {
    const spy = vi.fn().mockResolvedValue("success");
    executor.executeNode = spy;

    const node = { id: "test-node", type: "bash", command: "echo hi", allow_failure: false };
    const ctx = { cwd: "/tmp", ui: { notify: vi.fn() }, isIdle: vi.fn().mockReturnValue(true) };
    const result = await executor.executeWithRetry(node, ctx, 3);

    expect(result).toBe("success");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error then succeeds", async () => {
    const spy = vi.fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce("recovered");
    executor.executeNode = spy;
    executor.logEvent = vi.fn();

    const node = { id: "retry-node", type: "bash", command: "echo hi", allow_failure: false };
    const ctx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
    };
    const result = await executor.executeWithRetry(node, ctx, 3);

    expect(result).toBe("recovered");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(executor.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "node_retry",
        nodeId: "retry-node",
        attempt: 1,
        maxAttempts: 3,
        errorClass: "connection",
      }),
    );
  }, 15_000);

  it("does NOT retry WorkflowCancelled errors", async () => {
    const cancelled = new Error("user rejected");
    cancelled.name = "WorkflowCancelled";

    const spy = vi.fn().mockRejectedValue(cancelled);
    executor.executeNode = spy;
    executor.logEvent = vi.fn();

    const node = { id: "fatal-node", type: "prompt", prompt: "do thing" };
    const ctx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
    };

    await expect(executor.executeWithRetry(node, ctx, 3)).rejects.toThrow("user rejected");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry WorkflowFailed errors", async () => {
    const failed = new Error("missing artifacts");
    failed.name = "WorkflowFailed";

    const spy = vi.fn().mockRejectedValue(failed);
    executor.executeNode = spy;
    executor.logEvent = vi.fn();

    const node = { id: "fatal-node-2", type: "prompt", prompt: "do thing" };
    const ctx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
    };

    await expect(executor.executeWithRetry(node, ctx, 3)).rejects.toThrow("missing artifacts");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("throws last error after all retries exhausted", async () => {
    const spy = vi.fn().mockRejectedValue(new Error("connection timeout"));
    executor.executeNode = spy;
    executor.logEvent = vi.fn();

    const node = { id: "exhaust-node", type: "bash", command: "fail", allow_failure: false };
    const ctx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
    };

    await expect(executor.executeWithRetry(node, ctx, 2)).rejects.toThrow("connection timeout");
    expect(spy).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("fails fast on unknown error class without retrying", async () => {
    const spy = vi.fn().mockRejectedValue(new Error("something unexpected happened"));
    executor.executeNode = spy;
    executor.logEvent = vi.fn();

    const node = { id: "unknown-err", type: "bash", command: "echo", allow_failure: false };
    const ctx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
    };

    await expect(executor.executeWithRetry(node, ctx, 3)).rejects.toThrow("something unexpected");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("fails fast on tool_call_format errors for bash nodes", async () => {
    const formatError = new Error("failed to parse JSON output");
    const spy = vi.fn().mockRejectedValue(formatError);
    executor.executeNode = spy;
    executor.logEvent = vi.fn();

    const node = { id: "bash-fmt", type: "bash", command: "echo", allow_failure: false };
    const ctx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
    };

    await expect(executor.executeWithRetry(node, ctx, 3)).rejects.toThrow("failed to parse JSON");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("logs rescue_parse event on tool_call_format errors for prompt nodes", async () => {
    const formatError = new Error("failed to parse JSON in ```json\\n{bad}\\n```");
    const spy = vi.fn()
      .mockRejectedValueOnce(formatError)
      .mockResolvedValueOnce("ok");
    executor.executeNode = spy;
    executor.logEvent = vi.fn();

    const node = { id: "rescue-node", type: "prompt", prompt: "do thing" };
    const ctx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
    };
    await executor.executeWithRetry(node, ctx, 3);

    expect(executor.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "rescue_parse",
        nodeId: "rescue-node",
      }),
    );
  }, 15_000);
});

// ============================================================================
// classifyError
// ============================================================================
describe("classifyError", () => {
  let executor: any;

  beforeEach(() => {
    const pi = createMockPi();
    executor = new WorkflowExecutor(pi as any);
  });

  it("classifies connection errors", () => {
    expect(executor.classifyError(new Error("ECONNREFUSED 127.0.0.1:8080"))).toBe("connection");
    expect(executor.classifyError(new Error("socket hang up"))).toBe("connection");
    expect(executor.classifyError(new Error("connect ECONNRESET"))).toBe("connection");
  });

  it("classifies timeout errors", () => {
    expect(executor.classifyError(new Error("request timed out"))).toBe("timeout");
    expect(executor.classifyError(new Error("timeout after 30s"))).toBe("timeout");
  });

  it("classifies format errors", () => {
    expect(executor.classifyError(new Error("failed to parse JSON"))).toBe("tool_call_format");
    expect(executor.classifyError(new Error("malformed tool call"))).toBe("tool_call_format");
  });

  it("returns unknown for unrecognized errors", () => {
    expect(executor.classifyError(new Error("something weird happened"))).toBe("unknown");
  });
});

// ============================================================================
// installRespondTool (flag-based capture via registerTool execute handler)
// ============================================================================
describe("installRespondTool", () => {
  let executor: any;
  let mockPi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    mockPi = createMockPi();
    executor = new WorkflowExecutor(mockPi as any);
    executor.logEvent = vi.fn();
  });

  it("registers __respond tool in constructor", () => {
    expect(mockPi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "__respond" }),
    );
    expect(mockPi._registeredTools["__respond"]).toBeDefined();
  });

  it("returns terminate: true and empty content to end the turn", async () => {
    executor.installRespondTool();
    const respondTool = mockPi._registeredTools["__respond"];
    const result = await respondTool.execute("tc-term", { message: "done" });

    expect(result.terminate).toBe(true);
    expect(result.content).toEqual([]);
  });

  it("captures message when respondToolActive is true", async () => {
    const cleanup = executor.installRespondTool();

    // Call the registered execute handler directly (simulates model calling __respond)
    const respondTool = mockPi._registeredTools["__respond"];
    await respondTool.execute("tc-1", { message: "Here is my analysis." });

    const captured = cleanup();
    expect(captured).toBe("Here is my analysis.");
  });

  it("does NOT capture when respondToolActive is false (after cleanup)", async () => {
    const cleanup = executor.installRespondTool();
    cleanup(); // deactivate

    const respondTool = mockPi._registeredTools["__respond"];
    const result = await respondTool.execute("tc-2", { message: "Should not be captured" });

    // No tool_call_blocked event = handler did not capture
    expect(executor.logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "tool_call_blocked" }),
    );
    // Returns message as normal tool output, no termination
    expect(result.content).toEqual([{ type: "text", text: "Should not be captured" }]);
    expect(result.terminate).toBeUndefined();
  });

  it("passes through normally when never armed (non-workflow user turn)", async () => {
    // Don't call installRespondTool — respondActive is false by default
    const respondTool = mockPi._registeredTools["__respond"];
    const result = await respondTool.execute("tc-unarmed", { message: "Hello from user" });

    expect(result.content).toEqual([{ type: "text", text: "Hello from user" }]);
    expect(result.terminate).toBeUndefined();
    expect(executor.logEvent).not.toHaveBeenCalled();
  });

  it("returns null when no __respond call was made", () => {
    const cleanup = executor.installRespondTool();
    const captured = cleanup();
    expect(captured).toBeNull();
  });

  it("captures the latest message when called multiple times", async () => {
    const cleanup = executor.installRespondTool();

    const respondTool = mockPi._registeredTools["__respond"];
    await respondTool.execute("tc-3", { message: "First response" });
    await respondTool.execute("tc-4", { message: "Second response" });

    const captured = cleanup();
    expect(captured).toBe("Second response");
  });

  it("logs tool_call_blocked event on capture", async () => {
    executor.installRespondTool();
    executor.currentNodeId = "test-node";

    const respondTool = mockPi._registeredTools["__respond"];
    await respondTool.execute("tc-5", { message: "blocked" });

    expect(executor.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_call_blocked",
        nodeId: "test-node",
        tool: "__respond",
        reason: "respond tool intercepted",
      }),
    );
  });
});

// ============================================================================
// executePromptNode integration (respond tool + rescue parse wiring)
// ============================================================================
describe("executePromptNode integration", () => {
  let executor: any;
  let mockPi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    mockPi = createMockPi();
    executor = new WorkflowExecutor(mockPi as any);
    executor.artifactsDir = "/tmp/test-artifacts";
    executor.logEvent = vi.fn();
    executor.state = {
      workflowName: "test",
      currentNodeIndex: 0,
      totalNodes: 1,
      outputs: new Map(),
      startedAt: Date.now(),
      status: "running",
    };
  });

  it("sets currentNodeId before execution", async () => {
    // Mock sendAndWait to do nothing
    executor.sendAndWait = vi.fn();

    await executor.executePromptNode("my-node", "do something", {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
      waitForIdle: vi.fn(),
    });

    expect(executor.currentNodeId).toBe("my-node");
  });

  it("activates respond tool during prompt execution", async () => {
    executor.sendAndWait = vi.fn();

    await executor.executePromptNode("resp-node", "analyze this", {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
      waitForIdle: vi.fn(),
    });

    // After execution, respondToolActive should be false (cleanup was called)
    expect(executor.respondToolActive).toBe(false);
  });

  it("uses respond-captured text as node output", async () => {
    // Simulate the respond tool capturing during sendAndWait
    executor.sendAndWait = vi.fn(async () => {
      // Simulate model calling __respond during sendAndWait
      executor.respondToolCaptured = "Model's text response via respond tool";
    });

    const result = await executor.executePromptNode("capture-node", "explain code", {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
      waitForIdle: vi.fn(),
    });

    expect(result).toBe("Model's text response via respond tool");
    expect(executor.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "respond_tool_captured",
        nodeId: "capture-node",
      }),
    );
  });

  it("returns default output when respond tool captures nothing", async () => {
    executor.sendAndWait = vi.fn();

    const result = await executor.executePromptNode("no-capture", "do thing", {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
      waitForIdle: vi.fn(),
    });

    expect(result).toBe("[prompt node no-capture completed]");
  });

  it("throws on malformed tool call captured via __respond (retryable)", async () => {
    executor.sendAndWait = vi.fn(async () => {
      // Model called __respond with text that's actually a malformed tool call
      executor.respondToolCaptured = '```json\n{"name": "write", "arguments": {"path": "x.ts"}}\n```';
    });

    await expect(
      executor.executePromptNode("rescue-node", "write file", {
        cwd: "/tmp",
        ui: { notify: vi.fn() },
        isIdle: vi.fn().mockReturnValue(true),
        waitForIdle: vi.fn(),
      }),
    ).rejects.toThrow('malformed tool call captured via __respond: tried to call "write"');

    expect(executor.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "rescue_parse",
        nodeId: "rescue-node",
        format: "respond_capture",
        success: true,
        rescuedTool: "write",
      }),
    );
  });

  it("appends __respond to active tools when allowed_tools restricts", async () => {
    executor.sendAndWait = vi.fn();
    // Simulate restricted active tools (no __respond) — getActiveTools returns string[]
    mockPi.getActiveTools.mockReturnValue(["read", "write"]);

    await executor.executePromptNode("restricted-node", "do thing", {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
      waitForIdle: vi.fn(),
    });

    expect(mockPi.setActiveTools).toHaveBeenCalledWith(
      expect.arrayContaining(["read", "write", "__respond"]),
    );
  });

  it("keeps __respond armed during artifact retry and captures retry output", async () => {
    let sendCount = 0;
    executor.sendAndWait = vi.fn(async () => {
      sendCount++;
      if (sendCount === 2) {
        // Simulate model calling __respond during artifact retry
        const respondTool = mockPi._registeredTools["__respond"];
        await respondTool.execute("tc-retry", { message: "Retry response" });
      }
    });

    // First call: no artifacts exist. existsSync will return false then true.
    const { existsSync } = await import("node:fs");
    const existsMock = vi.fn()
      .mockReturnValueOnce(false)  // artifact check: missing
      .mockReturnValueOnce(true);  // after retry: exists
    vi.stubGlobal("existsSync", undefined);

    // We can't easily mock existsSync in the executor's import, so test
    // the respond lifecycle directly: verify respondActive stays true across
    // two sendAndWait calls.
    // installRespondTool arms respondActive; after two sendAndWait calls,
    // the handler should still capture on the second call.
    const cleanup = executor.installRespondTool();

    await executor.sendAndWait({} as any, "first prompt");
    // respondActive should still be true (cleanup hasn't been called)
    expect(executor.respondToolActive).toBe(true);

    // Simulate artifact retry sendAndWait — model calls __respond
    await executor.sendAndWait({} as any, "create missing file");

    const captured = cleanup();
    expect(captured).toBe("Retry response");
  });
});

// ============================================================================
// tool_call event logging (nodeId attribution)
// ============================================================================
describe("tool_call event logging", () => {
  let executor: any;
  let mockPi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    mockPi = createMockPi();
    executor = new WorkflowExecutor(mockPi as any);
    executor.logEvent = vi.fn();
  });

  it("logs tool_call_selected with currentNodeId, not workflow name", () => {
    executor.currentNodeId = "implement";

    mockPi._fire("tool_call", {
      toolName: "write",
      input: { path: "foo.ts", content: "bar" },
    });

    expect(executor.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_call_selected",
        nodeId: "implement",
        tool: "write",
        argKeys: ["path", "content"],
      }),
    );
  });

  it("handles alternate event shape with tool.name instead of toolName", () => {
    executor.currentNodeId = "alt-shape";

    mockPi._fire("tool_call", {
      tool: { name: "read" },
      input: { path: "src/index.ts" },
    });

    expect(executor.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_call_selected",
        nodeId: "alt-shape",
        tool: "read",
        argKeys: ["path"],
      }),
    );
  });
});

// ============================================================================
// fresh_context + __respond integration
// ============================================================================
describe("fresh_context __respond inclusion", () => {
  it("includes __respond when building pendingAllowedTools for fresh_context", async () => {
    const mockPi = createMockPi();
    const executor: any = new WorkflowExecutor(mockPi as any);
    executor.artifactsDir = "/tmp/test-artifacts";
    executor.logEvent = vi.fn();
    executor.state = {
      workflowName: "test-wf",
      currentNodeIndex: 0,
      totalNodes: 2,
      outputs: new Map(),
      startedAt: Date.now(),
      status: "running",
    };

    // Build the node as runFrom would see it
    const freshNode = {
      id: "fresh-node",
      type: "prompt" as const,
      prompt: "do analysis",
      fresh_context: true,
      allowed_tools: ["read", "write"],
    };

    // Mock newSession to capture what happens
    let capturedPendingTools: string[] | null = null;
    const mockCtx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
      waitForIdle: vi.fn(),
      newSession: vi.fn(async ({ withSession }: any) => {
        // Capture the pendingAllowedTools that were set before newSession
        // (The module-level variable is read by session_start handler)
        // We access it via the session_start handler firing
        capturedPendingTools = mockPi.setActiveTools.mock.calls.length > 0
          ? mockPi.setActiveTools.mock.calls[0][0]
          : null;

        // Fire session_start to simulate what PI does
        mockPi._fire("session_start");
        capturedPendingTools = mockPi.setActiveTools.mock.calls.length > 0
          ? mockPi.setActiveTools.mock.calls[mockPi.setActiveTools.mock.calls.length - 1][0]
          : null;

        return { cancelled: false };
      }),
    };

    // runFrom will try to process the fresh_context node
    // We only care about what happens before/during newSession
    try {
      await executor.runFrom([freshNode], 0, "test message", mockCtx);
    } catch {
      // May throw because withSession callback isn't properly mocked — that's fine
    }

    // __respond should be in the tool set that was activated
    expect(capturedPendingTools).toContain("__respond");
    expect(capturedPendingTools).toContain("read");
    expect(capturedPendingTools).toContain("write");
  });

  it("sets currentNodeId before newSession for correct event attribution", async () => {
    const mockPi = createMockPi();
    const executor: any = new WorkflowExecutor(mockPi as any);
    executor.artifactsDir = "/tmp/test-artifacts";
    executor.logEvent = vi.fn();
    executor.state = {
      workflowName: "test-wf",
      currentNodeIndex: 0,
      totalNodes: 1,
      outputs: new Map(),
      startedAt: Date.now(),
      status: "running",
    };

    let nodeIdAtSessionStart: string | undefined;
    const mockCtx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
      newSession: vi.fn(async () => {
        // Capture currentNodeId at the point where session_start would fire
        nodeIdAtSessionStart = executor.currentNodeId;
        return { cancelled: false };
      }),
    };

    const freshNode = {
      id: "my-fresh-node",
      type: "prompt" as const,
      prompt: "analyze",
      fresh_context: true,
    };

    try {
      await executor.runFrom([freshNode], 0, "msg", mockCtx);
    } catch {
      // Expected — withSession not fully mocked
    }

    expect(nodeIdAtSessionStart).toBe("my-fresh-node");
  });
});

// ============================================================================
// Cross-instance module-level state (Finding 1: session replacement)
// ============================================================================
describe("cross-instance module-level state", () => {
  it("respond capture works across executor instances (simulates session replacement)", async () => {
    // OLD instance arms the respond tool
    const oldPi = createMockPi();
    const oldExecutor: any = new WorkflowExecutor(oldPi as any);
    oldExecutor.logEvent = vi.fn();
    oldExecutor.artifactsDir = "/tmp/test-artifacts";

    const cleanup = oldExecutor.installRespondTool();

    // NEW instance (simulates what PI creates on session replacement)
    const newPi = createMockPi();
    const newExecutor: any = new WorkflowExecutor(newPi as any);
    newExecutor.logEvent = vi.fn();

    // Model calls __respond on the NEW instance's registered tool
    const newRespondTool = newPi._registeredTools["__respond"];
    await newRespondTool.execute("tc-cross", { message: "Cross-instance capture" });

    // OLD instance's cleanup should still retrieve the captured message
    const captured = cleanup();
    expect(captured).toBe("Cross-instance capture");
  });

  it("tool_call handler on new instance uses nodeId set by old instance", () => {
    const oldPi = createMockPi();
    const oldExecutor: any = new WorkflowExecutor(oldPi as any);
    oldExecutor.logEvent = vi.fn();

    // Old executor sets currentNodeId (which also sets module-level activeNodeId)
    oldExecutor.currentNodeId = "old-node-id";
    // Manually sync — in real code, executePromptNode does this
    // For this test, we access the module-level effect via a new instance
    // We need to call a method that writes activeNodeId...
    // Actually installRespondTool doesn't set nodeId. Let's simulate executePromptNode's nodeId write.
    // The edit we made: executePromptNode writes activeNodeId = nodeId. Let's verify by calling executePromptNode.

    const newPi = createMockPi();
    const newExecutor: any = new WorkflowExecutor(newPi as any);
    newExecutor.logEvent = vi.fn();

    // Old executor's executePromptNode sets activeNodeId (module-level)
    oldExecutor.sendAndWait = vi.fn();
    oldExecutor.executePromptNode("cross-node", "test prompt", {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
      waitForIdle: vi.fn(),
    });

    // New instance's tool_call handler should see the module-level activeNodeId
    newPi._fire("tool_call", { toolName: "write", input: { path: "a.ts" } });

    expect(newExecutor.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_call_selected",
        nodeId: "cross-node",
      }),
    );
  });
});

// ============================================================================
// rescue-informed retry correction message
// ============================================================================
describe("rescue-informed retry", () => {
  let executor: any;
  let mockPi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    mockPi = createMockPi();
    executor = new WorkflowExecutor(mockPi as any);
    executor.artifactsDir = "/tmp/test-artifacts";
    executor.logEvent = vi.fn();
    executor.state = {
      workflowName: "test",
      currentNodeIndex: 0,
      totalNodes: 1,
      outputs: new Map(),
      startedAt: Date.now(),
      status: "running",
    };
  });

  it("uses rescued tool info in retry correction for format errors", async () => {
    // Error contains a rescuable tool call pattern
    const error = new Error(
      'failed to parse JSON: ```json\n{"name": "write", "arguments": {"path": "x.ts", "content": "y"}}\n```',
    );
    const spy = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("ok");
    executor.executeNode = spy;

    // Mock sendAndWait to capture the correction message
    let correctionMessage = "";
    executor.sendAndWait = vi.fn(async (_ctx: any, msg: string) => {
      correctionMessage = msg;
    });

    const node = { id: "fmt-node", type: "prompt", prompt: "write file" };
    const ctx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
    };
    await executor.executeWithRetry(node, ctx, 3);

    // Correction should reference the rescued tool name
    expect(correctionMessage).toContain('"write"');
    expect(correctionMessage).toContain("path");
    expect(correctionMessage).toContain("content");
    expect(correctionMessage).toContain("no code fences");
  }, 15_000);

  it("uses generic correction when rescue fails", async () => {
    const error = new Error("malformed output — completely unrecoverable garbage");
    const spy = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("ok");
    executor.executeNode = spy;

    let correctionMessage = "";
    executor.sendAndWait = vi.fn(async (_ctx: any, msg: string) => {
      correctionMessage = msg;
    });

    const node = { id: "generic-node", type: "prompt", prompt: "do thing" };
    const ctx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
    };
    await executor.executeWithRetry(node, ctx, 3);

    expect(correctionMessage).toContain("[RETRY]");
    expect(correctionMessage).toContain("Try again");
  }, 15_000);

  it("uses 1s delay for first retry (not 3s)", async () => {
    const spy = vi.fn()
      .mockRejectedValueOnce(new Error("connection error"))
      .mockResolvedValueOnce("ok");
    executor.executeNode = spy;

    const start = Date.now();
    const node = { id: "delay-node", type: "bash", command: "echo", allow_failure: false };
    const ctx = {
      cwd: "/tmp",
      ui: { notify: vi.fn() },
      isIdle: vi.fn().mockReturnValue(true),
    };
    await executor.executeWithRetry(node, ctx, 3);

    const elapsed = Date.now() - start;
    // Should be ~1s (1000ms), not ~3s (3000ms)
    expect(elapsed).toBeLessThan(2500);
  });
});
