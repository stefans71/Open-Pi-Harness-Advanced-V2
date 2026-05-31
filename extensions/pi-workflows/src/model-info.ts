export interface ModelProfile {
	id: string;
	name: string;
	contextWindow: number;
	supportsVision: boolean;
	supportsReasoning: boolean;
	sizeClass: "small" | "medium" | "large" | "unknown";
}

function inferSizeClass(text: string): ModelProfile["sizeClass"] {
	const match = text.match(/\b(\d+(?:\.\d+)?)\s*b\b/i);
	if (!match) return "unknown";
	const billions = parseFloat(match[1]);
	if (billions < 9) return "small";
	if (billions <= 35) return "medium";
	return "large";
}

export function getModelProfile(model?: {
	id?: string;
	name?: string;
	contextWindow?: number;
	input?: string[];
	reasoning?: boolean;
}): ModelProfile {
	if (!model) {
		return {
			id: "unknown",
			name: "Unknown Model",
			contextWindow: 0,
			supportsVision: false,
			supportsReasoning: false,
			sizeClass: "unknown",
		};
	}

	const idAndName = `${model.id ?? ""} ${model.name ?? ""}`;
	const sizeClass = inferSizeClass(idAndName);

	return {
		id: model.id ?? "unknown",
		name: model.name ?? model.id ?? "Unknown Model",
		contextWindow: model.contextWindow ?? 0,
		supportsVision: Array.isArray(model.input) && model.input.includes("image"),
		supportsReasoning: model.reasoning ?? false,
		sizeClass,
	};
}
