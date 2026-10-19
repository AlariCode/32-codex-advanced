import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startTaskBranch } from "./git.ts";
import { repository } from "./git-test-helpers.ts";

test("startTaskBranch creates a missing task branch from the phase", async (t) => {
  const { run } = await repository(t);
  const phase = (await run(["git", "rev-parse", "HEAD"])).stdout;
  await startTaskBranch(run, 8, "ralph/phase-2");
  assert.equal(
    (await run(["git", "branch", "--show-current"])).stdout.trim(),
    "issue-8",
  );
  assert.equal((await run(["git", "rev-parse", "HEAD"])).stdout, phase);
});

test("startTaskBranch resumes an existing branch without resetting its commits", async (t) => {
  const { run } = await repository(t);
  await run(["git", "switch", "-c", "issue-8"]);
  await run(["git", "commit", "--allow-empty", "-m", "Saved task work"]);
  const saved = (await run(["git", "rev-parse", "HEAD"])).stdout;
  await run(["git", "switch", "ralph/phase-2"]);
  await startTaskBranch(run, 8, "ralph/phase-2");
  assert.equal(
    (await run(["git", "branch", "--show-current"])).stdout.trim(),
    "issue-8",
  );
  assert.equal((await run(["git", "rev-parse", "HEAD"])).stdout, saved);
  await startTaskBranch(run, 8, "ralph/phase-2");
  assert.equal((await run(["git", "rev-parse", "HEAD"])).stdout, saved);
});

test("startTaskBranch rejects a dirty working tree before switching branches", async (t) => {
  const { directory, run } = await repository(t);
  await run(["git", "branch", "issue-8"]);
  await writeFile(join(directory, "unfinished.txt"), "saved work");
  await assert.rejects(
    startTaskBranch(run, 8, "ralph/phase-2"),
    /Working tree must be clean/,
  );
  assert.equal(
    (await run(["git", "branch", "--show-current"])).stdout.trim(),
    "ralph/phase-2",
  );
});
