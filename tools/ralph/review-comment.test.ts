import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReviewComment } from "./review.ts";
import type { ReviewReport } from "./review-report.ts";
import { fixture } from "./iteration-test-helpers.ts";

const report: ReviewReport = {
  summary: "Проверено",
  criteria: [{ criterion: "Готово", met: true, evidence: "тест\nзелёный" }],
  findings: [],
};
test("approve without findings", () => {
  const text = renderReviewComment(report, 1, { blocking: false });
  assert.match(text, /Ревью, раунд 1: approve/);
  assert.match(text, /✅ Готово — тест зелёный/);
  assert.match(text, /Находки:\nНет\./);
  assert.match(text, /принято, вливается в ветку фазы/);
});
const finding = (priority: 1 | 3) => ({
  priority,
  file: "a.ts",
  line: 4,
  title: `Issue${priority}`,
  body: "Details",
});
test("changes sorts priorities and shows unmet criteria", () => {
  const text = renderReviewComment(
    {
      ...report,
      criteria: [{ criterion: "Готово", met: false, evidence: "нет теста" }],
      findings: [finding(3), finding(1)],
    },
    2,
    { blocking: true },
  );
  assert.match(text, /раунд 2: changes/);
  assert.match(text, /❌ Готово — нет теста/);
  assert.match(text, /P1 `a.ts:4` — Issue1\n  Details/);
  assert.ok(text.indexOf("P1") < text.indexOf("P3"));
  assert.match(text, /возвращено исполнителю/);
});
test("previous findings partially fixed", () => {
  const text = renderReviewComment({ ...report, findings: [finding(3)] }, 2, {
    blocking: false,
    previous: { ...report, findings: [finding(1), finding(3)] },
  });
  assert.match(text, /Issue1: исправлено/);
  assert.match(text, /Issue3: не исправлено/);
});
test("review posts every round as an issue comment", async (t) => {
  const f = fixture(t, {
    review: { enabled: true, blockingPriorities: [0, 1] },
    reviewers: [{ report: { ...report, findings: [finding(1)] } }, { report }],
  });
  await f.launch();
  const comments = f.calls.filter((c) => c.command[0] === "gh");
  assert.equal(comments.length, 2);
  assert.deepEqual(comments[0].command, [
    "gh",
    "issue",
    "comment",
    "8",
    "--body-file",
    "-",
  ]);
  assert.match(comments[0].prompt!, /раунд 1: changes/);
  assert.match(comments[1].prompt!, /раунд 2: approve/);
});

test("comment publication failure is logged without failing the task", async (t) => {
  const f = fixture(t, {
    review: { enabled: true, blockingPriorities: [0, 1] },
    commentFailure: true,
  });
  assert.equal((await f.launch()).report.status, "done");
  assert.equal(f.count("commit"), 1);
  assert.match(
    f.runLog(),
    /Could not publish review comment:.*GitHub comment unavailable/,
  );
});
