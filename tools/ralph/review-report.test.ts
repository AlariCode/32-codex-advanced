import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReviewReport, reviewSchema } from "./review-report.ts";

const criterion = {
  criterion: "Acceptance",
  met: true,
  evidence: "Test proves behavior",
};
const finding = {
  priority: 1,
  title: "Failure",
  body: "Why it breaks",
  file: "source.ts",
  line: 10,
};
const report = {
  summary: "Review",
  criteria: [criterion],
  findings: [finding],
};

test("parses a complete review report", () => {
  assert.deepEqual(parseReviewReport(JSON.stringify(report)), report);
});

for (const invalid of [
  null,
  [],
  {},
  { ...report, extra: true },
  { ...report, criteria: null },
  { ...report, summary: 1 },
  { ...report, findings: {} },
  { ...report, criteria: [{ ...criterion, extra: true }] },
  { ...report, criteria: [{ criterion: "Missing fields" }] },
  { ...report, criteria: [{ ...criterion, met: "false" }] },
  { ...report, criteria: [{ ...criterion, evidence: null }] },
  { ...report, findings: [{ ...finding, extra: true }] },
  ...[-1, 4, 1.5, "1", null].map((priority) => ({
    ...report,
    findings: [{ ...finding, priority }],
  })),
  { ...report, findings: [{ ...finding, line: 1.5 }] },
  { ...report, findings: [{ ...finding, file: null }] },
  { ...report, findings: [{ priority: 1 }] },
]) {
  test(`rejects invalid report ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => parseReviewReport(JSON.stringify(invalid)));
  });
}

test("rejects malformed JSON and markdown wrappers", () => {
  assert.throws(() => parseReviewReport("{broken"));
  assert.throws(() => parseReviewReport("```json\n{}\n```"));
});

test("schema requires every property and forbids extras on all object levels", () => {
  for (const schema of [
    reviewSchema,
    reviewSchema.properties.criteria.items,
    reviewSchema.properties.findings.items,
  ]) {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(
      [...schema.required].sort(),
      Object.keys(schema.properties).sort(),
    );
  }
});
