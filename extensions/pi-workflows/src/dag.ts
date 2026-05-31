import type { WorkflowNode } from "./schema.js";

export interface DagStep {
	nodes: WorkflowNode[];
	executionMode: "serialized" | "bash_parallel";
}

export function buildDag(nodes: WorkflowNode[]): DagStep[] {
	const hasDeps = nodes.some(n => n.depends_on?.length);
	if (!hasDeps) {
		return nodes.map(n => ({ nodes: [n], executionMode: "serialized" as const }));
	}

	const nodeMap = new Map<string, WorkflowNode>();
	const indexMap = new Map<string, number>();
	const inDegree = new Map<string, number>();
	const adjacency = new Map<string, string[]>();

	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		nodeMap.set(n.id, n);
		indexMap.set(n.id, i);
		inDegree.set(n.id, 0);
		adjacency.set(n.id, []);
	}

	for (const n of nodes) {
		if (n.depends_on) {
			inDegree.set(n.id, n.depends_on.length);
			for (const depId of n.depends_on) {
				adjacency.get(depId)!.push(n.id);
			}
		}
	}

	const layers: WorkflowNode[][] = [];
	let queue = nodes.filter(n => inDegree.get(n.id) === 0);
	let processed = 0;

	while (queue.length > 0) {
		queue.sort((a, b) => indexMap.get(a.id)! - indexMap.get(b.id)!);
		layers.push(queue);
		processed += queue.length;

		const next: WorkflowNode[] = [];
		for (const n of queue) {
			for (const depId of adjacency.get(n.id)!) {
				const deg = inDegree.get(depId)! - 1;
				inDegree.set(depId, deg);
				if (deg === 0) {
					next.push(nodeMap.get(depId)!);
				}
			}
		}
		queue = next;
	}

	if (processed < nodes.length) {
		const cycleNodes = nodes.filter(n => inDegree.get(n.id)! > 0).map(n => n.id);
		throw new Error(`Dependency cycle detected among nodes: ${cycleNodes.join(", ")}`);
	}

	const steps: DagStep[] = [];
	for (const layer of layers) {
		let accumulated: WorkflowNode[] = [];

		const flushAccumulated = () => {
			if (accumulated.length === 0) return;
			const allBash = accumulated.every(n => n.type === "bash");
			steps.push({
				nodes: accumulated,
				executionMode: allBash && accumulated.length > 1 ? "bash_parallel" : "serialized",
			});
			accumulated = [];
		};

		for (const node of layer) {
			if ((node as { fresh_context?: boolean }).fresh_context === true) {
				flushAccumulated();
				steps.push({ nodes: [node], executionMode: "serialized" });
			} else {
				accumulated.push(node);
			}
		}
		flushAccumulated();
	}

	return steps;
}

// --- Condition Evaluator ---

export class ConditionParseError extends Error {
	constructor(
		public readonly expr: string,
		public readonly position: number,
		message: string,
	) {
		super(`Condition parse error at position ${position} in "${expr}": ${message}`);
		this.name = "ConditionParseError";
	}
}

interface Token {
	type: "VARIABLE" | "STRING" | "NUMBER" | "BOOLEAN" | "OPERATOR" | "LOGIC" | "EOF";
	value: string;
	position: number;
}

type Operand =
	| { type: "variable"; path: string[] }
	| { type: "string"; value: string }
	| { type: "number"; value: number }
	| { type: "boolean"; value: boolean };

type ASTNode =
	| { type: "comparison"; left: Operand; op: string; right: Operand }
	| { type: "and"; children: ASTNode[] }
	| { type: "or"; children: ASTNode[] };

function tokenize(expr: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < expr.length) {
		if (/\s/.test(expr[i])) { i++; continue; }

		if (expr[i] === "$") {
			const start = i;
			i++;
			if (i >= expr.length || !/[a-zA-Z_]/.test(expr[i])) {
				throw new ConditionParseError(expr, start, "expected identifier after '$'");
			}
			while (i < expr.length && /[a-zA-Z0-9_-]/.test(expr[i])) i++;
			while (i < expr.length && expr[i] === ".") {
				i++;
				const fieldStart = i;
				while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) i++;
				if (i === fieldStart) {
					throw new ConditionParseError(expr, fieldStart, "expected field name after '.'");
				}
			}
			tokens.push({ type: "VARIABLE", value: expr.slice(start, i), position: start });
			continue;
		}

		if (expr[i] === "'") {
			const start = i;
			i++;
			const strStart = i;
			while (i < expr.length && expr[i] !== "'") i++;
			if (i >= expr.length) {
				throw new ConditionParseError(expr, start, "unterminated string literal");
			}
			tokens.push({ type: "STRING", value: expr.slice(strStart, i), position: start });
			i++;
			continue;
		}

		if (/[0-9]/.test(expr[i])) {
			const start = i;
			while (i < expr.length && /[0-9]/.test(expr[i])) i++;
			if (i < expr.length && expr[i] === ".") {
				i++;
				while (i < expr.length && /[0-9]/.test(expr[i])) i++;
			}
			tokens.push({ type: "NUMBER", value: expr.slice(start, i), position: start });
			continue;
		}

		if (expr.slice(i, i + 2) === "==" || expr.slice(i, i + 2) === "!=") {
			tokens.push({ type: "OPERATOR", value: expr.slice(i, i + 2), position: i });
			i += 2;
			continue;
		}

		if (expr.slice(i, i + 8) === "contains") {
			const after = i + 8;
			if (after >= expr.length || /[\s$'0-9]/.test(expr[after])) {
				tokens.push({ type: "OPERATOR", value: "contains", position: i });
				i = after;
				continue;
			}
		}

		if (expr.slice(i, i + 3) === "AND") {
			const after = i + 3;
			if (after >= expr.length || /\s/.test(expr[after])) {
				tokens.push({ type: "LOGIC", value: "AND", position: i });
				i = after;
				continue;
			}
		}

		if (expr.slice(i, i + 2) === "OR") {
			const after = i + 2;
			if (after >= expr.length || /\s/.test(expr[after])) {
				tokens.push({ type: "LOGIC", value: "OR", position: i });
				i = after;
				continue;
			}
		}

		if (expr.slice(i, i + 4) === "true") {
			const after = i + 4;
			if (after >= expr.length || /[\s)$'=!]/.test(expr[after])) {
				tokens.push({ type: "BOOLEAN", value: "true", position: i });
				i = after;
				continue;
			}
		}

		if (expr.slice(i, i + 5) === "false") {
			const after = i + 5;
			if (after >= expr.length || /[\s)$'=!]/.test(expr[after])) {
				tokens.push({ type: "BOOLEAN", value: "false", position: i });
				i = after;
				continue;
			}
		}

		throw new ConditionParseError(expr, i, `unexpected character '${expr[i]}'`);
	}

	tokens.push({ type: "EOF", value: "", position: expr.length });
	return tokens;
}

class Parser {
	private pos = 0;
	constructor(private tokens: Token[], private expr: string) {}

	parse(): ASTNode {
		const ast = this.parseOr();
		if (this.tokens[this.pos].type !== "EOF") {
			const t = this.tokens[this.pos];
			throw new ConditionParseError(this.expr, t.position, `unexpected token '${t.value}'`);
		}
		return ast;
	}

	private parseOr(): ASTNode {
		const children: ASTNode[] = [this.parseAnd()];
		while (this.tokens[this.pos].type === "LOGIC" && this.tokens[this.pos].value === "OR") {
			this.pos++;
			children.push(this.parseAnd());
		}
		return children.length === 1 ? children[0] : { type: "or", children };
	}

	private parseAnd(): ASTNode {
		const children: ASTNode[] = [this.parseComparison()];
		while (this.tokens[this.pos].type === "LOGIC" && this.tokens[this.pos].value === "AND") {
			this.pos++;
			children.push(this.parseComparison());
		}
		return children.length === 1 ? children[0] : { type: "and", children };
	}

	private parseComparison(): ASTNode {
		const left = this.parseOperand();
		const opToken = this.tokens[this.pos];
		if (opToken.type !== "OPERATOR") {
			throw new ConditionParseError(this.expr, opToken.position, `expected operator (==, !=, contains), got '${opToken.value}'`);
		}
		this.pos++;
		const right = this.parseOperand();
		return { type: "comparison", left, op: opToken.value, right };
	}

	private parseOperand(): Operand {
		const t = this.tokens[this.pos];
		switch (t.type) {
			case "VARIABLE": {
				this.pos++;
				const raw = t.value.slice(1); // remove leading $
				const parts = raw.split(".");
				if (parts.length < 2 || parts[1] !== "output") {
					throw new ConditionParseError(this.expr, t.position,
						`variable must use '$nodeId.output' format, got '${t.value}'`);
				}
				return { type: "variable", path: parts };
			}
			case "STRING":
				this.pos++;
				return { type: "string", value: t.value };
			case "NUMBER":
				this.pos++;
				return { type: "number", value: Number(t.value) };
			case "BOOLEAN":
				this.pos++;
				return { type: "boolean", value: t.value === "true" };
			default:
				throw new ConditionParseError(this.expr, t.position, `expected operand, got '${t.value}'`);
		}
	}
}

export function resolveVariable(
	path: string[],
	outputs: Map<string, string>,
): unknown {
	if (path.length < 2 || path[1] !== "output") return undefined;
	const nodeId = path[0];
	const raw = outputs.get(nodeId);
	if (raw === undefined) return undefined;
	if (path.length <= 2) return raw;
	try {
		let obj: unknown = JSON.parse(raw);
		for (let i = 2; i < path.length; i++) {
			if (obj == null || typeof obj !== "object") return undefined;
			obj = (obj as Record<string, unknown>)[path[i]];
		}
		return obj ?? undefined;
	} catch {
		return undefined;
	}
}

function resolveOperand(operand: Operand, outputs: Map<string, string>): unknown {
	switch (operand.type) {
		case "variable":
			return resolveVariable(operand.path, outputs);
		case "string":
			return operand.value;
		case "number":
			return operand.value;
		case "boolean":
			return operand.value;
	}
}

function evaluateAST(node: ASTNode, outputs: Map<string, string>): boolean {
	switch (node.type) {
		case "or":
			return node.children.some(c => evaluateAST(c, outputs));
		case "and":
			return node.children.every(c => evaluateAST(c, outputs));
		case "comparison": {
			const left = resolveOperand(node.left, outputs);
			const right = resolveOperand(node.right, outputs);

			if (left === undefined || right === undefined) return false;

			switch (node.op) {
				case "==":
					if (typeof left !== typeof right) return false;
					return left === right;
				case "!=":
					if (typeof left !== typeof right) return false;
					return left !== right;
				case "contains":
					if (typeof left !== "string" || typeof right !== "string") return false;
					return left.includes(right);
				default:
					return false;
			}
		}
	}
}

export function evaluateCondition(
	expr: string,
	outputs: Map<string, string>,
): boolean {
	const tokens = tokenize(expr);
	const parser = new Parser(tokens, expr);
	const ast = parser.parse();
	return evaluateAST(ast, outputs);
}
