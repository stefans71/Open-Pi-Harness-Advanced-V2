import { describe, it, expect, beforeEach, vi } from "vitest";

describe("session-replacement lifecycle", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("only registers one workflow:completed listener across multiple factory calls", async () => {
		const { default: factory } = await import("../src/index.js");

		const listeners: Array<(data: unknown) => void> = [];
		const mockPi = createMockPi(listeners);

		factory(mockPi);
		factory(mockPi);
		factory(mockPi);

		expect(listeners).toHaveLength(1);
	});

	it("uses the latest session's scanner and callback after session replacement", async () => {
		const { default: factory } = await import("../src/index.js");

		const listeners: Array<(data: unknown) => void> = [];

		const mockPi1 = createMockPi(listeners);
		factory(mockPi1);

		const mockPi2 = createMockPi(listeners);
		factory(mockPi2);

		expect(listeners).toHaveLength(1);

		const sessionStartHandlers = mockPi2._sessionStartHandlers;
		expect(sessionStartHandlers.length).toBeGreaterThan(0);

		await sessionStartHandlers[sessionStartHandlers.length - 1]();

		const skillsCommand = mockPi2._commands.get("skills");
		expect(skillsCommand).toBeDefined();
	});
});

function createMockPi(sharedListeners: Array<(data: unknown) => void>) {
	const sessionStartHandlers: Array<() => Promise<void>> = [];
	const commands = new Map<string, unknown>();

	return {
		events: {
			on: (_event: string, handler: (data: unknown) => void) => {
				sharedListeners.push(handler);
			},
		},
		on: (event: string, handler: (...args: unknown[]) => unknown) => {
			if (event === "session_start") {
				sessionStartHandlers.push(handler as () => Promise<void>);
			}
		},
		setThinkingLevel: vi.fn(),
		sendMessage: vi.fn(),
		registerCommand: (name: string, config: unknown) => {
			commands.set(name, config);
		},
		_sessionStartHandlers: sessionStartHandlers,
		_commands: commands,
	} as unknown as import("@mariozechner/pi-coding-agent").ExtensionAPI;
}
