import { test } from "node:test";
import assert from "node:assert/strict";
import { collectUsage } from "./summary.ts";
import { fixture } from "./iteration-test-helpers.ts";

test("usage includes failed resume and fresh fallback without counting cached tokens twice", async (t) => {
  const f = fixture(t, {
    agents: [{ threadId: "saved" }, { code: 1 }, {}],
    checks: [false, true],
  });
  await f.launch();
  assert.equal(f.codex().length, 3);
  assert.deepEqual(collectUsage(f.directory), {
    input: 30,
    cached: 12,
    output: 6,
  });
});
test("usage includes malformed reviewer report and its retry", async (t) => {
  const f = fixture(t, {
    review: { enabled: true, blockingPriorities: [0, 1] },
    reviewers: [{ malformed: true }, {}],
  });
  await f.launch();
  assert.deepEqual(collectUsage(f.directory), {
    input: 30,
    cached: 12,
    output: 6,
  });
});
