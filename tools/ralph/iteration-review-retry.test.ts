import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./iteration-test-helpers.ts";
import type { ReviewConfig } from "./review-report.ts";

const review: ReviewConfig = { enabled: true, blockingPriorities: [0, 1] };

for (const failure of [{ code: 1 }, { malformed: true }]) {
  test(`reviewer retries once after ${JSON.stringify(failure)} without spending an executor fix`, async (t) => {
    const f = fixture(t, { review, reviewers: [failure, {}] });
    await f.launch(1);
    assert.equal(f.reviewers().length, 2);
    assert.equal(f.codex().length, 1);
    assert.equal(f.count("check"), 1);
    assert.equal(f.count("commit"), 1);
    assert.equal(f.reviewers()[0].prompt, f.reviewers()[1].prompt);
    assert.ok(f.read("review-1.jsonl"));
    assert.ok(f.read("review-1-retry.jsonl"));
    assert.match(f.read("review-1-retry.json"), /Reviewed/);
    if (failure.malformed) assert.equal(f.read("review-1.json"), "broken");
    assert.match(f.runLog(), /review=1 attempt=1 error=/);
    assert.match(f.runLog(), /review=1 .*verdict=approve/);
  });

  test(`two reviewer failures ${JSON.stringify(failure)} stop without committing or resuming`, async (t) => {
    const f = fixture(t, { review, reviewers: [failure, failure] });
    await assert.rejects(f.launch(), /Review failed twice/);
    assert.equal(f.reviewers().length, 2);
    assert.equal(f.codex().length, 1);
    assert.equal(f.count("commit"), 0);
    assert.match(f.runLog(), /review=1 attempt=2 error=/);
    assert.doesNotMatch(f.runLog(), /verdict=approve/);
  });
}

test("unmet criteria alone prevent commit even when blocking priorities are empty", async (t) => {
  const report = {
    summary: "",
    criteria: [{ criterion: "Coverage", met: false, evidence: "Missing test" }],
    findings: [],
  };
  const f = fixture(t, {
    review: { enabled: true, blockingPriorities: [] },
    reviewers: [{ report }, { report }],
  });
  await assert.rejects(f.launch(1), /Coverage: Missing test/);
  assert.equal(f.count("commit"), 0);
});

test("review feedback survives a missing-session fresh fallback", async (t) => {
  const report = {
    summary: "",
    criteria: [{ criterion: "Coverage", met: false, evidence: "Missing test" }],
    findings: [],
  };
  const f = fixture(t, {
    review,
    agents: [{}, { threadId: "new" }],
    reviewers: [{ report }, {}],
  });
  await f.launch(1);
  assert.equal(f.codex()[1].command.includes("resume"), false);
  assert.match(f.codex()[1].prompt!, /Original constraints/);
  assert.match(f.codex()[1].prompt!, /Код-ревью задачи #8/);
  assert.match(f.codex()[1].prompt!, /Coverage: Missing test/);
});

test("blocked executor after review skips further review and commit", async (t) => {
  const f = fixture(t, {
    review,
    reviewers: [
      {
        report: {
          summary: "",
          criteria: [
            {
              criterion: "Acceptance",
              met: false,
              evidence: "Missing behavior",
            },
          ],
          findings: [],
        },
      },
    ],
    agents: [{ threadId: "saved" }, { status: "blocked" }],
  });
  assert.equal((await f.launch()).report.status, "blocked");
  assert.equal(f.reviewers().length, 1);
  assert.equal(f.count("commit"), 0);
});
