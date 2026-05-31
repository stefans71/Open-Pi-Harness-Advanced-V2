import type { SkillDefinition } from "./skill-scanner.js";

interface MatchResult extends SkillDefinition {
	confidence: number;
}

export class TriggerMatcher {
	private minConfidence = 0.5;

	match(prompt: string, skills: Map<string, SkillDefinition>): MatchResult[] {
		const lower = prompt.toLowerCase();
		const results: MatchResult[] = [];

		for (const skill of skills.values()) {
			const confidence = this.score(lower, skill);
			if (confidence >= this.minConfidence) {
				results.push({ ...skill, confidence });
			}
		}

		return results.sort((a, b) => b.confidence - a.confidence);
	}

	private score(prompt: string, skill: SkillDefinition): number {
		let maxScore = 0;

		for (const trigger of skill.triggers) {
			const triggerLower = trigger.toLowerCase();

			// Exact phrase match
			if (prompt.includes(triggerLower)) {
				const phraseScore = 0.7 + 0.3 * (triggerLower.length / prompt.length);
				maxScore = Math.max(maxScore, Math.min(phraseScore, 1.0));
				continue;
			}

			// Word-boundary match (all trigger words present)
			const triggerWords = triggerLower.split(/\s+/);
			const promptWords = new Set(prompt.split(/\s+/));
			const matched = triggerWords.filter((w) => promptWords.has(w));
			if (matched.length === triggerWords.length) {
				maxScore = Math.max(maxScore, 0.6);
			} else if (matched.length > 0) {
				const partialScore = 0.3 * (matched.length / triggerWords.length);
				maxScore = Math.max(maxScore, partialScore);
			}
		}

		return maxScore;
	}
}
