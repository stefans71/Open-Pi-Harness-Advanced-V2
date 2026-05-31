import { beforeEach, describe, expect, it } from "vitest";
import { ComplexityDetector } from "../src/complexity-detector.js";

describe("ComplexityDetector", () => {
  let detector: ComplexityDetector;

  beforeEach(() => {
    detector = new ComplexityDetector();
  });

  describe("simple prompts — no complexity signal", () => {
    it("returns null for a simple one-line question", () => {
      const result = detector.detect("What does this function do?");
      expect(result).toBeNull();
    });

    it("returns null for a simple file edit request", () => {
      const result = detector.detect("Change the color to blue on line 42");
      expect(result).toBeNull();
    });

    it("returns null for a greeting", () => {
      const result = detector.detect("Hello, can you help me?");
      expect(result).toBeNull();
    });
  });

  describe("sequential step patterns", () => {
    it("returns null for sequential steps alone (below threshold)", () => {
      const result = detector.detect(
        "First read the file, then modify the config, finally run tests",
      );
      expect(result).toBeNull();
    });

    it("detects sequential steps combined with verb categories", () => {
      const result = detector.detect(
        "First refactor the auth module, then write tests for it, and finally review the changes",
      );
      expect(result).not.toBeNull();
      expect(result!.reasons).toContain("sequential steps detected");
    });

    it("detects 'after that' as sequential language", () => {
      const result = detector.detect(
        "Add a new endpoint. After that, update the API docs.",
      );
      expect(result).not.toBeNull();
      expect(result!.reasons).toContain("sequential steps detected");
    });

    it("detects 'next' and 'lastly' patterns", () => {
      const result = detector.detect(
        "Create the schema. Next, write the migration. Lastly, update the README.",
      );
      expect(result).not.toBeNull();
      expect(result!.reasons).toContain("sequential steps detected");
    });

    it("returns null for step-N alone (below threshold)", () => {
      const result = detector.detect(
        "Step 1: Create models. Step 2: Write controllers. Step 3: Add routes.",
      );
      expect(result).toBeNull();
    });
  });

  describe("multiple verb categories", () => {
    it("returns null for 2 task types alone (below threshold)", () => {
      const result = detector.detect(
        "Refactor the auth module and write tests for it",
      );
      expect(result).toBeNull();
    });

    it("returns null for 3 task types alone (below threshold)", () => {
      const result = detector.detect(
        "Refactor the API, write tests for all endpoints, and review the security implications",
      );
      expect(result).toBeNull();
    });

    it("returns null for fix+deploy alone (below threshold)", () => {
      const result = detector.detect(
        "Fix the bug and deploy to staging",
      );
      expect(result).toBeNull();
    });

    it("returns null for implement+document alone (below threshold)", () => {
      const result = detector.detect(
        "Implement the new feature and document the API changes",
      );
      expect(result).toBeNull();
    });

    it("detects 3+ task types combined with sequential steps", () => {
      const result = detector.detect(
        "First refactor the API, then write tests, and finally review security",
      );
      expect(result).not.toBeNull();
      expect(result!.reasons.some((r) => r.includes("distinct task types"))).toBe(true);
      expect(result!.reasons).toContain("sequential steps detected");
    });
  });

  describe("list patterns", () => {
    it("detects bulleted task list with 3+ items", () => {
      const result = detector.detect([
        "Please help with these tasks:",
        "- Update user model",
        "- Add validation layer",
        "- Write migration scripts",
      ].join("\n"));
      expect(result).not.toBeNull();
      expect(result!.reasons.some((r) => r.includes("-item task list"))).toBe(true);
    });

    it("returns null for numbered list alone (below threshold)", () => {
      const result = detector.detect([
        "Do the following:",
        "1. Create the database schema",
        "2. Implement CRUD operations",
        "3. Add API endpoints",
        "4. Write integration tests",
      ].join("\n"));
      expect(result).toBeNull();
    });

    it("does not flag lists with fewer than 3 items", () => {
      const result = detector.detect([
        "- Fix typo in README",
        "- Update version number",
      ].join("\n"));
      expect(result).toBeNull();
    });
  });

  describe("long prompts", () => {
    it("adds score for long multi-sentence prompts (5+ sentences)", () => {
      const result = detector.detect(
        "The authentication system needs a complete overhaul. " +
        "We currently use JWT tokens with a 24-hour expiry. " +
        "The refresh token mechanism is broken and never rotates. " +
        "The session store is not cleaning up expired entries. " +
        "We need to add rate limiting on the login endpoint. " +
        "Also the password hashing is using MD5 which is insecure.",
      );
      expect(result).toBeNull();
    });

    it("combines sentence count with other signals for complex long prompts", () => {
      const result = detector.detect(
        "First, refactor the auth module to use refresh tokens. " +
        "The current JWT system has a 24-hour expiry which is too long. " +
        "The refresh token mechanism is broken and never rotates. " +
        "The session store is not cleaning up expired entries. " +
        "We need to add rate limiting on the login endpoint. " +
        "Also the password hashing is using MD5 which is insecure.",
      );
      expect(result).not.toBeNull();
      expect(result!.reasons).toContain("sequential steps detected");
      expect(result!.reasons).toContain("long multi-sentence prompt");
    });
  });

  describe("score capping", () => {
    it("caps score at 1.0", () => {
      const result = detector.detect(
        "First refactor the auth, then write tests, next review security, and finally deploy. " +
        "- Fix token rotation\n- Add rate limiting\n- Update password hashing\n- Write docs",
      );
      expect(result).not.toBeNull();
      expect(result!.score).toBeLessThanOrEqual(1.0);
    });
  });
});
