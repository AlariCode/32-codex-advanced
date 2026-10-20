import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { loadConfig } from "./config.ts";

function config(t: TestContext, review?: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "ralph-review-config-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      label: "phase-{phase}",
      branch: "ralph/phase-{phase}",
      maxIterations: 10,
      maxFixAttempts: 3,
      checks: [["make", "check"]],
      review,
    }),
  );
  return () => loadConfig(file, 2);
}

test("missing review config disables review", (t) => {
  assert.deepEqual(config(t)().review, {
    enabled: false,
    blockingPriorities: [0, 1],
  });
});

for (const enabled of [false, true]) {
  test(`review enabled=${enabled} accepts configured priorities`, (t) => {
    assert.deepEqual(
      config(t, { enabled, blockingPriorities: [0, 2] })().review,
      { enabled, blockingPriorities: [0, 2] },
    );
  });
}

for (const review of [
  null,
  [],
  {},
  { enabled: "true", blockingPriorities: [0, 1] },
  { enabled: true },
  { enabled: true, blockingPriorities: "0,1" },
  ...[-1, 4, 1.5, "1", true, null].map((p) => ({
    enabled: true,
    blockingPriorities: [p],
  })),
]) {
  test(`rejects review config ${JSON.stringify(review)}`, (t) => {
    assert.throws(config(t, review), /Invalid review config/);
  });
}
