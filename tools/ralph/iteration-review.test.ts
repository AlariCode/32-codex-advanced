import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./iteration-test-helpers.ts";
import { approved } from "./iteration-agent-mock.ts";
import type { ReviewConfig, ReviewReport } from "./review-report.ts";

const review: ReviewConfig = { enabled: true, blockingPriorities: [0, 1] };
const blocked: ReviewReport = {
  summary: "Need changes",
  criteria: [
    { criterion: "Handle errors", met: false, evidence: "Not covered" },
  ],
  findings: [
    {
      priority: 1,
      title: "Fix crash",
      body: "Crashes on missing input",
      file: "source.ts",
      line: 8,
    },
    {
      priority: 2,
      title: "Optional cleanup",
      body: "Simplify",
      file: "source.ts",
      line: 9,
    },
  ],
};

function trace(f: ReturnType<typeof fixture>) {
  return f.calls.flatMap(({ command: c }) =>
    c[0] === "codex"
      ? [c.includes("read-only") ? "review" : "executor"]
      : c[0] === "check"
        ? ["check"]
        : c[1] === "commit"
          ? ["commit"]
          : [],
  );
}

test("green checks stage a diff and review before commit; approved notes are returned", async (t) => {
  const f = fixture(t, {
    review,
    reviewers: [{ report: { ...approved, findings: [blocked.findings[1]] } }],
  });
  const result = await f.launch();
  assert.deepEqual(trace(f), ["executor", "check", "review", "commit"]);
  assert.deepEqual(result.nonBlocking, [blocked.findings[1]]);
  assert.match(f.read("review-1.diff"), /changed behavior/);
  const reviewerIndex = f.calls.findIndex(({ command }) =>
    command.includes("read-only"),
  );
  const before = f.calls.slice(0, reviewerIndex).map(({ command }) => command);
  assert.ok(before.some((c) => c.join(" ") === "git add -A"));
  assert.ok(before.some((c) => c.join(" ") === "git diff --cached --no-color"));
  assert.match(
    f.runLog(),
    /review=1 P0=0 P1=0 P2=1 P3=0 unmet=\[\] verdict=approve/,
  );
});

test("blocking review resumes the executor and a fresh reviewer sees all prior remarks", async (t) => {
  const f = fixture(t, {
    review,
    agents: [{ threadId: "saved" }, {}],
    reviewers: [{ report: blocked }, {}],
  });
  await f.launch();
  assert.deepEqual(trace(f), [
    "executor",
    "check",
    "review",
    "executor",
    "check",
    "review",
    "commit",
  ]);
  assert.deepEqual(f.codex()[1].command.slice(-3), ["resume", "saved", "-"]);
  assert.match(f.codex()[1].prompt!, /Handle errors: Not covered/);
  assert.match(f.codex()[1].prompt!, /P1 Fix crash \(source.ts:8\)/);
  assert.doesNotMatch(
    f.codex()[1].prompt!,
    /Optional cleanup|Последние 80 строк/,
  );
  const nextPrompt = f.reviewers()[1].prompt!;
  assert.ok(nextPrompt.includes(JSON.stringify(blocked, null, 2)));
  assert.match(nextPrompt, /review-2.diff/);
  for (const call of f.reviewers()) {
    assert.ok(call.command.includes("--ephemeral"));
    assert.equal(call.command.includes("resume"), false);
  }
  assert.match(f.runLog(), /unmet=\["Handle errors"\] verdict=changes/);
});

test("checks and review share the same fix budget", async (t) => {
  const f = fixture(t, {
    review,
    checks: [false, true, true],
    reviewers: [{ report: blocked }, {}],
  });
  await f.launch(2);
  assert.equal(f.codex().length, 3);
  assert.equal(f.reviewers().length, 2);
  assert.equal(f.count("commit"), 1);
});

test("exhaustion after a check failure and review rejection never commits", async (t) => {
  const f = fixture(t, {
    review,
    checks: [false, true],
    reviewers: [{ report: blocked }],
  });
  await assert.rejects(
    f.launch(1),
    /Fix attempts exhausted[\s\S]*Handle errors[\s\S]*source.ts:8/,
  );
  assert.equal(f.codex().length, 2);
  assert.equal(f.count("commit"), 0);
});

test("commit hook failure returns through resume, checks and review again", async (t) => {
  const f = fixture(t, { review, commits: [false, true] });
  await f.launch(1);
  assert.deepEqual(trace(f), [
    "executor",
    "check",
    "review",
    "commit",
    "executor",
    "check",
    "review",
    "commit",
  ]);
  assert.match(f.codex()[1].prompt!, /lefthook failed/);
});

test("disabled review preserves the original check/commit path", async (t) => {
  const f = fixture(t, { review: { ...review, enabled: false } });
  assert.deepEqual((await f.launch()).nonBlocking, []);
  assert.deepEqual(trace(f), ["executor", "check", "commit"]);
  assert.equal(f.reviewers().length, 0);
});
