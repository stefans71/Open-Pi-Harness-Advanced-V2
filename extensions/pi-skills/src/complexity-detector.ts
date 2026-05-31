export interface ComplexitySignal {
	score: number;
	reasons: string[];
}

const MULTI_STEP_PATTERNS = [
	/\b(?:first|then|after that|next|finally|lastly|step \d)\b/i,
	/\b(?:and also|and then|as well as|in addition|additionally|plus)\b/i,
	/\b(?:both .+ and)\b/i,
];

const MULTI_VERB_PATTERNS = [
	/\b(?:refactor|rewrite|restructure)\b/i,
	/\b(?:test|write tests|add tests|verify)\b/i,
	/\b(?:review|check|analyze|audit)\b/i,
	/\b(?:deploy|push|release|publish)\b/i,
	/\b(?:document|add docs|update readme)\b/i,
	/\b(?:fix|debug|patch|resolve)\b/i,
	/\b(?:create|build|implement|add|scaffold)\b/i,
	/\b(?:migrate|upgrade|update|convert)\b/i,
];

const LIST_PATTERN = /(?:^|\n)\s*[-*\d.]+\s+\S/gm;

export class ComplexityDetector {
	private threshold = 0.5;

	detect(prompt: string): ComplexitySignal | null {
		const signal = this.analyze(prompt);
		return signal.score >= this.threshold ? signal : null;
	}

	private analyze(prompt: string): ComplexitySignal {
		let score = 0;
		const reasons: string[] = [];

		const sequenceMatches = MULTI_STEP_PATTERNS.filter((p) => p.test(prompt));
		if (sequenceMatches.length > 0) {
			score += 0.3;
			reasons.push("sequential steps detected");
		}

		const verbCategories = MULTI_VERB_PATTERNS.filter((p) => p.test(prompt));
		if (verbCategories.length >= 3) {
			score += 0.4;
			reasons.push(`${verbCategories.length} distinct task types`);
		} else if (verbCategories.length === 2) {
			score += 0.2;
			reasons.push("2 distinct task types");
		}

		const listItems = prompt.match(LIST_PATTERN);
		if (listItems && listItems.length >= 3) {
			score += 0.3;
			reasons.push(`${listItems.length}-item task list`);
		}

		const sentences = prompt.split(/[.!?\n]+/).filter((s) => s.trim().length > 10);
		if (sentences.length >= 5) {
			score += 0.1;
			reasons.push("long multi-sentence prompt");
		}

		return { score: Math.min(score, 1.0), reasons };
	}
}
