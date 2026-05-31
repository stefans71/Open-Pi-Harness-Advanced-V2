const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://localhost:11434/v1";
const LLM_MODEL = process.env.LLM_MODEL || "qwen3.6-27b-mtp";

interface LlmGenerateOptions {
	maxTokens?: number;
	temperature?: number;
}

interface ChatCompletionResponse {
	choices: Array<{
		message: { content: string };
	}>;
}

export async function llmGenerate(
	prompt: string,
	options: LlmGenerateOptions = {},
): Promise<string> {
	const body = {
		model: LLM_MODEL,
		messages: [{ role: "user", content: prompt }],
		max_tokens: options.maxTokens ?? 2000,
		temperature: options.temperature ?? 0.7,
		stream: false,
		chat_template_kwargs: { enable_thinking: false },
	};

	const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		throw new Error(`LLM generate failed: ${res.status} ${res.statusText}`);
	}

	const data = (await res.json()) as ChatCompletionResponse;
	return data.choices[0]?.message?.content ?? "";
}
