import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { EnvironmentSchema } from "../../src/schemas/environment.js";

const decode = Schema.decodeUnknownSync(EnvironmentSchema);

describe("EnvironmentSchema", () => {
	it("accepts empty environment {}", () => {
		const result = decode({});
		expect(result).toEqual({});
	});

	it("accepts wait_timer: 30", () => {
		const result = decode({ wait_timer: 30 });
		expect(result.wait_timer).toBe(30);
	});

	it("accepts wait_timer: 0 (minimum)", () => {
		const result = decode({ wait_timer: 0 });
		expect(result.wait_timer).toBe(0);
	});

	it("accepts wait_timer: 43200 (maximum)", () => {
		const result = decode({ wait_timer: 43200 });
		expect(result.wait_timer).toBe(43200);
	});

	it("rejects wait_timer: 50000 (over 43200)", () => {
		expect(() => decode({ wait_timer: 50000 })).toThrow();
	});

	it("rejects wait_timer: -1 (below 0)", () => {
		expect(() => decode({ wait_timer: -1 })).toThrow();
	});

	it("rejects wait_timer: 1.5 (non-integer)", () => {
		expect(() => decode({ wait_timer: 1.5 })).toThrow();
	});

	it("accepts prevent_self_review: true", () => {
		const result = decode({ prevent_self_review: true });
		expect(result.prevent_self_review).toBe(true);
	});

	it("accepts prevent_self_review: false", () => {
		const result = decode({ prevent_self_review: false });
		expect(result.prevent_self_review).toBe(false);
	});

	it("accepts reviewers array with User and Team entries", () => {
		const result = decode({
			reviewers: [
				{ type: "User", id: 123 },
				{ type: "Team", id: 456 },
			],
		});
		expect(result.reviewers).toHaveLength(2);
		expect(result.reviewers?.[0]).toEqual({ type: "User", id: 123 });
		expect(result.reviewers?.[1]).toEqual({ type: "Team", id: 456 });
	});

	it("accepts reviewers array with only User entries", () => {
		const result = decode({
			reviewers: [{ type: "User", id: 99 }],
		});
		expect(result.reviewers?.[0].type).toBe("User");
	});

	it("accepts reviewers array with only Team entries", () => {
		const result = decode({
			reviewers: [{ type: "Team", id: 7 }],
		});
		expect(result.reviewers?.[0].type).toBe("Team");
	});

	it("rejects reviewers with invalid type", () => {
		expect(() => decode({ reviewers: [{ type: "Organization", id: 1 }] })).toThrow();
	});

	it('accepts deployment_branches = "all"', () => {
		const result = decode({ deployment_branches: "all" });
		expect(result.deployment_branches).toBe("all");
	});

	it('accepts deployment_branches = "protected"', () => {
		const result = decode({ deployment_branches: "protected" });
		expect(result.deployment_branches).toBe("protected");
	});

	it("accepts deployment_branches as custom policies array", () => {
		const result = decode({
			deployment_branches: [{ name: "main" }, { name: "release/*", type: "branch" }, { name: "v*", type: "tag" }],
		});
		expect(Array.isArray(result.deployment_branches)).toBe(true);
		const branches = result.deployment_branches as Array<{ name: string; type?: string }>;
		expect(branches[0].name).toBe("main");
		expect(branches[1].type).toBe("branch");
		expect(branches[2].type).toBe("tag");
	});

	it("defaults type to 'branch' for deployment branch policies without explicit type", () => {
		const result = decode({
			deployment_branches: [{ name: "main" }],
		});
		const branches = result.deployment_branches as Array<{ name: string; type: string }>;
		expect(branches[0].type).toBe("branch");
	});

	it("accepts deployment_branches as empty array", () => {
		const result = decode({ deployment_branches: [] });
		expect(Array.isArray(result.deployment_branches)).toBe(true);
		expect((result.deployment_branches as unknown[]).length).toBe(0);
	});

	it("rejects deployment_branches as invalid string", () => {
		expect(() => decode({ deployment_branches: "main" })).toThrow();
	});

	it("accepts all fields together", () => {
		const result = decode({
			wait_timer: 10,
			prevent_self_review: true,
			reviewers: [{ type: "Team", id: 1 }],
			deployment_branches: "protected",
		});
		expect(result.wait_timer).toBe(10);
		expect(result.prevent_self_review).toBe(true);
		expect(result.reviewers?.[0].type).toBe("Team");
		expect(result.deployment_branches).toBe("protected");
	});
});
