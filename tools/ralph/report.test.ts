import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReport, reportSchema } from "./report.ts";

for (const status of ["done", "blocked", "failed"]) {
  test(`parses ${status} report`, () => {
    const report = {
      status,
      summary: "Result",
      commit_message: "feat: implement task",
    };
    assert.deepEqual(parseReport(JSON.stringify(report)), report);
  });
}

for (const value of [
  null,
  [],
  "done",
  42,
  {},
  { status: "unknown", summary: "", commit_message: "" },
  { status: "done", summary: "" },
  { status: "done", summary: 1, commit_message: "" },
  { status: "done", summary: "", commit_message: null },
  { status: ["done"], summary: "", commit_message: "" },
  { status: "done", summary: "", commit_message: "", extra: true },
]) {
  test(`rejects invalid report ${JSON.stringify(value)}`, () => {
    assert.throws(() => parseReport(JSON.stringify(value)));
  });
}

test("rejects malformed JSON and markdown wrappers", () => {
  assert.throws(() => parseReport("{"));
  assert.throws(() => parseReport("```json\n{}\n```"));
});

test("schema requires exactly the three declared fields", () => {
  assert.deepEqual(reportSchema.required, [
    "status",
    "summary",
    "commit_message",
  ]);
  assert.equal(reportSchema.additionalProperties, false);
});
