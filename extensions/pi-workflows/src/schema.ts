export interface WorkflowDefinition {
	name: string;
	description?: string;
	nodes: WorkflowNode[];
}

export type WorkflowNode = PromptNode | BashNode | ApprovalNode | LoopNode | CancelNode;

export interface PromptNode {
	id: string;
	type: "prompt";
	prompt: string;
	allowed_tools?: string[];
	fresh_context?: boolean;
	expected_artifacts?: string[];
	output_format?: Record<string, unknown>;
	depends_on?: string[];
	when?: string;
}

export interface BashNode {
	id: string;
	type: "bash";
	command: string;
	timeout?: number;
	allow_failure?: boolean;
	depends_on?: string[];
	when?: string;
}

export interface ApprovalNode {
	id: string;
	type: "approval";
	message: string;
	capture_response?: boolean;
	on_reject?: "cancel" | "rollback" | "continue";
	depends_on?: string[];
	when?: string;
}

export interface LoopNode {
	id: string;
	type: "loop";
	prompt: string;
	max_iterations: number;
	until?: string;
	fresh_context?: boolean;
	allowed_tools?: string[];
	expected_artifacts?: string[];
	depends_on?: string[];
	when?: string;
}

export interface CancelNode {
	id: string;
	type: "cancel";
	message: string;
	depends_on?: string[];
	when?: string;
}

export interface WorkflowState {
	workflowName: string;
	currentNodeIndex: number;
	totalNodes: number;
	outputs: Map<string, string>;
	startedAt: number;
	status: "running" | "completed" | "failed" | "cancelled";
}

export function validateWorkflow(raw: unknown): WorkflowDefinition {
	if (!raw || typeof raw !== "object") throw new Error("Workflow must be an object");
	const obj = raw as Record<string, unknown>;

	if (typeof obj.name !== "string" || !obj.name) throw new Error("Workflow must have a 'name' string");
	if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) throw new Error("Workflow must have at least one node");

	const seenIds = new Set<string>();
	const nodes: WorkflowNode[] = obj.nodes.map((n: unknown, i: number) => {
		if (!n || typeof n !== "object") throw new Error(`Node ${i} must be an object`);
		const node = n as Record<string, unknown>;

		if (typeof node.id !== "string" || !node.id) throw new Error(`Node ${i} must have an 'id' string`);
		if (seenIds.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
		seenIds.add(node.id);

		const rawDeps = Array.isArray(node.depends_on) ? node.depends_on.map(String) : undefined;
		const depends_on = rawDeps?.length ? rawDeps : undefined;
		if (typeof node.when === "string" && node.when.trim() === "") {
			throw new Error(`Node '${node.id}': 'when' must be a non-empty condition expression`);
		}
		const when = typeof node.when === "string" ? node.when : undefined;

		switch (node.type) {
			case "prompt":
				if (typeof node.prompt !== "string" || !node.prompt)
					throw new Error(`Node ${node.id}: prompt nodes need a 'prompt' string`);
				return {
					id: node.id,
					type: "prompt" as const,
					prompt: node.prompt,
					allowed_tools: Array.isArray(node.allowed_tools) ? node.allowed_tools.map(String) : undefined,
					fresh_context: node.fresh_context === true,
					expected_artifacts: Array.isArray(node.expected_artifacts) ? node.expected_artifacts.map(String) : undefined,
					output_format: (typeof node.output_format === "object" && node.output_format !== null)
						? node.output_format as Record<string, unknown>
						: undefined,
					depends_on,
					when,
				};
			case "bash":
				if (typeof node.command !== "string" || !node.command)
					throw new Error(`Node ${node.id}: bash nodes need a 'command' string`);
				return {
					id: node.id,
					type: "bash" as const,
					command: node.command,
					timeout: typeof node.timeout === "number" ? node.timeout : undefined,
					allow_failure: typeof node.allow_failure === "boolean" ? node.allow_failure : false,
					depends_on,
					when,
				};
			case "approval": {
				if (typeof node.message !== "string" || !node.message)
					throw new Error(`Node ${node.id}: approval nodes need a 'message' string`);
				const onReject = node.on_reject;
				if (onReject !== undefined && !["cancel", "rollback", "continue"].includes(String(onReject))) {
					throw new Error(`Node ${node.id}: on_reject must be one of cancel|rollback|continue`);
				}
				return {
					id: node.id,
					type: "approval" as const,
					message: node.message,
					capture_response: node.capture_response === true,
					on_reject: (onReject as "cancel" | "rollback" | "continue" | undefined) ?? "cancel",
					depends_on,
					when,
				};
			}
			case "loop": {
				if (typeof node.prompt !== "string" || !node.prompt)
					throw new Error(`Node ${node.id}: loop nodes need a 'prompt' string`);
				if (typeof node.max_iterations !== "number" || node.max_iterations < 1)
					throw new Error(`Node ${node.id}: loop nodes need a 'max_iterations' number >= 1`);
				return {
					id: node.id,
					type: "loop" as const,
					prompt: node.prompt,
					max_iterations: node.max_iterations,
					until: typeof node.until === "string" ? node.until : undefined,
					fresh_context: node.fresh_context === true,
					allowed_tools: Array.isArray(node.allowed_tools) ? node.allowed_tools.map(String) : undefined,
					expected_artifacts: Array.isArray(node.expected_artifacts) ? node.expected_artifacts.map(String) : undefined,
					depends_on,
					when,
				};
			}
			case "cancel":
				if (typeof node.message !== "string" || !node.message)
					throw new Error(`Node ${node.id}: cancel nodes need a 'message' string`);
				return {
					id: node.id,
					type: "cancel" as const,
					message: node.message,
					depends_on,
					when,
				};
			default:
				throw new Error(`Node ${node.id}: unknown type '${node.type}' (expected: prompt, bash, approval, loop, cancel)`);
		}
	});

	for (const node of nodes) {
		if (node.depends_on) {
			for (const depId of node.depends_on) {
				if (!seenIds.has(depId)) {
					throw new Error(`Node '${node.id}': depends_on references unknown node '${depId}'`);
				}
			}
		}
	}

	return {
		name: obj.name,
		description: typeof obj.description === "string" ? obj.description : undefined,
		nodes,
	};
}
