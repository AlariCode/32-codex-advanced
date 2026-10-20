import { test } from "node:test";
import assert from "node:assert/strict";
import { failureStreak, noProgress, budgetStop } from "./run-state.ts";
import { fixture } from "./iteration-test-helpers.ts";

for (const [statuses, expected] of [
  [["failed", "done", "failed"], 1],
  [["failed", "failed"], 2],
  [["blocked", "blocked"], 0],
  [["failed", "blocked", "failed"], 2],
] as const) {
  test(`failure streak ${statuses.join(",")}`, () => {
    const count = statuses.reduce((n, status) => failureStreak(n, status), 0);
    assert.equal(count, expected);
    assert.equal(count >= 2, expected >= 2);
  });
}
test("no progress compares consecutive return hashes", () => {
  assert.equal(noProgress(undefined, "a"), false);
  assert.equal(noProgress("a", "a"), true);
  assert.equal(noProgress("a", "b"), false);
});
test("unchanged executor stops before another return", async (t) => {
  const f = fixture(t, { checks: [false, false, false], unchanged: true });
  await assert.rejects(f.launch(), /нет прогресса/);
  assert.equal(f.codex().length, 2);
});
test("budgets are optional and cached input is not added", () => {
  const usage = { input: 8, output: 2, cached: 100 };
  assert.equal(budgetStop({}, 0, usage, 999999), undefined);
  assert.equal(budgetStop({ maxTokens: 11 }, 0, usage), undefined);
  assert.equal(budgetStop({ maxTokens: 10 }, 0, usage), "maxTokens");
  assert.equal(budgetStop({ maxMinutes: 1 }, 0, usage, 59999), undefined);
  assert.equal(budgetStop({ maxMinutes: 1 }, 0, usage, 60000), "maxMinutes");
});
