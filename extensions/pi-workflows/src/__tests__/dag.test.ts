import { describe, it, expect } from "vitest";
import { buildDag, evaluateCondition, ConditionParseError, resolveVariable } from "../dag.js";
import type { WorkflowNode } from "../schema.js";

function prompt(id: string, opts: Partial<WorkflowNode> = {}): WorkflowNode {
	return { id, type: "prompt", prompt: `do ${id}`, ...opts } as WorkflowNode;
}

function bash(id: string, opts: Partial<WorkflowNode> = {}): WorkflowNode {
	return { id, type: "bash", command: `echo ${id}`, ...opts } as WorkflowNode;
}

function approval(id: string, opts: Partial<WorkflowNode> = {}): WorkflowNode {
	return { id, type: "approval", message: `approve ${id}`, on_reject: "cancel", ...opts } as WorkflowNode;
}

// ============================================================================
// buildDag
// ============================================================================
describe("buildDag", () => {
	it("linear workflow (no depends_on) returns one step per node, serialized", () => {
		const nodes = [prompt("a"), bash("b"), approval("c")];
		const steps = buildDag(nodes);
		expect(steps).toHaveLength(3);
		for (const step of steps) {
			expect(step.nodes).toHaveLength(1);
			expect(step.executionMode).toBe("serialized");
		}
		expect(steps[0].nodes[0].id).toBe("a");
		expect(steps[1].nodes[0].id).toBe("b");
		expect(steps[2].nodes[0].id).toBe("c");
	});

	it("single node workflow returns one serialized step", () => {
		const steps = buildDag([prompt("only")]);
		expect(steps).toHaveLength(1);
		expect(steps[0].nodes[0].id).toBe("only");
		expect(steps[0].executionMode).toBe("serialized");
	});

	it("diamond DAG produces correct 3-layer grouping", () => {
		const nodes = [
			prompt("a"),
			prompt("b", { depends_on: ["a"] }),
			prompt("c", { depends_on: ["a"] }),
			prompt("d", { depends_on: ["b", "c"] }),
		];
		const steps = buildDag(nodes);

		expect(steps[0].nodes.map(n => n.id)).toEqual(["a"]);
		expect(steps[1].nodes.map(n => n.id).sort()).toEqual(["b", "c"]);
		expect(steps[2].nodes.map(n => n.id)).toEqual(["d"]);
	});

	it("chain with explicit depends_on produces 3 single-node layers", () => {
		const nodes = [
			prompt("a"),
			prompt("b", { depends_on: ["a"] }),
			prompt("c", { depends_on: ["b"] }),
		];
		const steps = buildDag(nodes);
		expect(steps).toHaveLength(3);
		expect(steps[0].nodes[0].id).toBe("a");
		expect(steps[1].nodes[0].id).toBe("b");
		expect(steps[2].nodes[0].id).toBe("c");
	});

	it("parallel bash nodes in same layer marked bash_parallel", () => {
		const nodes = [
			prompt("start"),
			bash("lint", { depends_on: ["start"] }),
			bash("test", { depends_on: ["start"] }),
		];
		const steps = buildDag(nodes);
		expect(steps).toHaveLength(2);
		expect(steps[1].executionMode).toBe("bash_parallel");
		expect(steps[1].nodes.map(n => n.id).sort()).toEqual(["lint", "test"]);
	});

	it("single bash node in layer uses serialized (not bash_parallel)", () => {
		const nodes = [
			prompt("start"),
			bash("only-bash", { depends_on: ["start"] }),
		];
		const steps = buildDag(nodes);
		expect(steps[1].executionMode).toBe("serialized");
	});

	it("mixed bash+prompt in same layer uses serialized", () => {
		const nodes = [
			prompt("start"),
			bash("lint", { depends_on: ["start"] }),
			prompt("review", { depends_on: ["start"] }),
		];
		const steps = buildDag(nodes);
		const layer2 = steps[1];
		expect(layer2.executionMode).toBe("serialized");
	});

	it("fresh_context node isolated into single-node step", () => {
		const nodes = [
			prompt("start"),
			prompt("fresh", { depends_on: ["start"], fresh_context: true }),
			prompt("normal", { depends_on: ["start"] }),
		];
		const steps = buildDag(nodes);
		const freshStep = steps.find(s => s.nodes.some(n => n.id === "fresh"));
		expect(freshStep).toBeDefined();
		expect(freshStep!.nodes).toHaveLength(1);
		expect(freshStep!.nodes[0].id).toBe("fresh");
	});

	it("fresh_context preserves YAML ordering within layer", () => {
		const nodes = [
			prompt("start"),
			prompt("fresh", { depends_on: ["start"], fresh_context: true }),
			prompt("normal", { depends_on: ["start"] }),
		];
		const steps = buildDag(nodes);
		// Layer 2 has [fresh, normal] in YAML order.
		// fresh should come first (as its own step), then normal.
		const layer2Steps = steps.slice(1);
		expect(layer2Steps).toHaveLength(2);
		expect(layer2Steps[0].nodes[0].id).toBe("fresh");
		expect(layer2Steps[1].nodes[0].id).toBe("normal");
	});

	it("mixed fresh and non-fresh preserves interleaved YAML order", () => {
		const nodes = [
			prompt("start"),
			prompt("a", { depends_on: ["start"] }),
			prompt("b-fresh", { depends_on: ["start"], fresh_context: true }),
			prompt("c", { depends_on: ["start"] }),
		];
		const steps = buildDag(nodes);
		// Layer 2: [a, b-fresh, c] → step([a]), step([b-fresh]), step([c])
		const layer2Steps = steps.slice(1);
		expect(layer2Steps).toHaveLength(3);
		expect(layer2Steps[0].nodes.map(n => n.id)).toEqual(["a"]);
		expect(layer2Steps[1].nodes.map(n => n.id)).toEqual(["b-fresh"]);
		expect(layer2Steps[2].nodes.map(n => n.id)).toEqual(["c"]);
	});

	it("cycle detection throws with involved node IDs", () => {
		const nodes = [
			prompt("a", { depends_on: ["c"] }),
			prompt("b", { depends_on: ["a"] }),
			prompt("c", { depends_on: ["b"] }),
		];
		expect(() => buildDag(nodes)).toThrow(/cycle/i);
		expect(() => buildDag(nodes)).toThrow(/a/);
		expect(() => buildDag(nodes)).toThrow(/b/);
		expect(() => buildDag(nodes)).toThrow(/c/);
	});

	it("multiple roots grouped in one layer", () => {
		const nodes = [
			prompt("a"),
			prompt("b"),
			prompt("c"),
			prompt("d", { depends_on: ["a", "b", "c"] }),
		];
		const steps = buildDag(nodes);
		expect(steps[0].nodes.map(n => n.id).sort()).toEqual(["a", "b", "c"]);
		expect(steps[1].nodes[0].id).toBe("d");
	});

	it("deterministic ordering — sorted by YAML index within layers", () => {
		const nodes = [
			prompt("z"),
			prompt("a"),
			prompt("m"),
			prompt("end", { depends_on: ["z", "a", "m"] }),
		];
		const steps = buildDag(nodes);
		expect(steps[0].nodes.map(n => n.id)).toEqual(["z", "a", "m"]);
	});

	it("complex 6-node DAG", () => {
		const nodes = [
			prompt("a"),
			prompt("b"),
			prompt("c", { depends_on: ["a"] }),
			prompt("d", { depends_on: ["a", "b"] }),
			prompt("e", { depends_on: ["c"] }),
			prompt("f", { depends_on: ["d", "e"] }),
		];
		const steps = buildDag(nodes);

		expect(steps[0].nodes.map(n => n.id).sort()).toEqual(["a", "b"]);
		expect(steps[1].nodes.map(n => n.id).sort()).toEqual(["c", "d"]);
		expect(steps[2].nodes.map(n => n.id)).toEqual(["e"]);
		expect(steps[3].nodes.map(n => n.id)).toEqual(["f"]);
	});
});

// ============================================================================
// evaluateCondition
// ============================================================================
describe("evaluateCondition", () => {
	it("simple string equality — true", () => {
		const outputs = new Map([["a", "hello"]]);
		expect(evaluateCondition("$a.output == 'hello'", outputs)).toBe(true);
	});

	it("simple string equality — false", () => {
		const outputs = new Map([["a", "hello"]]);
		expect(evaluateCondition("$a.output == 'world'", outputs)).toBe(false);
	});

	it("string inequality — true", () => {
		const outputs = new Map([["a", "hello"]]);
		expect(evaluateCondition("$a.output != 'world'", outputs)).toBe(true);
	});

	it("string inequality — false", () => {
		const outputs = new Map([["a", "hello"]]);
		expect(evaluateCondition("$a.output != 'hello'", outputs)).toBe(false);
	});

	it("contains operator — true", () => {
		const outputs = new Map([["a", "found a bug here"]]);
		expect(evaluateCondition("$a.output contains 'bug'", outputs)).toBe(true);
	});

	it("contains operator — false", () => {
		const outputs = new Map([["a", "all good"]]);
		expect(evaluateCondition("$a.output contains 'bug'", outputs)).toBe(false);
	});

	it("numeric equality", () => {
		const outputs = new Map([["a", '{"count": 42}']]);
		expect(evaluateCondition("$a.output.count == 42", outputs)).toBe(true);
	});

	it("boolean literal", () => {
		const outputs = new Map([["a", '{"ready": true}']]);
		expect(evaluateCondition("$a.output.ready == true", outputs)).toBe(true);
	});

	it("AND operator — both true", () => {
		const outputs = new Map([["a", "x"], ["b", "y"]]);
		expect(evaluateCondition("$a.output == 'x' AND $b.output == 'y'", outputs)).toBe(true);
	});

	it("AND operator — one false", () => {
		const outputs = new Map([["a", "x"], ["b", "z"]]);
		expect(evaluateCondition("$a.output == 'x' AND $b.output == 'y'", outputs)).toBe(false);
	});

	it("OR operator — one true", () => {
		const outputs = new Map([["a", "x"], ["b", "z"]]);
		expect(evaluateCondition("$a.output == 'x' OR $b.output == 'y'", outputs)).toBe(true);
	});

	it("OR operator — both false", () => {
		const outputs = new Map([["a", "q"], ["b", "z"]]);
		expect(evaluateCondition("$a.output == 'x' OR $b.output == 'y'", outputs)).toBe(false);
	});

	it("AND binds tighter than OR", () => {
		// a == 'x' OR b == 'y' AND c == 'z' => OR(a=='x', AND(b=='y', c=='z'))
		// a = 'q' (false), b = 'y' (true), c = 'z' (true)
		// => OR(false, AND(true, true)) => OR(false, true) => true
		const outputs = new Map([["a", "q"], ["b", "y"], ["c", "z"]]);
		expect(evaluateCondition("$a.output == 'q' OR $b.output == 'y' AND $c.output == 'z'", outputs)).toBe(true);

		// Now verify AND binding: if OR had bound tighter, this would differ
		// a = 'x' (true), b = 'y' (true), c = 'w' (false)
		// With AND>OR: OR(a=='x', AND(b=='y', c=='w')) => OR(true, false) => true
		// With OR>AND: AND(OR(a=='x', b=='y'), c=='w') => AND(true, false) => false
		const outputs2 = new Map([["a", "x"], ["b", "y"], ["c", "w"]]);
		expect(evaluateCondition("$a.output == 'x' OR $b.output == 'y' AND $c.output == 'w'", outputs2)).toBe(true);
	});

	it("dot-notation field access into JSON", () => {
		const outputs = new Map([["classify", '{"type": "bug", "severity": "high"}']]);
		expect(evaluateCondition("$classify.output.type == 'bug'", outputs)).toBe(true);
		expect(evaluateCondition("$classify.output.severity == 'high'", outputs)).toBe(true);
	});

	it("nested dot-notation", () => {
		const outputs = new Map([["a", '{"data": {"count": 5}}']]);
		expect(evaluateCondition("$a.output.data.count == 5", outputs)).toBe(true);
	});

	it("missing variable returns false (not error)", () => {
		const outputs = new Map<string, string>();
		expect(evaluateCondition("$nonexistent.output == 'x'", outputs)).toBe(false);
	});

	it("missing JSON field returns false", () => {
		const outputs = new Map([["a", '{"type": "bug"}']]);
		expect(evaluateCondition("$a.output.nosuchfield == 'x'", outputs)).toBe(false);
	});

	it("non-JSON output with dot-notation returns false", () => {
		const outputs = new Map([["a", "just plain text"]]);
		expect(evaluateCondition("$a.output.field == 'x'", outputs)).toBe(false);
	});

	it("malformed JSON with dot-notation returns false (no throw)", () => {
		const outputs = new Map([["a", "not { valid json"]]);
		expect(evaluateCondition("$a.output.field == 'x'", outputs)).toBe(false);
	});

	it("undefined != anything returns false", () => {
		const outputs = new Map<string, string>();
		expect(evaluateCondition("$skipped.output != 'x'", outputs)).toBe(false);
	});

	it("no type coercion — string vs number is false", () => {
		const outputs = new Map([["a", "42"]]);
		expect(evaluateCondition("$a.output == 42", outputs)).toBe(false);
	});

	it("contains with non-string left returns false", () => {
		const outputs = new Map([["a", '{"num": 42}']]);
		expect(evaluateCondition("$a.output.num contains '4'", outputs)).toBe(false);
	});

	it("node IDs with hyphens", () => {
		const outputs = new Map([["gate-prd", "approved"]]);
		expect(evaluateCondition("$gate-prd.output == 'approved'", outputs)).toBe(true);
	});

	it("multiple AND", () => {
		const outputs = new Map([["a", "x"], ["b", "y"], ["c", "z"]]);
		expect(evaluateCondition("$a.output == 'x' AND $b.output == 'y' AND $c.output == 'z'", outputs)).toBe(true);
	});

	it("multiple OR", () => {
		const outputs = new Map([["a", "q"], ["b", "q"], ["c", "z"]]);
		expect(evaluateCondition("$a.output == 'x' OR $b.output == 'y' OR $c.output == 'z'", outputs)).toBe(true);
	});

	it("empty string equality", () => {
		const outputs = new Map([["a", ""]]);
		expect(evaluateCondition("$a.output == ''", outputs)).toBe(true);
	});

	// -- Parse errors --

	it("parse error — invalid operator", () => {
		expect(() => evaluateCondition("$a.output > 5", new Map([["a", "5"]]))).toThrow(ConditionParseError);
	});

	it("parse error — unclosed string", () => {
		expect(() => evaluateCondition("$a.output == 'hello", new Map())).toThrow(ConditionParseError);
		expect(() => evaluateCondition("$a.output == 'hello", new Map())).toThrow(/unterminated/);
	});

	it("parse error — missing operand", () => {
		expect(() => evaluateCondition("$a.output ==", new Map())).toThrow(ConditionParseError);
	});

	it("parse error — bare text", () => {
		expect(() => evaluateCondition("just some words", new Map())).toThrow(ConditionParseError);
	});

	it("parse error — variable without .output segment", () => {
		expect(() => evaluateCondition("$a.foo == 'x'", new Map())).toThrow(ConditionParseError);
		expect(() => evaluateCondition("$a.foo == 'x'", new Map())).toThrow(/\$nodeId\.output/);
	});

	it("parse error — variable with only node ID (no dot path)", () => {
		expect(() => evaluateCondition("$a == 'x'", new Map())).toThrow(ConditionParseError);
	});

	it("parse error has correct position", () => {
		try {
			evaluateCondition("$a.output == 'x' AND $b.output !! 'y'", new Map());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ConditionParseError);
			expect((err as ConditionParseError).position).toBe(31);
		}
	});
});

// ============================================================================
// resolveVariable
// ============================================================================
describe("resolveVariable", () => {
	it("returns raw string for simple $nodeId.output", () => {
		const outputs = new Map([["a", "hello world"]]);
		expect(resolveVariable(["a", "output"], outputs)).toBe("hello world");
	});

	it("returns undefined for missing node", () => {
		const outputs = new Map<string, string>();
		expect(resolveVariable(["missing", "output"], outputs)).toBe(undefined);
	});

	it("traverses JSON for dot-notation", () => {
		const outputs = new Map([["a", '{"type": "bug"}']]);
		expect(resolveVariable(["a", "output", "type"], outputs)).toBe("bug");
	});

	it("returns undefined for non-JSON with dot-notation", () => {
		const outputs = new Map([["a", "plain text"]]);
		expect(resolveVariable(["a", "output", "field"], outputs)).toBe(undefined);
	});

	it("returns undefined for missing nested field", () => {
		const outputs = new Map([["a", '{"type": "bug"}']]);
		expect(resolveVariable(["a", "output", "missing", "deep"], outputs)).toBe(undefined);
	});

	it("returns undefined when path[1] is not 'output'", () => {
		const outputs = new Map([["a", "hello"]]);
		expect(resolveVariable(["a", "foo"], outputs)).toBe(undefined);
	});

	it("returns undefined for single-element path", () => {
		const outputs = new Map([["a", "hello"]]);
		expect(resolveVariable(["a"], outputs)).toBe(undefined);
	});
});
