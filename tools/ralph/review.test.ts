import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict, reviewArgs } from "./review.ts";
import type { Finding, Priority, ReviewReport } from "./review-report.ts";
import { closingSummary } from "./review-step.ts";

const finding = (priority: Priority): Finding => ({
  priority,
  title: "Issue",
  body: "Behavior breaks",
  file: "source.ts",
  line: 12,
});
const report = (priorities: Priority[], met = true): ReviewReport => ({
  summary: "Review",
  criteria: [{ criterion: "Acceptance", met, evidence: "Test" }],
  findings: priorities.map(finding),
});

test("P1 blocks even when the model summary says approve", () => {
  assert.equal(
    verdict({ ...report([1]), summary: "approve" }, [0, 1]).blocking,
    true,
  );
});

test("P2/P3 approve and remain available for the closing comment", () => {
  const result = verdict(report([2, 3]), [0, 1]);
  assert.equal(result.blocking, false);
  assert.deepEqual(result.nonBlocking, [finding(2), finding(3)]);
  const comment = closingSummary("Implemented", result.nonBlocking);
  assert.match(comment, /Implemented/);
  assert.match(comment, /P2 Issue \(source.ts:12\): Behavior breaks/);
  assert.match(comment, /P3/);
  assert.equal(closingSummary("Implemented", []), "Implemented");
});

test("unmet criterion blocks without findings", () => {
  assert.equal(verdict(report([], false), [0, 1]).blocking, true);
});

test("empty report approves", () => {
  assert.deepEqual(
    verdict({ summary: "", criteria: [], findings: [] }, [0, 1]),
    { blocking: false, nonBlocking: [] },
  );
});

test("configured priorities determine blocking, including an empty list", () => {
  assert.equal(verdict(report([2]), [2]).blocking, true);
  assert.deepEqual(verdict(report([1]), [2]).nonBlocking, [finding(1)]);
  assert.equal(verdict(report([0, 1]), []).blocking, false);
  assert.equal(verdict(report([], false), []).blocking, true);
});

test("review command is an ephemeral read-only exec without executor permissions", () => {
  const args = reviewArgs("schema.json", "review-1.json");
  assert.equal(args[0], "exec");
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(args.includes("--ephemeral"));
  for (const forbidden of ["--add-dir", "resume", "review"])
    assert.equal(args.includes(forbidden), false);
  assert.ok(args.includes("--json"));
  assert.equal(args[args.indexOf("--output-schema") + 1], "schema.json");
  assert.equal(args[args.indexOf("-o") + 1], "review-1.json");
  assert.equal(args.at(-1), "-");
});
