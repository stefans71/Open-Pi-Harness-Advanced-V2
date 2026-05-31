/**
 * WorkflowExecutor — refactored to use ctx.newSession({ withSession }) pattern.
 *
 * ============================================================================
 * PHASE 0 INVESTIGATION FINDINGS
 * (Evidence from /usr/lib/node_modules/@mariozechner/pi-coding-agent/dist/)
 * ============================================================================
 *
 * Q1: Are pi.exec / pi.sendMessage / pi.appendEntry safe inside withSession?
 *
 * NO — all three throw after session replacement.
 *
 * Evidence: loader.js:203-213 — sendMessage, sendUserMessage, appendEntry each
 * call `runtime.assertActive()` before delegating. loader.js:227-228 — exec()
 * also calls `runtime.assertActive()`. agent-session.js:494 — `session.dispose()`
 * calls `extensionRunner.invalidate()`, which sets the staleMessage on the
 * shared runtime. agent-session-runtime.js:101-108 — `teardownCurrent()` (which
 * calls dispose) runs BEFORE `finishSessionReplacement` (which calls withSession),
 * lines 153-164 for newSession. So by the time our withSession callback fires, the
 * old runtime is already stale.
 *
 * The ReplacedSessionContext (agent-session.js:2497-2502) is built from the NEW
 * session's extensionRunner and provides its own sendMessage/sendUserMessage that
 * route to the new session. These ARE safe. But it has no exec() method.
 *
 * Solution: implement execBash() using child_process.spawn directly, bypassing
 * pi.exec. Use ctx.sendMessage / ctx.sendUserMessage (from ReplacedSessionContext)
 * for messaging. For appendEntry (session JSONL persistence) we accept that it
 * cannot be called safely inside withSession — we only call it on node_complete
 * and node_start events where we have a valid ctx via the passed-down context.
 * To avoid this problem entirely for workflow_metadata entries, we skip calling
 * pi.appendEntry for node_start/node_complete inside withSession (the events.jsonl
 * log still works, as it uses the filesystem directly).
 *
 * Q2: After withSession returns, is the outer ctx usable again?
 *
 * NO — the outer ctx is permanently stale.
 *
 * Evidence: agent-session-runtime.js:116-122 — withSession callback runs inside
 * finishSessionReplacement(), which is awaited before newSession() returns.
 * teardownCurrent() was already called before finishSessionReplacement(), so
 * the old runner was invalidated. The outer ctx (ExtensionCommandContext created
 * by the old runner) calls assertActive() on every property access (runner.js:379-
 * 434). After newSession() returns, the outer ctx is dead.
 *
 * Consequence: after a fresh_context node triggers ctx.newSession({ withSession }),
 * ALL remaining workflow nodes must execute inside that withSession callback.
 * We handle this by making runFrom() recursive: when it encounters fresh_context,
 * it opens withSession and passes remaining nodes to a nested runFrom() call with
 * the new ctx. The outer runFrom() then returns immediately (it no longer has a
 * valid ctx anyway).
 *
 * Q3: How does allowed_tools enforcement work across session replacement?
 *
 * Structural enforcement via session_start + pi.setActiveTools().
 *
 * Design: the model must never see tools it cannot use. When a fresh_context node
 * has allowed_tools, only those tools should appear in the system prompt and in the
 * function definitions sent to the LLM. Runtime blocking (tool_call event) cannot
 * achieve this — it blocks at call time but the model still sees all tools in the
 * system prompt and API call, so it tries blocked tools and falls back to prose.
 *
 * Mechanism: ExtensionAPI.setActiveTools(names) calls setActiveToolsByName() on the
 * session, which (a) sets agent.state.tools to only the named tools and (b) rebuilds
 * the system prompt to list only those tools. The LLM then sees only the allowed
 * subset — in both the system prompt text and the OpenAI function definitions sent
 * in the API call (openai-completions.ts:507 — params.tools = convertTools(context.tools)).
 *
 * Timing: setActiveTools must be called BEFORE the first agent turn in the new
 * session. The session_start event fires inside finishSessionReplacement() →
 * rebindSession() → bindExtensions() — BEFORE withSession() is called. The new
 * session's extension module re-runs its factory, creating a new WorkflowExecutor
 * whose constructor registers a session_start handler on the new pi. That handler
 * reads pendingAllowedTools (module-level, survives session replacement) and calls
 * pi.setActiveTools() on the new valid runtime before withSession fires.
 *
 * allowed_tools on non-fresh-context nodes has no effect — setActiveTools on the
 * current session mid-turn would interfere with normal operation. Require
 * fresh_context: true alongside allowed_tools.
 *
 * ============================================================================
 * ARCHITECTURE DECISION
 * ============================================================================
 *
 * The executor uses a mutually recursive pair: run() sets up state and calls
 * runFrom(nodes, 0, userMessage, initialCtx). runFrom() iterates nodes. When it
 * sees a fresh_context prompt node, it calls ctx.newSession({ withSession: async
 * (newCtx) => { executePromptInSession(node, newCtx); runFrom(nodes, i+1,
 * userMessage, newCtx); } }) and then returns (the continuation is now running
 * inside the callback). For the prd-to-code workflow with 3 fresh_context phases,
 * the call stack depth is bounded at 3 nested withSession calls — each level only
 * persists until its own withSession callback resolves, so memory is bounded by
 * workflow depth.
 *
 * Cancellation propagates cleanly: WorkflowCancelled errors thrown inside a nested
 * withSession bubble up through the await chain, causing the enclosing runFrom()
 * calls to re-throw, ultimately reaching the try/catch in run().
 *
 * Messaging: a sendVia() helper branches on whether ctx is a ReplacedSessionContext
 * (i.e., "sendUserMessage" in ctx) to route through the new session's methods or
 * the original pi object. For workflow_metadata appendEntry calls we always use
 * this.pi.appendEntry — but only from places where the old session is still active
 * (workflow_start and workflow_end fire before and after the loop; node_start and
 * node_complete entries are logged to events.jsonl only via the filesystem logger
 * to avoid the stale-runtime problem during withSession).
 *
 * exec: pi.exec also fails after session replacement. We use child_process.spawn
 * directly in execBash() for bash and gitStash operations. This avoids the
 * assertActive guard entirely and behaves identically to what pi.exec does
 * internally (loader.js:227-228 shows pi.exec just calls execCommand which uses
 * spawn, exec.js:11-12).
 */

import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, isAbsolute } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ReplacedSessionContext } from "@mariozechner/pi-coding-agent";
import type { ApprovalNode, CancelNode, LoopNode, PromptNode, WorkflowDefinition, WorkflowNode, WorkflowState } from "./schema.js";
import { buildDag, evaluateCondition, type DagStep } from "./dag.js";
import { getModelProfile, type ModelProfile } from "./model-info.js";

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Union of the two ctx shapes we operate with. */
type AnyCtx = ExtensionCommandContext | ReplacedSessionContext;

/**
 * Tool names to register on the next fresh_context session, consumed by the
 * session_start handler before withSession fires. Module-level so it survives
 * session replacement (the new session's WorkflowExecutor instance reads it).
 * null means "no restriction — use PI defaults".
 */
let pendingAllowedTools: string[] | null = null;

// Module-level guardrail state shared across executor instances.
// When fresh_context triggers session replacement, PI creates a NEW
// WorkflowExecutor. The old instance continues running the workflow
// (via the withSession closure), but event handlers (__respond, tool_call)
// fire on the new instance. These variables bridge that gap.
// Assumption: one workflow runs at a time (single-user, single GPU).
// Concurrent workflows would need per-run state isolation.
let activeNodeId = "unknown";
let respondActive = false;
let respondCaptured: string | null = null;
let activeArtifactsDir: string | null = null;

/** @internal — resets module-level guardrail state between tests. */
export function _resetSharedState(): void {
	pendingAllowedTools = null;
	activeNodeId = "unknown";
	respondActive = false;
	respondCaptured = null;
	activeArtifactsDir = null;
}

export class WorkflowExecutor {
	private pi: ExtensionAPI;
	private state: WorkflowState | null = null;
	private artifactsDir: string | null = null;
	private cwd: string | null = null;
	private rejectionReason: string | null = null;
	private lastPromptArtifacts: string[] | null = null;
	private completedNodes: Set<string> = new Set();
	private skippedNodes: Set<string> = new Set();
	private resolvedArtifacts: Map<string, string[]> = new Map();
	private currentUserMessage: string | null = null;
	private currentOutputFormat: Record<string, unknown> | null = null;
	private modelProfile: ModelProfile | null = null;

	private _currentNodeId = "unknown";
	get currentNodeId() { return this._currentNodeId; }
	set currentNodeId(v: string) { this._currentNodeId = v; activeNodeId = v; }

	private _respondToolActive = false;
	get respondToolActive() { return this._respondToolActive; }
	set respondToolActive(v: boolean) { this._respondToolActive = v; respondActive = v; }

	private _respondToolCaptured: string | null = null;
	get respondToolCaptured() { return this._respondToolCaptured; }
	set respondToolCaptured(v: string | null) { this._respondToolCaptured = v; respondCaptured = v; }

	constructor(pi: ExtensionAPI) {
		this.pi = pi;

		// Register the synthetic __respond tool. The model calls this instead of
		// generating bare text, keeping it in tool-calling mode. The execute handler
		// captures the message; executePromptNode reads it after sendAndWait.
		pi.registerTool({
			name: "__respond",
			description: "Use __respond to deliver your text response. Call this tool instead of generating bare text.",
			parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
			execute: async (_toolCallId: string, params: Record<string, unknown>) => {
				const msg = String(params.message ?? "");
				if (!respondActive) {
					// Not in a guarded prompt turn — pass through normally.
					return { content: [{ type: "text", text: msg }] };
				}
				respondCaptured = msg;
				this.logEvent({
					event: "tool_call_blocked",
					nodeId: activeNodeId,
					tool: "__respond",
					reason: "respond tool intercepted",
				});
				return { content: [], terminate: true };
			},
		} as any);

		// Log all tool calls (shape only, not full arguments).
		pi.on("tool_call", (event) => {
			const e = event as unknown as Record<string, unknown>;
			const toolName = (e.toolName as string)
				?? (e.tool as { name?: string })?.name
				?? "unknown";
			const argKeys = Object.keys((e.input as Record<string, unknown>) ?? {});
			this.logEvent({
				event: "tool_call_selected",
				nodeId: activeNodeId,
				tool: toolName,
				argKeys,
			});
		});

		// session_start fires on the NEW session's pi before withSession() is called.
		// If a prior fresh_context node set pendingAllowedTools, apply them now.
		pi.on("session_start", () => {
			if (pendingAllowedTools) {
				const tools = pendingAllowedTools;
				pi.setActiveTools(tools);
				pendingAllowedTools = null;
				this.logEvent({
					event: "tool_set_activated",
					nodeId: activeNodeId,
					tools,
				});
			} else if ((globalThis as Record<string, unknown>).__piWorkflowRunning) {
				// fresh_context without allowed_tools — no tool restriction,
				// but ensure __respond is available. The old executor's pi is
				// stale, so executePromptNode can't add it itself.
				try {
					const active = pi.getActiveTools() as string[];
					if (!active.includes("__respond")) {
						pi.setActiveTools([...active, "__respond"]);
					}
				} catch {
					// getActiveTools may not exist
				}
			}
		});
	}

	getState(): WorkflowState | null {
		return this.state;
	}

	async run(
		workflow: WorkflowDefinition,
		userMessage: string,
		initialCtx: ExtensionCommandContext,
		resumeState?: { artifactsDir: string; completedNodes: string[]; skippedNodes?: string[]; resolvedArtifacts?: Record<string, string[]>; startedAt: string; userMessage?: string },
	): Promise<void> {
		this.cwd = initialCtx.cwd;

		if (resumeState) {
			this.artifactsDir = resumeState.artifactsDir;
			activeArtifactsDir = this.artifactsDir;
			this.completedNodes = new Set(resumeState.completedNodes);
			this.skippedNodes = new Set(resumeState.skippedNodes ?? []);
			this.resolvedArtifacts = new Map(Object.entries(resumeState.resolvedArtifacts ?? {}));
			if (!userMessage && resumeState.userMessage) userMessage = resumeState.userMessage;
		} else {
			const runId = `${workflow.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
			this.artifactsDir = join(initialCtx.cwd, ".pi", "workflow-artifacts", runId);
			activeArtifactsDir = this.artifactsDir;
			await mkdir(this.artifactsDir, { recursive: true });
		}

		this.state = {
			workflowName: workflow.name,
			currentNodeIndex: 0,
			totalNodes: workflow.nodes.length,
			outputs: new Map(),
			startedAt: resumeState ? new Date(resumeState.startedAt).getTime() : Date.now(),
			status: "running",
		};
		(globalThis as Record<string, unknown>).__piWorkflowRunning = true;

		const ctxWithModel = initialCtx as { model?: { id?: string; name?: string; contextWindow?: number; input?: string[]; reasoning?: boolean } };
		this.modelProfile = getModelProfile(ctxWithModel.model);

		const workflowStartPayload = {
			event: "workflow_start",
			workflow: workflow.name,
			description: workflow.description,
			nodeCount: workflow.nodes.length,
			userMessage,
			artifactsDir: this.artifactsDir,
			timestamp: Date.now(),
			model: this.modelProfile.id,
			modelSize: this.modelProfile.sizeClass,
			modelContext: this.modelProfile.contextWindow,
			modelVision: this.modelProfile.supportsVision,
		};
		// pi is still the active runtime here (initial ctx, no session replacement yet).
		this.pi.appendEntry("workflow_metadata", workflowStartPayload);
		await this.logEvent(workflowStartPayload);

		if (resumeState) {
			this.notify(initialCtx, `Resuming workflow: ${workflow.name} — skipping ${resumeState.completedNodes.length} completed node(s)\nArtifacts: ${this.artifactsDir}`);
		} else {
			this.notify(initialCtx, `Starting workflow: ${workflow.name} (${workflow.nodes.length} nodes)\nArtifacts: ${this.artifactsDir}`);
		}

		this.currentUserMessage = userMessage;

		try {
			const hasDag = workflow.nodes.some(n =>
					(n.depends_on?.length) ||
					n.when ||
					n.type === "loop" || n.type === "cancel"
				);

				if (hasDag) {
					const steps = buildDag(workflow.nodes);
					await this.runDag(steps, workflow.nodes, userMessage, initialCtx);
				} else {
					await this.runFrom(workflow.nodes, 0, userMessage, initialCtx);
				}
			this.state.status = "completed";
			this.notify(initialCtx, `Workflow '${workflow.name}' completed successfully.`);
		} catch (err) {
			this.state.status = err instanceof WorkflowCancelled ? "cancelled" : "failed";
			const msg = err instanceof Error ? err.message : String(err);
			this.notify(initialCtx, `Workflow '${workflow.name}' ${this.state.status}: ${msg}`, "error");
		} finally {
			const workflowEndPayload = {
				event: "workflow_end",
				workflow: workflow.name,
				status: this.state!.status,
				elapsed: Date.now() - this.state!.startedAt,
				timestamp: Date.now(),
			};
			// pi.appendEntry is safe here: the finally block runs in the same async
			// frame as the outer run() call, before any session replacement has occurred
			// at the top level. If a withSession replaced the session, the finally only
			// runs after all nested withSession callbacks have resolved, at which point
			// the initial ctx is permanently stale — but this.pi itself is still valid
			// because it's a long-lived ExtensionAPI that the new session's re-loaded
			// extension factory has re-initialized. Wait — actually: this.pi IS the old
			// pi from before session replacement. After newSession(), this.pi is stale.
			//
			// We skip pi.appendEntry for workflow_end if we are after a session
			// replacement (i.e., if any fresh_context node fired). We do this by
			// trying and swallowing the error so that logging failures never abort
			// cleanup.
			try {
				this.pi.appendEntry("workflow_metadata", workflowEndPayload);
			} catch {
				// pi is stale after session replacement — log to events.jsonl only.
			}
			await this.logEvent(workflowEndPayload);

			if (this.state!.status === "completed") {
				try {
					(this.pi as any).events.emit("workflow:completed", {
						workflowName: workflow.name,
						artifactsDir: this.artifactsDir,
						eventsPath: join(this.artifactsDir!, "events.jsonl"),
						userMessage,
					});
				} catch {
					// EventBus emit failure is non-fatal
				}
			}

			pendingAllowedTools = null;
			activeNodeId = "unknown";
			respondActive = false;
			respondCaptured = null;
			activeArtifactsDir = null;
			// Remove __respond from active tools so it doesn't leak into user session.
			try {
				const active = (this.pi as any).getActiveTools?.() as string[] | undefined;
				if (active?.includes("__respond")) {
					(this.pi as any).setActiveTools(active.filter((t: string) => t !== "__respond"));
				}
			} catch {
				// pi may be stale after session replacement
			}
			this.artifactsDir = null;
			this.cwd = null;
			this.rejectionReason = null;
			this.lastPromptArtifacts = null;
			this.completedNodes = new Set();
			this.skippedNodes = new Set();
			this.resolvedArtifacts = new Map();
			this.currentUserMessage = null;
			this.currentOutputFormat = null;
			this.currentNodeId = "unknown";
			this.respondToolActive = false;
			this.respondToolCaptured = null;
			this.state = null;
			(globalThis as Record<string, unknown>).__piWorkflowRunning = false;
		}
	}

	/**
	 * Core iteration loop. Processes nodes starting from startIdx.
	 *
	 * When a fresh_context prompt node is encountered, this method opens a new
	 * session via ctx.newSession({ withSession }). Inside the callback it:
	 *   1. Executes the fresh_context prompt node itself in newCtx.
	 *   2. Calls runFrom() recursively for all remaining nodes with newCtx.
	 * Then it returns immediately — the continuation is running inside withSession.
	 *
	 * Non-fresh-context nodes are executed in-place with the passed ctx.
	 */
	private async runFrom(nodes: WorkflowNode[], startIdx: number, userMessage: string, ctx: AnyCtx): Promise<void> {
		for (let i = startIdx; i < nodes.length; i++) {
			const node = nodes[i];
			const resolved = this.resolveVariables(node, userMessage);

			if (this.state) this.state.currentNodeIndex = i;

			if (this.completedNodes.has(node.id)) {
				this.notify(ctx, `[${i + 1}/${nodes.length}] Skipping (resumed): ${node.id}`);
				continue;
			}

			this.notify(ctx, `[${i + 1}/${nodes.length}] Running node: ${node.id} (${node.type})`);

			const nodeStartPayload = {
				event: "node_start",
				nodeId: node.id,
				nodeType: node.type,
				nodeIndex: i,
				timestamp: Date.now(),
			};
			// Log to events.jsonl only — pi.appendEntry may be stale inside withSession.
			await this.logEvent(nodeStartPayload);

			// fresh_context loop: open new sessions per iteration, continue remainder inside.
			if (resolved.type === "loop" && (resolved as LoopNode).fresh_context === true) {
				await this.logEvent({ event: "fresh_context", strategy: "A-withSession" });
				this.notify(ctx, "  ↳ fresh context loop: opening new sessions per iteration");
				await this.runFreshContextLoopInLinear(node as LoopNode, nodes, i, userMessage, ctx);
				return;
			}

			// fresh_context prompt: open a new session and run the remainder inside.
			if (resolved.type === "prompt" && resolved.fresh_context === true) {
				await this.logEvent({ event: "fresh_context", strategy: "A-withSession" });
				this.notify(ctx, "  ↳ fresh context: opening new session before next prompt");

				// Set currentNodeId BEFORE newSession() so the session_start handler
				// attributes tool_set_activated to the correct node (not the previous one).
				activeNodeId = node.id;
				this.currentNodeId = node.id;

				// Set before newSession() — the new session's session_start handler reads
				// this and calls pi.setActiveTools() before withSession fires.
				// Always include __respond so the model stays in tool-calling mode.
				if (resolved.allowed_tools && resolved.allowed_tools.length > 0) {
					pendingAllowedTools = [...resolved.allowed_tools, "__respond"];
				} else {
					// No allowed_tools restriction — signal session_start to just add __respond.
					pendingAllowedTools = null;
				}

				const result = await (ctx as ExtensionCommandContext).newSession({
					withSession: async (newCtx: ReplacedSessionContext) => {
						// session_start has already fired; pendingAllowedTools consumed.
						// Route through executeWithRetry so fresh_context nodes get the
						// same retry protection as normal nodes (Phase 0 showed 25% crash
						// rate at fresh_context boundaries).
						this.currentOutputFormat = (resolved as PromptNode).output_format ?? null;
						const output = await this.executeWithRetry(resolved, newCtx);
						this.currentOutputFormat = null;
						const promptOutput = output ?? `[prompt node ${node.id} completed]`;
						// FIX 2: track for pre-gate check on the next approval node.
						this.lastPromptArtifacts = resolved.expected_artifacts ?? null;
						this.completedNodes.add(node.id);
						await this.writeWorkflowState(nodes[i + 1]?.id ?? null, userMessage);
						this.state?.outputs.set(node.id, promptOutput);

						const nodeCompletePayload = {
							event: "node_complete",
							nodeId: node.id,
							nodeType: node.type,
							nodeIndex: i,
							outputLength: promptOutput.length,
							timestamp: Date.now(),
						};
						await this.logEvent(nodeCompletePayload);

						// Process all remaining nodes inside this withSession callback.
						await this.runFrom(nodes, i + 1, userMessage, newCtx);
					},
				});

				if (result.cancelled) {
					throw new WorkflowCancelled("Session replacement cancelled");
				}
				// Execution of nodes i+1..end happened inside withSession. We're done.
				return;
			}

			// FIX 2: before any approval node, verify that the previous prompt node's
			// expected_artifacts all exist. If not, fail now — don't show the gate.
			if (resolved.type === "approval" && this.lastPromptArtifacts?.length) {
				const missing = this.lastPromptArtifacts.filter(p => !existsSync(p));
				if (missing.length > 0) {
					const msg = `Pre-gate check failed before '${node.id}': missing artifacts: ${missing.join(", ")}`;
					this.notify(ctx, msg, "error");
					throw new WorkflowFailed(msg);
				}
			}

			// Normal (non-fresh-context) node execution.
			// Loop nodes handle per-iteration retry internally via synthetic prompt
			// nodes — bypass outer executeWithRetry to prevent whole-loop replay.
			let output: string | undefined;
			if (resolved.type === "loop") {
				output = await this.executeLoopNode(resolved as LoopNode, ctx);
			} else {
				this.currentOutputFormat = resolved.type === "prompt"
					? (resolved as PromptNode).output_format ?? null : null;
				output = await this.executeWithRetry(resolved, ctx);
				this.currentOutputFormat = null;
			}
			if (output !== undefined && this.state) {
				this.state.outputs.set(node.id, output);
			}

			// Track expected_artifacts from prompt/loop nodes for the next approval check.
			if (resolved.type === "prompt" || resolved.type === "loop") {
				this.lastPromptArtifacts = resolved.expected_artifacts ?? null;
			}

			this.completedNodes.add(node.id);
			await this.writeWorkflowState(nodes[i + 1]?.id ?? null, userMessage);

			const nodeCompletePayload = {
				event: "node_complete",
				nodeId: node.id,
				nodeType: node.type,
				nodeIndex: i,
				outputLength: output?.length ?? 0,
				timestamp: Date.now(),
			};
			// Try pi.appendEntry — safe when no session replacement has occurred yet.
			try {
				this.pi.appendEntry("workflow_metadata", nodeCompletePayload);
			} catch {
				// Stale pi after session replacement — events.jsonl covers it.
			}
			await this.logEvent(nodeCompletePayload);
		}
	}

	/**
	 * DAG-aware execution loop. Processes steps produced by buildDag().
	 *
	 * INVARIANT: After a fresh_context node triggers runFreshContextInDag(),
	 * the outer ctx is permanently dead. This method MUST return — never
	 * continue — after that call. All remaining steps execute inside the
	 * withSession callback via a recursive runDag() call.
	 */
	private async runDag(
		steps: DagStep[],
		allNodes: WorkflowNode[],
		userMessage: string,
		ctx: AnyCtx,
	): Promise<void> {
		for (let layerIdx = 0; layerIdx < steps.length; layerIdx++) {
			const step = steps[layerIdx];

			await this.logEvent({
				event: "dag_layer_start",
				layerIndex: layerIdx,
				nodeIds: step.nodes.map(n => n.id),
				parallel: step.executionMode === "bash_parallel",
			});

			if (step.executionMode === "bash_parallel") {
				await this.runBashParallelStep(step, userMessage, ctx);
				continue;
			}

			for (const node of step.nodes) {
				if (this.completedNodes.has(node.id) || this.skippedNodes.has(node.id)) continue;

				if (node.when) {
					const condResult = evaluateCondition(node.when, this.state!.outputs);
					await this.logEvent({
						event: "condition_evaluated",
						nodeId: node.id,
						expression: node.when,
						result: condResult,
					});
					if (!condResult) {
						this.skippedNodes.add(node.id);
						continue;
					}
				}

				const resolved = this.resolveVariables(node, userMessage);

				if (resolved.type === "loop" && (resolved as LoopNode).fresh_context) {
					const remainingSteps = steps.slice(layerIdx + 1);
					await this.runFreshContextLoopInDag(node as LoopNode, remainingSteps, allNodes, userMessage, ctx);
					return;
				}

				if (resolved.type === "prompt" && (resolved as PromptNode).fresh_context) {
					const remainingSteps = steps.slice(layerIdx + 1);
					await this.runFreshContextInDag(resolved, remainingSteps, allNodes, userMessage, ctx);
					return;
				}

				if (resolved.type === "approval") {
					let artifacts: string[];
					if (node.depends_on?.length) {
						artifacts = this.collectUpstreamArtifacts(node, allNodes);
					} else {
						let fallback: string[] = [];
						for (let j = allNodes.indexOf(node) - 1; j >= 0; j--) {
							const prev = allNodes[j];
							if ((prev.type === "prompt" || prev.type === "loop") && this.completedNodes.has(prev.id)) {
								fallback = this.resolvedArtifacts.get(prev.id) ?? [];
								break;
							}
						}
						artifacts = fallback;
					}
					if (artifacts.length > 0) {
						const missing = artifacts.filter(p => !existsSync(p));
						if (missing.length > 0) {
							const msg = `Pre-gate check failed before '${node.id}': missing artifacts: ${missing.join(", ")}`;
							this.notify(ctx, msg, "error");
							throw new WorkflowFailed(msg);
						}
					}
				}

				this.notify(ctx, `[DAG layer ${layerIdx + 1}/${steps.length}] Running node: ${node.id} (${node.type})`);

				await this.logEvent({
					event: "node_start",
					nodeId: node.id,
					nodeType: node.type,
					layerIndex: layerIdx,
					timestamp: Date.now(),
				});

				let output: string | undefined;
				if (resolved.type === "loop") {
					output = await this.executeLoopNode(resolved as LoopNode, ctx);
				} else {
					this.currentOutputFormat = resolved.type === "prompt"
						? (resolved as PromptNode).output_format ?? null : null;
					output = await this.executeWithRetry(resolved, ctx);
					this.currentOutputFormat = null;
				}
				if (output !== undefined && this.state) {
					this.state.outputs.set(node.id, output);
				}
				if (resolved.type === "prompt" && (resolved as PromptNode).expected_artifacts?.length) {
					this.resolvedArtifacts.set(node.id, (resolved as PromptNode).expected_artifacts!);
				}
				this.completedNodes.add(node.id);

				if (this.state) this.state.currentNodeIndex = this.completedNodes.size;
				await this.writeWorkflowState(null, userMessage);

				await this.logEvent({
					event: "node_complete",
					nodeId: node.id,
					nodeType: node.type,
					layerIndex: layerIdx,
					outputLength: output?.length ?? 0,
					timestamp: Date.now(),
				});
			}
		}
	}

	private async runFreshContextInDag(
		freshNode: WorkflowNode,
		remainingSteps: DagStep[],
		allNodes: WorkflowNode[],
		userMessage: string,
		ctx: AnyCtx,
	): Promise<void> {
		const resolved = freshNode as PromptNode;

		activeNodeId = freshNode.id;
		this.currentNodeId = freshNode.id;

		if (resolved.allowed_tools && resolved.allowed_tools.length > 0) {
			pendingAllowedTools = [...resolved.allowed_tools, "__respond"];
		} else {
			pendingAllowedTools = null;
		}

		await this.logEvent({ event: "fresh_context", strategy: "A-withSession-dag" });
		this.notify(ctx, "  ↳ fresh context: opening new session before next prompt");

		const result = await (ctx as ExtensionCommandContext).newSession({
			withSession: async (newCtx: ReplacedSessionContext) => {
				await this.logEvent({
					event: "node_start",
					nodeId: freshNode.id,
					nodeType: freshNode.type,
					timestamp: Date.now(),
				});
				this.currentOutputFormat = (resolved as PromptNode).output_format ?? null;
				const output = await this.executeWithRetry(freshNode, newCtx);
				this.currentOutputFormat = null;
				const promptOutput = output ?? `[prompt node ${freshNode.id} completed]`;
				if (resolved.expected_artifacts?.length) {
					this.resolvedArtifacts.set(freshNode.id, resolved.expected_artifacts);
				}
				this.completedNodes.add(freshNode.id);
				if (this.state) {
					this.state.outputs.set(freshNode.id, promptOutput);
					this.state.currentNodeIndex = this.completedNodes.size;
				}
				await this.writeWorkflowState(null, userMessage);
				await this.logEvent({
					event: "node_complete",
					nodeId: freshNode.id,
					nodeType: freshNode.type,
					outputLength: promptOutput.length,
					timestamp: Date.now(),
				});

				await this.runDag(remainingSteps, allNodes, userMessage, newCtx);
			},
		});

		if (result.cancelled) {
			throw new WorkflowCancelled("Session replacement cancelled");
		}
	}

	private async runFreshContextLoopInDag(
		node: LoopNode,
		remainingSteps: DagStep[],
		allNodes: WorkflowNode[],
		userMessage: string,
		ctx: AnyCtx,
	): Promise<void> {
		await this.logEvent({ event: "fresh_context", strategy: "A-withSession-dag" });
		this.notify(ctx, "  ↳ fresh context loop: opening new sessions per iteration");

		await this.logEvent({
			event: "node_start",
			nodeId: node.id,
			nodeType: node.type,
			timestamp: Date.now(),
		});

		let lastOutput: string | undefined;
		let latestCtx: AnyCtx = ctx;

		for (let iteration = 0; iteration < node.max_iterations; iteration++) {
			const resolved = this.resolveVariables(node, userMessage, iteration) as LoopNode;

			if (resolved.allowed_tools?.length) {
				pendingAllowedTools = [...resolved.allowed_tools, "__respond"];
			} else {
				pendingAllowedTools = null;
			}
			activeNodeId = node.id;
			this.currentNodeId = node.id;

			this.notify(latestCtx, `  ↳ loop '${node.id}' iteration ${iteration + 1}/${node.max_iterations} (fresh context)`);

			let iterOutput = "";
			const result = await (latestCtx as ExtensionCommandContext).newSession({
				withSession: async (newCtx: ReplacedSessionContext) => {
					const syntheticNode: PromptNode = {
						id: node.id,
						type: "prompt",
						prompt: resolved.prompt,
						expected_artifacts: resolved.expected_artifacts,
					};
					this.currentOutputFormat = null;
					const output = await this.executeWithRetry(syntheticNode, newCtx);
					iterOutput = output ?? `[loop iteration ${iteration} completed]`;
					latestCtx = newCtx;
				},
			});

			if (result.cancelled) {
				throw new WorkflowCancelled("Session replacement cancelled during loop");
			}
			lastOutput = iterOutput;

			const signalDetected = node.until
				? lastOutput.includes(node.until)
				: false;

			await this.logEvent({
				event: "loop_iteration",
				nodeId: node.id, iteration,
				maxIterations: node.max_iterations, signalDetected,
			});

			if (signalDetected) {
				if (this.state) this.state.outputs.set(node.id, lastOutput);
				if (resolved.expected_artifacts?.length) {
					this.resolvedArtifacts.set(node.id, resolved.expected_artifacts);
				}
				this.completedNodes.add(node.id);
				if (this.state) this.state.currentNodeIndex = this.completedNodes.size;
				await this.writeWorkflowState(null, userMessage);

				await this.logEvent({
					event: "node_complete",
					nodeId: node.id,
					nodeType: node.type,
					outputLength: lastOutput.length,
					timestamp: Date.now(),
				});

				if (remainingSteps.length > 0) {
					await this.runDag(remainingSteps, allNodes, userMessage, latestCtx);
				}
				return;
			}
		}

		await this.logEvent({
			event: "loop_exhausted",
			nodeId: node.id, maxIterations: node.max_iterations,
		});
		throw new WorkflowFailed(
			`Loop node '${node.id}': exhausted ${node.max_iterations} iterations`,
		);
	}

	private async runFreshContextLoopInLinear(
		node: LoopNode,
		nodes: WorkflowNode[],
		currentIndex: number,
		userMessage: string,
		ctx: AnyCtx,
	): Promise<void> {
		let lastOutput: string | undefined;
		let latestCtx: AnyCtx = ctx;

		for (let iteration = 0; iteration < node.max_iterations; iteration++) {
			const resolved = this.resolveVariables(node, userMessage, iteration) as LoopNode;

			if (resolved.allowed_tools?.length) {
				pendingAllowedTools = [...resolved.allowed_tools, "__respond"];
			} else {
				pendingAllowedTools = null;
			}
			activeNodeId = node.id;
			this.currentNodeId = node.id;

			this.notify(latestCtx, `  ↳ loop '${node.id}' iteration ${iteration + 1}/${node.max_iterations} (fresh context)`);

			let iterOutput = "";
			const result = await (latestCtx as ExtensionCommandContext).newSession({
				withSession: async (newCtx: ReplacedSessionContext) => {
					const syntheticNode: PromptNode = {
						id: node.id,
						type: "prompt",
						prompt: resolved.prompt,
						expected_artifacts: resolved.expected_artifacts,
					};
					this.currentOutputFormat = null;
					const output = await this.executeWithRetry(syntheticNode, newCtx);
					iterOutput = output ?? `[loop iteration ${iteration} completed]`;
					latestCtx = newCtx;
				},
			});

			if (result.cancelled) {
				throw new WorkflowCancelled("Session replacement cancelled during loop");
			}
			lastOutput = iterOutput;

			const signalDetected = node.until
				? lastOutput.includes(node.until)
				: false;

			await this.logEvent({
				event: "loop_iteration",
				nodeId: node.id, iteration,
				maxIterations: node.max_iterations, signalDetected,
			});

			if (signalDetected) {
				if (this.state) this.state.outputs.set(node.id, lastOutput);
				if (resolved.expected_artifacts?.length) {
					this.resolvedArtifacts.set(node.id, resolved.expected_artifacts);
				}
				this.lastPromptArtifacts = resolved.expected_artifacts ?? null;
				this.completedNodes.add(node.id);
				await this.writeWorkflowState(nodes[currentIndex + 1]?.id ?? null, userMessage);

				await this.logEvent({
					event: "node_complete",
					nodeId: node.id,
					nodeType: node.type,
					nodeIndex: currentIndex,
					outputLength: lastOutput.length,
					timestamp: Date.now(),
				});

				if (currentIndex + 1 < nodes.length) {
					await this.runFrom(nodes, currentIndex + 1, userMessage, latestCtx);
				}
				return;
			}
		}

		await this.logEvent({
			event: "loop_exhausted",
			nodeId: node.id, maxIterations: node.max_iterations,
		});
		throw new WorkflowFailed(
			`Loop node '${node.id}': exhausted ${node.max_iterations} iterations`,
		);
	}

	private async runBashParallelStep(
		step: DagStep,
		userMessage: string,
		ctx: AnyCtx,
	): Promise<void> {
		const results = await Promise.all(
			step.nodes.map(async (node) => {
				if (this.completedNodes.has(node.id) || this.skippedNodes.has(node.id)) {
					return { id: node.id, output: undefined as string | undefined, skipped: true };
				}

				if (node.when) {
					const condResult = evaluateCondition(node.when, this.state!.outputs);
					await this.logEvent({
						event: "condition_evaluated",
						nodeId: node.id,
						expression: node.when,
						result: condResult,
					});
					if (!condResult) {
						return { id: node.id, output: undefined as string | undefined, skipped: true };
					}
				}

				await this.logEvent({
						event: "node_start",
						nodeId: node.id,
						nodeType: node.type,
						timestamp: Date.now(),
					});
					const resolved = this.resolveVariables(node, userMessage);
					this.currentOutputFormat = resolved.type === "prompt"
						? (resolved as PromptNode).output_format ?? null : null;
					const output = await this.executeWithRetry(resolved, ctx);
					this.currentOutputFormat = null;
					await this.logEvent({
						event: "node_complete",
						nodeId: node.id,
						nodeType: node.type,
						outputLength: output?.length ?? 0,
						timestamp: Date.now(),
					});
					return { id: node.id, output, skipped: false };
			}),
		);

		for (const { id, output, skipped } of results) {
			if (skipped) {
				this.skippedNodes.add(id);
			} else {
				if (output !== undefined && this.state) {
					this.state.outputs.set(id, output);
				}
				this.completedNodes.add(id);
			}
		}
		if (this.state) this.state.currentNodeIndex = this.completedNodes.size;
		await this.writeWorkflowState(null, userMessage);
	}

	private collectUpstreamArtifacts(
		node: WorkflowNode,
		allNodes: WorkflowNode[],
	): string[] {
		const nodeMap = new Map(allNodes.map(n => [n.id, n]));
		const visited = new Set<string>();
		const artifacts: string[] = [];

		const walk = (id: string) => {
			if (visited.has(id)) return;
			visited.add(id);
			const n = nodeMap.get(id);
			if (!n) return;
			const resolved = this.resolvedArtifacts.get(n.id);
			if (resolved?.length) {
				artifacts.push(...resolved);
			}
			if (n.depends_on) {
				for (const depId of n.depends_on) walk(depId);
			}
		};

		if (node.depends_on) {
			for (const depId of node.depends_on) walk(depId);
		}
		return artifacts;
	}

	/**
	 * Execute a node with retry and exponential backoff.
	 *
	 * Fatal errors (WorkflowCancelled, WorkflowFailed) are thrown immediately
	 * without retry. Transient errors (connection, timeout, format) are retried
	 * up to maxAttempts times with 3^n second delays.
	 */
	private async executeWithRetry(
		node: WorkflowNode,
		ctx: AnyCtx,
		maxAttempts: number = 3,
	): Promise<string | undefined> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return await this.executeNode(node, ctx);
			} catch (err) {
				const error = err as Error;

				if (error.name === "WorkflowCancelled" || error.name === "WorkflowFailed") {
					throw error;
				}

				lastError = error;
				const errorClass = this.classifyError(error);

				// Only retry known transient error classes. Unknown errors fail
				// fast. tool_call_format is only retryable for prompt nodes —
				// bash output containing "parse"/"JSON" is a real failure.
				if (errorClass === "unknown") {
					throw error;
				}
				if (errorClass === "tool_call_format" && node.type !== "prompt") {
					throw error;
				}
				let rescuedCall: { name: string; arguments: Record<string, unknown> } | null = null;

				await this.logEvent({
					event: "node_retry",
					nodeId: node.id,
					attempt,
					maxAttempts,
					errorClass,
					error: error.message.slice(0, 500),
				});

				// Attempt rescue parse on tool-call format errors.
				// PI has no pi.executeTool() API — we can't dispatch the rescued call
				// directly. Instead, rescued info feeds the retry correction message
				// so the model knows exactly what tool call to re-emit properly.
				if (errorClass === "tool_call_format") {
					rescuedCall = this.rescueToolCall(error.message);
					await this.logEvent({
						event: "rescue_parse",
						nodeId: node.id,
						format: error.message.includes("```") ? "code_fence"
							: error.message.includes("<tool_call>") ? "xml_wrapper"
							: "truncated_json",
						success: rescuedCall !== null,
						rescuedTool: rescuedCall?.name,
					});
				}

				if (attempt < maxAttempts) {
					const delayMs = Math.pow(3, attempt - 1) * 1000; // 1s, 3s, 9s
					this.notify(ctx, `  ↳ retry ${attempt}/${maxAttempts} in ${delayMs / 1000}s: ${error.message.slice(0, 100)}`);
					await new Promise(r => setTimeout(r, delayMs));

					if (node.type === "prompt") {
						// Build a targeted correction message. When rescue parsed a
						// valid tool call, tell the model exactly what to re-emit —
						// this is far more effective than a generic "try again".
						const correction = rescuedCall
							? `[RETRY] Your previous tool call was malformed. You were trying to call "${rescuedCall.name}" ` +
							  `with keys [${Object.keys(rescuedCall.arguments).join(", ")}]. ` +
							  `Call the tool again using the correct format — no code fences, no XML wrappers, just the tool call.`
							: `[RETRY] Previous attempt failed: ${error.message.slice(0, 200)}. ` +
							  `Try again. Follow your instructions exactly.`;
						try {
							await this.sendAndWait(ctx, correction, { deliverAs: "steer" });
						} catch {
							// Correction message failed — continue to next retry attempt anyway
						}
					}
				}
			}
		}

		throw lastError ?? new Error(`Node ${node.id} failed after ${maxAttempts} attempts`);
	}

	/**
	 * Classify an error as transient or fatal for retry decisions.
	 */
	private classifyError(error: Error): string {
		const msg = error.message.toLowerCase();
		if (msg.includes("connect") || msg.includes("econnrefused") || msg.includes("econnreset") || msg.includes("socket")) {
			return "connection";
		}
		if (msg.includes("timeout") || msg.includes("timed out")) {
			return "timeout";
		}
		if (msg.includes("parse") || msg.includes("json") || msg.includes("format") || msg.includes("malformed")) {
			return "tool_call_format";
		}
		return "unknown";
	}

	private async executeNode(node: WorkflowNode, ctx: AnyCtx): Promise<string | undefined> {
		switch (node.type) {
			case "prompt":
				return this.executePromptNode(node.id, node.prompt, ctx, (node as PromptNode).expected_artifacts);
			case "bash":
				return this.executeBash(node.id, node.command, node.timeout, node.allow_failure, ctx);
			case "approval":
				return this.executeApproval(node, ctx);
			case "loop":
				return this.executeLoopNode(node as LoopNode, ctx);
			case "cancel":
				this.notify(ctx, `Workflow cancelled: ${(node as CancelNode).message}`);
				throw new WorkflowCancelled((node as CancelNode).message);
		}
	}

	private async executeLoopNode(
		node: LoopNode,
		ctx: AnyCtx,
	): Promise<string | undefined> {
		let lastOutput: string | undefined;

		for (let iteration = 0; iteration < node.max_iterations; iteration++) {
			const resolved = this.resolveVariables(node, this.currentUserMessage!, iteration) as LoopNode;

			this.notify(ctx, `  ↳ loop '${node.id}' iteration ${iteration + 1}/${node.max_iterations}`);

			const syntheticNode: PromptNode = {
				id: node.id,
				type: "prompt",
				prompt: resolved.prompt,
				expected_artifacts: resolved.expected_artifacts,
			};

			this.currentOutputFormat = null;
			const output = await this.executeWithRetry(syntheticNode, ctx);
			lastOutput = output ?? `[loop iteration ${iteration} completed]`;

			const signalDetected = node.until
				? lastOutput.includes(node.until)
				: false;

			await this.logEvent({
				event: "loop_iteration",
				nodeId: node.id,
				iteration,
				maxIterations: node.max_iterations,
				signalDetected,
			});

			if (signalDetected) {
				if (resolved.expected_artifacts?.length) {
					this.resolvedArtifacts.set(node.id, resolved.expected_artifacts);
				}
				return lastOutput;
			}
		}

		await this.logEvent({
			event: "loop_exhausted",
			nodeId: node.id,
			maxIterations: node.max_iterations,
		});
		throw new WorkflowFailed(
			`Loop node '${node.id}': exhausted ${node.max_iterations} iterations without '${node.until ?? "completion"}' signal`,
		);
	}

	private async executePromptNode(
		nodeId: string,
		prompt: string,
		ctx: AnyCtx,
		expectedArtifacts?: string[],
	): Promise<string> {
		activeNodeId = nodeId;
		this.currentNodeId = nodeId;

		const cleanupRespond = this.installRespondTool();

		// Snapshot active tools so we can restore after removing __respond.
		let savedTools: string[] | null = null;
		try {
			const active = (this.pi as any).getActiveTools?.() as string[] | undefined;
			if (active) {
				savedTools = [...active];
				if (!active.includes("__respond")) {
					(this.pi as any).setActiveTools([...active, "__respond"]);
				}
			}
		} catch {
			// getActiveTools may not exist on all PI versions
		}

		try {
			let promptText = prompt;
			if (this.currentOutputFormat) {
				const schemaStr = JSON.stringify(this.currentOutputFormat, null, 2);
				promptText += `\n\nYou MUST respond with ONLY valid JSON matching this schema:\n${schemaStr}\n` +
					`Output raw JSON only — no code fences, no explanation, no text before or after the JSON.`;
			}

			await this.sendAndWait(ctx, promptText, { deliverAs: "followUp" });

			if (expectedArtifacts && expectedArtifacts.length > 0) {
				const missing = expectedArtifacts.filter(p => !existsSync(p));
				await this.logEvent({
					event: "artifact_check",
					nodeId,
					expected: expectedArtifacts,
					missing,
				});
				if (missing.length > 0) {
					for (const p of missing) {
						await this.logEvent({ event: "missing_artifact", nodeId, path: p });
						this.notify(ctx, `Missing artifact: ${p}`, "error");
					}
					const retryLines = missing.map(p => `Required file ${p} was not created. Create it now.`);
					const retryPrompt = retryLines.join("\n");
					this.notify(ctx, `  ↳ retrying node '${nodeId}' for ${missing.length} missing artifact(s)`);
					try {
						await this.sendAndWait(ctx, retryPrompt, { deliverAs: "followUp" });
					} catch (err) {
						const stillMissingAfterError = missing.filter(p => !existsSync(p));
						if (stillMissingAfterError.length === 0) {
							await this.logEvent({ event: "retry_recovered", nodeId, note: "sendAndWait threw but all artifacts exist" });
							this.notify(ctx, `  ↳ node '${nodeId}' retry recovered: artifacts present despite connection error`);
							if (respondCaptured && this.rescueToolCall(respondCaptured)) {
								throw new Error("malformed tool call captured via __respond in retry-recovered path");
							}
							return respondCaptured ?? `[prompt node ${nodeId} completed]`;
						}
						throw err;
					}

					const stillMissing = missing.filter(p => !existsSync(p));
					if (stillMissing.length > 0) {
						throw new WorkflowFailed(
							`Node '${nodeId}': required artifacts still missing after retry: ${stillMissing.join(", ")}`,
						);
					}
				}
			}

			const respondOutput = respondCaptured;
			if (respondOutput) {
				await this.logEvent({
					event: "respond_tool_captured",
					nodeId,
					messageLength: respondOutput.length,
				});

				// If the captured text is a malformed tool call, the model used __respond
				// to dump a tool call blob instead of actually calling the tool. Treat this
				// as a format error so executeWithRetry can re-prompt the model.
				const rescued = this.rescueToolCall(respondOutput);
				if (rescued) {
					await this.logEvent({
						event: "rescue_parse",
						nodeId,
						format: "respond_capture",
						success: true,
						rescuedTool: rescued.name,
					});
					throw new Error(
						`malformed tool call captured via __respond: tried to call "${rescued.name}" ` +
						`with keys [${Object.keys(rescued.arguments).join(", ")}]`,
					);
				}
			}

			if (this.currentOutputFormat) {
				if (!respondOutput) {
					throw new Error(
						`Node '${nodeId}': output_format requires structured JSON response via __respond, but no output was captured`,
					);
				}
				let jsonText = respondOutput.trim();
				if (jsonText.startsWith("```")) {
					jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
				}
				try {
					JSON.parse(jsonText);
					return jsonText;
				} catch {
					throw new Error(
						`Node '${nodeId}': output_format requires JSON but got unparseable text`,
					);
				}
			}

			return respondOutput ?? `[prompt node ${nodeId} completed]`;
		} finally {
			cleanupRespond();
			// Restore the tool set to remove __respond, preventing leakage
			// into later nodes or the post-workflow user session.
			if (savedTools) {
				try {
					(this.pi as any).setActiveTools(savedTools.filter((t: string) => t !== "__respond"));
				} catch {
					// pi may be stale after session replacement
				}
			}
		}
	}

	/**
	 * Execute a bash command, using child_process.spawn directly.
	 *
	 * We bypass pi.exec() because it calls runtime.assertActive() and would throw
	 * when called after session replacement (inside a withSession callback).
	 * child_process.spawn has no such guard — it's a pure Node.js call.
	 */
	private async executeBash(
		nodeId: string,
		command: string,
		timeout: number | undefined,
		allowFailure: boolean | undefined,
		ctx: AnyCtx,
	): Promise<string> {
		activeNodeId = nodeId;
		this.currentNodeId = nodeId;
		// Inject ARTIFACTS_DIR by prepending an export to the command string,
		// matching the pre-refactor behavior (ExecOptions has no env field).
		const artifactsDirExport = this.artifactsDir
			? `export ARTIFACTS_DIR=${JSON.stringify(this.artifactsDir)}; `
			: "";
		const result = await this.execBash(`${artifactsDirExport}${command}`, ctx.cwd, timeout ?? 60_000);
		const output = (result.stdout + result.stderr).trim();
		await this.logEvent({
			event: "bash_result",
			nodeId,
			exitCode: result.code,
			stdoutBytes: Buffer.byteLength(result.stdout),
			stderrBytes: Buffer.byteLength(result.stderr),
		});
		if (result.code !== 0 && !allowFailure) {
			throw new Error(`Bash node '${nodeId}' failed (exit ${result.code}): ${output.slice(0, 200)}`);
		}
		return output;
	}

	private async executeApproval(
		node: ApprovalNode,
		ctx: AnyCtx,
	): Promise<string | undefined> {
		const approved = await ctx.ui.confirm("Workflow Approval", node.message);

		if (approved) {
			if (node.capture_response) {
				// ctx.ui.prompt does not exist on ExtensionUIContext (verified from types.d.ts).
				// Fallback: use ctx.ui.input which provides a text input dialog.
				const note = await ctx.ui.input("Optional note (approve)", "") ?? "";
				await this.logEvent({ event: "approval_decision", approved: true, reason: note || undefined, onReject: node.on_reject });
				return note || "[approved]";
			}
			await this.logEvent({ event: "approval_decision", approved: true, onReject: node.on_reject });
			return undefined;
		}

		// Rejected
		let reason = "[rejected: no reason given]";
		if (node.capture_response) {
			// ctx.ui.prompt does not exist; use ctx.ui.input as fallback.
			const typed = await ctx.ui.input("Rejection reason", "") ?? "";
			if (typed) reason = typed;
		}
		this.rejectionReason = reason;
		await this.logEvent({ event: "approval_decision", approved: false, reason, onReject: node.on_reject });
		this.notify(ctx, `Approval rejected: ${reason}`, "error");

		switch (node.on_reject) {
			case "continue":
				return reason; // workflow continues; downstream prompts see $REJECTION_REASON
			case "rollback":
				await this.gitStash(ctx);
				throw new WorkflowCancelled(`Rejected (rollback): ${reason}`);
			case "cancel":
			default:
				throw new WorkflowCancelled(`Rejected: ${reason}`);
		}
	}

	private async gitStash(ctx: AnyCtx): Promise<void> {
		const tag = `workflow-${this.state?.workflowName ?? "unknown"}-${Date.now()}`;
		const result = await this.execBash(`git stash push -u -m "${tag}"`, ctx.cwd, 30_000);
		if (result.code === 0) {
			this.notify(ctx, `  ↳ rolled back via git stash (label: ${tag})`);
		} else {
			this.notify(ctx, `  ↳ git stash failed: ${result.stderr.slice(0, 200)}`, "error");
		}
	}

	/**
	 * Run a bash command via child_process.spawn with timeout support.
	 * This is a self-contained replacement for pi.exec that does NOT call
	 * runtime.assertActive(), making it safe both before and after session
	 * replacement.
	 */
	private execBash(command: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
		return new Promise((resolve) => {
			const proc = spawn("bash", ["-c", command], {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			let done = false;
			const timer = setTimeout(() => {
				if (!done) {
					done = true;
					proc.kill("SIGTERM");
					resolve({ stdout, stderr: stderr + "\n[timed out]", code: 124 });
				}
			}, timeoutMs);
			proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
			proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
			proc.on("close", (code) => {
				if (!done) {
					done = true;
					clearTimeout(timer);
					resolve({ stdout, stderr, code: code ?? 1 });
				}
			});
		});
	}

	private resolveVariables(node: WorkflowNode, userMessage: string, iteration?: number): WorkflowNode {
		const resolve = (s: string): string => {
			let result = s
				.replace(/\$USER_MESSAGE/g, userMessage)
				.replace(/\$ARTIFACTS_DIR\b/g, this.artifactsDir ?? "")
				.replace(/\$REJECTION_REASON\b/g, this.rejectionReason ?? "");
			if (iteration !== undefined) {
				result = result.replace(/\$ITERATION\b/g, String(iteration));
			}
			if (this.modelProfile) {
				result = result
					.replace(/\$MODEL_ID\b/g, this.modelProfile.id)
					.replace(/\$MODEL_NAME\b/g, this.modelProfile.name)
					.replace(/\$MODEL_SIZE\b/g, this.modelProfile.sizeClass)
					.replace(/\$MODEL_CONTEXT\b/g, String(this.modelProfile.contextWindow))
					.replace(/\$MODEL_VISION\b/g, String(this.modelProfile.supportsVision));
			}
			if (this.state) {
				for (const [id, output] of this.state.outputs) {
					const pattern = new RegExp(
						`\\$${escapeRegex(id)}\\.output(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)*`, "g"
					);
					result = result.replace(pattern, (match) => {
						const dotParts = match.slice(1).split(".");
						if (dotParts.length <= 2) return output;
						try {
							let obj: unknown = JSON.parse(output);
							for (let k = 2; k < dotParts.length; k++) {
								if (obj == null || typeof obj !== "object") return "";
								obj = (obj as Record<string, unknown>)[dotParts[k]];
							}
							return obj == null ? "" : String(obj);
						} catch {
							return "";
						}
					});
				}
			}
			return result;
		};

		switch (node.type) {
			case "prompt":
				return {
					...node,
					prompt: resolve(node.prompt),
					expected_artifacts: node.expected_artifacts?.map(p => {
						const r = resolve(p);
						return isAbsolute(r) ? r : join(this.cwd!, r);
					}),
				};
			case "bash":
				return { ...node, command: resolve(node.command) };
			case "approval":
				return { ...node, message: resolve(node.message) };
			case "loop":
				return {
					...node,
					prompt: resolve(node.prompt),
					expected_artifacts: node.expected_artifacts?.map(p => {
						const r = resolve(p);
						return isAbsolute(r) ? r : join(this.cwd!, r);
					}),
				};
			case "cancel":
				return { ...node, message: resolve(node.message) };
		}
	}

	private async writeWorkflowState(currentNodeId: string | null, userMessage: string): Promise<void> {
		if (!this.artifactsDir || !this.state) return;
		const state = {
			workflow: this.state.workflowName,
			completedNodes: [...this.completedNodes],
			skippedNodes: [...this.skippedNodes],
			resolvedArtifacts: Object.fromEntries(this.resolvedArtifacts),
			currentNode: currentNodeId,
			startedAt: new Date(this.state.startedAt).toISOString(),
			userMessage,
		};
		try {
			await writeFile(join(this.artifactsDir, "workflow-state.json"), JSON.stringify(state, null, 2));
		} catch {
			// best-effort; never abort a workflow for a state write failure
		}
	}

	// Per-run JSONL event log helper.
	// Logs to $ARTIFACTS_DIR/events.jsonl — filesystem-only, no PI runtime involvement.
	// Never throws — logging failure must not abort a workflow.
	private async logEvent(payload: Record<string, unknown>): Promise<void> {
		const dir = activeArtifactsDir ?? this.artifactsDir;
		if (!dir) return;
		const line = JSON.stringify({ ts: Date.now(), ...payload }) + "\n";
		try {
			await appendFile(join(dir, "events.jsonl"), line);
		} catch {
			// best-effort; never throw from logging
		}
	}

	/**
	 * Send a user message and wait for the agent to fully process it.
	 *
	 * The challenge: `pi.sendUserMessage` (used for the INITIAL ctx) is a
	 * fire-and-forget wrapper around the underlying async method (agent-session.js:
	 * 1715-1722 — `this.sendUserMessage(...).catch(err => emitError(...))`). It
	 * returns `void` synchronously before the agent picks up the queued message.
	 * If we call `waitForIdle()` right after, it sees the agent as idle (no
	 * streaming started yet) and returns immediately — so the workflow advances
	 * before the model has even seen the prompt. If the next node opens
	 * `newSession()`, the still-queued message gets discarded.
	 *
	 * The Promise-returning version exposed on ReplacedSessionContext (agent-
	 * session.js:2500) does NOT have this problem: awaiting it resolves only after
	 * the underlying async sendUserMessage returns.
	 *
	 * Handling:
	 * - ReplacedSessionContext: await the Promise version directly, then waitForIdle.
	 * - Initial ExtensionCommandContext: call pi.sendUserMessage (void), then
	 *   poll-spin until the agent flips out of idle (= streaming has started),
	 *   then waitForIdle for completion. Cap the poll at 3s — if the model never
	 *   starts after sendUserMessage, something else is broken and we should let
	 *   the workflow continue rather than hang here.
	 */
	private async sendAndWait(ctx: AnyCtx, content: string, options?: { deliverAs?: "steer" | "followUp" }): Promise<void> {
		if ("sendUserMessage" in ctx) {
			// ReplacedSessionContext — awaitable; the message is processed before this resolves.
			await (ctx as ReplacedSessionContext).sendUserMessage(content, options);
		} else {
			// Initial ExtensionCommandContext — fire-and-forget; poll for streaming to start.
			this.pi.sendUserMessage(content, options);
			const pollStart = Date.now();
			while ((Date.now() - pollStart) < 3000) {
				if (!ctx.isIdle()) break;
				await new Promise((r) => setTimeout(r, 20));
			}
		}
		await (ctx as ExtensionCommandContext).waitForIdle();
	}

	/**
	 * Send a workflow-status notification.
	 *
	 * ctx.ui is guarded by runner.assertActive() (runner.js:379-381), so it throws
	 * if the ctx's runner has been invalidated. This can happen when run() calls
	 * notify(initialCtx, "completed") after all nodes finished inside withSession
	 * callbacks — by that point initialCtx is stale. We guard the entire body with
	 * try/catch so that cosmetic completion messages never abort cleanup.
	 *
	 * For sendMessage routing:
	 * - ReplacedSessionContext has sendMessage as an own async method (agent-session.js:2499).
	 * - ExtensionCommandContext does not have sendMessage — use pi.sendMessage (synchronous).
	 *
	 * ctx.ui.notify is always tried first; pi/ctx.sendMessage is best-effort.
	 */
	private notify(ctx: AnyCtx, message: string, type?: string): void {
		try {
			ctx.ui.notify(message, type as "info" | "warning" | "error" | undefined);
		} catch {
			// ctx is stale — runner.assertActive() threw. Notification silently dropped.
		}
		try {
			if ("sendMessage" in ctx) {
				// ReplacedSessionContext: async sendMessage — fire and forget.
				(ctx as ReplacedSessionContext).sendMessage({
					customType: "workflow-status",
					content: message,
					display: true,
				}).catch(() => {
					// Ignore send errors during session transition.
				});
			} else {
				// Initial ExtensionCommandContext: synchronous pi.sendMessage.
				this.pi.sendMessage({
					customType: "workflow-status",
					content: message,
					display: true,
				});
			}
		} catch {
			// pi or ctx is stale — ui.notify attempt already made above.
		}
	}

	/**
	 * Arm the respond tool's capture flag. The __respond tool is registered once
	 * in the constructor; this method activates/deactivates the capture behavior.
	 * Returns a cleanup function that disarms and returns the captured message.
	 */
	private installRespondTool(): () => string | null {
		respondCaptured = null;
		respondActive = true;
		this.respondToolCaptured = null;
		this.respondToolActive = true;

		return () => {
			respondActive = false;
			this.respondToolActive = false;
			const result = respondCaptured;
			respondCaptured = null;
			this.respondToolCaptured = null;
			return result;
		};
	}

	/**
	 * Attempt to rescue a malformed tool call by stripping common wrappers.
	 *
	 * Handles 4 malformed formats:
	 * 1. JSON in code fence (```json ... ```)
	 * 2. Qwen <tool_call> XML wrapper
	 * 3. Partial JSON (missing closing braces) — returns null (no brace-counting repair)
	 * 4. Tool name outside JSON body
	 *
	 * Returns null on unrecoverable input — the retry mechanism handles it.
	 */
	private rescueToolCall(raw: string): { name: string; arguments: Record<string, unknown> } | null {
		// Strip code fences
		let cleaned = raw.replace(/```(?:json|tool_call)?\n?([\s\S]*?)```/g, "$1").trim();

		// Strip XML wrappers
		cleaned = cleaned.replace(/<\/?tool_call>/g, "").trim();

		// Try to extract JSON object
		const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return null;

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			if (parsed.name && parsed.arguments) {
				return { name: parsed.name, arguments: parsed.arguments };
			}
			return null;
		} catch {
			// JSON is genuinely malformed — do NOT attempt brace-counting repair.
			// Brace-counting on model output that contains code (e.g., a write tool
			// call whose content argument has braces) produces silently corrupt JSON.
			// Return null and let the retry mechanism (Task 1.3) re-prompt the model.
			return null;
		}
	}
}

class WorkflowCancelled extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkflowCancelled";
	}
}

class WorkflowFailed extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkflowFailed";
	}
}
